using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

namespace Exchange.Api;

public sealed record AuthOptions(string SigningKey, TimeSpan AccessLifetime, TimeSpan RefreshLifetime, string? AdminLogin, string? AdminPassword)
{
    public static AuthOptions From(IConfiguration c) => new(
        c["Auth:SigningKey"] is { Length: >= 32 } key ? key : throw new InvalidOperationException("Auth:SigningKey должен быть задан и не короче 32 символов"),
        TimeSpan.FromSeconds(c.GetValue("Auth:AccessSeconds", 900)),
        TimeSpan.FromDays(c.GetValue("Auth:RefreshDays", 30)),
        c["Auth:AdminLogin"],
        c["Auth:AdminPassword"]);

    public SymmetricSecurityKey Key => new(Encoding.UTF8.GetBytes(SigningKey));
}

/// <summary>Пользователь запроса: Id из токена и признак администратора.</summary>
public readonly record struct Caller(Guid Id, bool IsAdmin)
{
    public static Caller From(ClaimsPrincipal p) =>
        new(Guid.TryParse(p.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? p.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty, p.IsInRole("admin"));

    public bool Owns(Account a) => IsAdmin || a.OwnerId == Id;
}

public static class Passwords
{
    private const int Iterations = 100_000;

    /// <summary>PBKDF2-SHA256 со случайной солью: одинаковые пароли дают разные хэши, перебор дорог.</summary>
    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('.');
        if (parts.Length != 3 || !int.TryParse(parts[0], out var it)) return false;
        var expected = Convert.FromBase64String(parts[2]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(parts[1]), it, HashAlgorithmName.SHA256, expected.Length);
        // Сравнение за постоянное время: по времени ответа нельзя угадать, сколько байт совпало.
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

public static class AuthEndpoints
{
    private static readonly Regex LoginRe = new("^[a-z0-9_.-]{3,32}$");
    private const int MaxFailures = 5;
    private static readonly TimeSpan Lockout = TimeSpan.FromMinutes(5);

    public static void AddExchangeAuth(this WebApplicationBuilder builder)
    {
        var options = AuthOptions.From(builder.Configuration);
        builder.Services.AddSingleton(options);
        builder.Services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o =>
            {
                o.MapInboundClaims = false;
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = "exchange",
                    ValidateAudience = true,
                    ValidAudience = "exchange",
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = options.Key,
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    // По умолчанию допускается 5 минут расхождения часов — для коротких токенов это слишком.
                    ClockSkew = TimeSpan.FromSeconds(1),
                    RoleClaimType = "role",
                    NameClaimType = JwtRegisteredClaimNames.Sub,
                };
            });
        builder.Services.AddAuthorizationBuilder()
            .AddPolicy("admin", p => p.RequireRole("admin"));
    }

    /// <summary>Администратор из настроек: создаётся при старте, если его ещё нет.</summary>
    public static async Task EnsureAdmin(ExchangeDb db, AuthOptions o)
    {
        if (string.IsNullOrEmpty(o.AdminLogin) || string.IsNullOrEmpty(o.AdminPassword)) return;
        if (await db.Users.AnyAsync(u => u.Login == o.AdminLogin)) return;
        db.Users.Add(new User { Login = o.AdminLogin, PasswordHash = Passwords.Hash(o.AdminPassword), IsAdmin = true });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { /* второй экземпляр успел создать его раньше */ }
    }

    public static void MapAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/auth");

        auth.MapPost("/register", async (Credentials req, ExchangeDb db) =>
        {
            var login = (req.Login ?? "").Trim().ToLowerInvariant();
            var errors = new Dictionary<string, string[]>();
            if (!LoginRe.IsMatch(login)) errors["login"] = ["Логин: 3–32 символа, латиница, цифры, _ . -"];
            if ((req.Password ?? "").Length < 8) errors["password"] = ["Пароль — не короче 8 символов"];
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            if (await db.Users.AnyAsync(u => u.Login == login)) return Results.Problem("Такой логин уже занят", statusCode: 409);
            var user = new User { Login = login, PasswordHash = Passwords.Hash(req.Password!) };
            db.Users.Add(user);
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { return Results.Problem("Такой логин уже занят", statusCode: 409); }
            return Results.Created("/me", new { user.Id, user.Login });
        });

        auth.MapPost("/login", async (Credentials req, ExchangeDb db, AuthOptions o, IConnectionMultiplexer redis) =>
        {
            var login = (req.Login ?? "").Trim().ToLowerInvariant();
            var fails = $"login-fail:{login}";
            var r = redis.GetDatabase();
            // Блокировка по логину: перебор паролей упирается в 5 попыток за 5 минут — даже с верным паролем.
            if ((int?)await r.StringGetAsync(fails) >= MaxFailures)
                return Results.Problem("Слишком много неудачных попыток, попробуйте позже", statusCode: 429);
            var user = await db.Users.FirstOrDefaultAsync(u => u.Login == login);
            // Одинаковый ответ на «нет пользователя» и «неверный пароль»: нельзя выяснить, какие логины существуют.
            if (user is null || !Passwords.Verify(req.Password ?? "", user.PasswordHash))
            {
                await r.StringIncrementAsync(fails);
                await r.KeyExpireAsync(fails, Lockout);
                return Results.Problem("Неверный логин или пароль", statusCode: 401);
            }
            await r.KeyDeleteAsync(fails);
            return Results.Ok(await Issue(db, o, user));
        });

        auth.MapPost("/refresh", async (RefreshRequest req, ExchangeDb db, AuthOptions o) =>
        {
            var hash = Sha256(req.RefreshToken ?? "");
            // Ротация: refresh-токен одноразовый. Отметка «использован» — атомарным UPDATE, чтобы два параллельных refresh не прошли оба.
            var claimed = await db.RefreshTokens
                .Where(t => t.Hash == hash && t.UsedAt == null && t.ExpiresAt > DateTime.UtcNow)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, DateTime.UtcNow));
            if (claimed == 0) return Results.Problem("Сессия истекла, войдите снова", statusCode: 401);
            var token = await db.RefreshTokens.AsNoTracking().FirstAsync(t => t.Hash == hash);
            var user = await db.Users.FirstAsync(u => u.Id == token.UserId);
            return Results.Ok(await Issue(db, o, user));
        });

        auth.MapPost("/logout", async (RefreshRequest req, ExchangeDb db) =>
        {
            var hash = Sha256(req.RefreshToken ?? "");
            await db.RefreshTokens.Where(t => t.Hash == hash).ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, DateTime.UtcNow));
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapGet("/me", async (ClaimsPrincipal principal, ExchangeDb db) =>
        {
            var caller = Caller.From(principal);
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == caller.Id);
            if (user is null) return Results.Unauthorized();
            var accounts = await db.Accounts.AsNoTracking().Where(a => a.OwnerId == user.Id).OrderBy(a => a.Name).Select(a => new { a.Id, a.Name }).ToListAsync();
            return Results.Ok(new { user.Id, user.Login, Roles = user.IsAdmin ? new[] { "admin" } : [], Accounts = accounts });
        }).RequireAuthorization();
    }

    private static async Task<object> Issue(ExchangeDb db, AuthOptions o, User user)
    {
        var claims = new Dictionary<string, object> { [JwtRegisteredClaimNames.Sub] = user.Id.ToString(), ["login"] = user.Login };
        if (user.IsAdmin) claims["role"] = "admin";
        var access = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = "exchange",
            Audience = "exchange",
            Claims = claims,
            Expires = DateTime.UtcNow.Add(o.AccessLifetime),
            SigningCredentials = new SigningCredentials(o.Key, SecurityAlgorithms.HmacSha256),
        });
        var refresh = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        db.RefreshTokens.Add(new RefreshToken { Hash = Sha256(refresh), UserId = user.Id, ExpiresAt = DateTime.UtcNow.Add(o.RefreshLifetime) });
        await db.SaveChangesAsync();
        return new { AccessToken = access, RefreshToken = refresh, ExpiresIn = (int)o.AccessLifetime.TotalSeconds };
    }

    public static string Sha256(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));

    private record Credentials(string? Login, string? Password);
    private record RefreshRequest(string? RefreshToken);
}

/// <summary>
/// Лимит частоты заявок на пользователя — счётчик в Redis, общий для всех экземпляров API.
/// Окно в 1 секунду от первой заявки: INCR + PEXPIRE одним скриптом. Администратор (служебная учётка) не ограничен.
/// </summary>
public static class OrderRateLimit
{
    public const int PerSecond = 20;

    private const string Script = """
        local n = redis.call('INCR', KEYS[1])
        if n == 1 then redis.call('PEXPIRE', KEYS[1], 1000) end
        return n
        """;

    public static async Task<bool> Allow(IConnectionMultiplexer redis, Caller caller)
    {
        if (caller.IsAdmin) return true;
        try
        {
            var n = (long)await redis.GetDatabase().ScriptEvaluateAsync(Script, [$"rate:orders:{caller.Id}"]);
            return n <= PerSecond;
        }
        catch (Exception e) when (e is RedisException or TimeoutException)
        {
            // Redis недоступен — пропускаем (fail open): лучше без лимита, чем без торговли. Решение спорное — его спросят на защите.
            return true;
        }
    }
}
