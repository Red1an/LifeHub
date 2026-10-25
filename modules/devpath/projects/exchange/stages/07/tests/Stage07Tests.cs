using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Playwright;

public static class Auth
{
    public record Session(string Login, string Access, string Refresh, HttpClient Http);

    /// <summary>Регистрация + вход: клиент с токеном пользователя.</summary>
    public static async Task<Session> User(this ExchangeApp app, string login, string password = "Passw0rd!long")
    {
        var anon = app.Anonymous();
        Api.Status(HttpStatusCode.Created, await anon.Post("/auth/register", new { login, password }), $"POST /auth/register ({login})");
        var r = await anon.Post("/auth/login", new { login, password });
        Api.Status(HttpStatusCode.OK, r, $"POST /auth/login ({login})");
        return new Session(login, r.Body.Str("accessToken"), r.Body.Str("refreshToken"), app.WithToken(r.Body.Str("accessToken")));
    }

    /// <summary>Свой счёт пользователя; деньги и бумаги заводит администратор.</summary>
    public static async Task<string> OwnAccount(this Session s, HttpClient admin, decimal cash = 0, params (string Ticker, int Qty)[] securities)
    {
        var r = await s.Http.Post("/accounts", new { name = s.Login });
        Api.Status(HttpStatusCode.Created, r, "POST /accounts от пользователя");
        var id = r.Body.Id();
        if (cash > 0) Api.Status(HttpStatusCode.OK, await admin.Post($"/accounts/{id}/deposit", new { amount = cash }), "пополнение администратором");
        foreach (var (t, q) in securities) Api.Status(HttpStatusCode.OK, await admin.Post($"/accounts/{id}/securities", new { ticker = t, qty = q }), "бумаги администратором");
        return id;
    }

    public static bool Denied(HttpStatusCode s) => s is HttpStatusCode.Forbidden or HttpStatusCode.NotFound;

    /// <summary>Токен, подписанный чужим ключом, с ролью admin — его API принимать не должен.</summary>
    public static string Forged()
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes("attacker-key-attacker-key-attacker-key-attacker-key-1234567890"));
        var token = new JwtSecurityToken(
            claims: [new Claim("sub", Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "admin"), new Claim("role", "admin")],
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public class Stage07Tests : IDisposable
{
    private readonly ExchangeApp _app;
    private readonly HttpClient _admin;

    public Stage07Tests()
    {
        ExchangeApp.FlushRedis();
        _app = new ExchangeApp();
        _admin = _app.CreateClient();
    }

    public void Dispose() => _app.Dispose();

    [Fact(DisplayName = "Э7.01 Регистрация и вход")]
    public async Task RegisterLogin()
    {
        var anon = _app.Anonymous();
        Api.Status(HttpStatusCode.Created, await anon.Post("/auth/register", new { login = "anna", password = "Passw0rd!long" }), "регистрация");
        Api.Status(HttpStatusCode.Conflict, await anon.Post("/auth/register", new { login = "anna", password = "Другой-пароль-1" }), "тот же логин ещё раз");
        Api.Status(HttpStatusCode.BadRequest, await anon.Post("/auth/register", new { login = "boris", password = "123" }), "короткий пароль");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Post("/auth/login", new { login = "anna", password = "неверный" }), "неверный пароль");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Post("/auth/login", new { login = "nobody", password = "Passw0rd!long" }), "нет такого пользователя");
        var ok = await anon.Post("/auth/login", new { login = "anna", password = "Passw0rd!long" });
        Api.Status(HttpStatusCode.OK, ok, "вход");
        Assert.False(string.IsNullOrEmpty(ok.Body.Str("accessToken")));
        Assert.False(string.IsNullOrEmpty(ok.Body.Str("refreshToken")));
        Assert.True(ok.Body.GetProperty("expiresIn").GetInt32() > 0);
    }

    [Fact(DisplayName = "Э7.02 Без токена — 401, публичные данные рынка доступны всем")]
    public async Task Anonymous()
    {
        var anna = await _app.User("anna");
        var acc = await anna.OwnAccount(_admin, 1000m);
        var order = await anna.Http.Order(acc, "SBER", "buy", 100m, 1);
        var anon = _app.Anonymous();
        Api.Status(HttpStatusCode.Unauthorized, await anon.Get($"/accounts/{acc}"), "чужой не видит счёт без входа");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Get($"/accounts/{acc}/orders"), "заявки без входа");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Post("/orders", new { accountId = acc, ticker = "SBER", side = "buy", price = 100m, qty = 1 }), "заявка без входа");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Delete($"/orders/{order.Id()}"), "отмена без входа");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Post("/accounts", new { name = "x" }), "счёт без входа");
        Api.Status(HttpStatusCode.OK, await anon.Get("/instruments"), "инструменты");
        Api.Status(HttpStatusCode.OK, await anon.Get("/orderbook/SBER"), "стакан");
        Api.Status(HttpStatusCode.OK, await anon.Get("/quotes/SBER"), "котировка");
        Api.Status(HttpStatusCode.OK, await anon.Get("/trades?ticker=SBER"), "сделки");
    }

    [Fact(DisplayName = "Э7.03 Чужой счёт и чужие заявки недоступны (403 или 404)")]
    public async Task Ownership()
    {
        var anna = await _app.User("anna");
        var boris = await _app.User("boris");
        var annaAcc = await anna.OwnAccount(_admin, 1000m);
        var borisAcc = await boris.OwnAccount(_admin, 1000m);
        var annaOrder = await anna.Http.Order(annaAcc, "SBER", "buy", 100m, 1);
        Assert.True(Auth.Denied((await boris.Http.Get($"/accounts/{annaAcc}")).Status), "Борис видит счёт Ани");
        Assert.True(Auth.Denied((await boris.Http.Get($"/accounts/{annaAcc}/orders")).Status), "Борис видит заявки Ани");
        Assert.True(Auth.Denied((await boris.Http.Get($"/orders/{annaOrder.Id()}")).Status), "Борис видит заявку Ани");
        Assert.True(Auth.Denied((await boris.Http.Delete($"/orders/{annaOrder.Id()}")).Status), "Борис отменил заявку Ани");
        var steal = await boris.Http.Post("/orders", new { accountId = annaAcc, ticker = "SBER", side = "buy", price = 100m, qty = 1 });
        Assert.True(Auth.Denied(steal.Status), $"Борис выставил заявку со счёта Ани: {(int)steal.Status}");
        Assert.Equal("new", (await anna.Http.Get($"/orders/{annaOrder.Id()}")).Body.Str("status"));
        Api.Status(HttpStatusCode.OK, await boris.Http.Get($"/accounts/{borisAcc}"), "свой счёт");
    }

    [Fact(DisplayName = "Э7.04 Деньги и бумаги заводит только администратор")]
    public async Task AdminOnly()
    {
        var anna = await _app.User("anna");
        var acc = await anna.OwnAccount(_admin);
        Api.Status(HttpStatusCode.Forbidden, await anna.Http.Post($"/accounts/{acc}/deposit", new { amount = 1_000_000m }), "пользователь сам себе пополнил счёт");
        Api.Status(HttpStatusCode.Forbidden, await anna.Http.Post($"/accounts/{acc}/securities", new { ticker = "SBER", qty = 1000 }), "пользователь сам себе выдал бумаги");
        Api.Status(HttpStatusCode.OK, await _admin.Post($"/accounts/{acc}/deposit", new { amount = 500m }), "администратор пополнил");
        Assert.Equal(500m, (await anna.Http.AccountState(acc)).Dec("cash"));
    }

    [Fact(DisplayName = "Э7.05 Поддельный и испорченный токен — 401")]
    public async Task ForgedToken()
    {
        Api.Status(HttpStatusCode.Unauthorized, await _app.WithToken(Auth.Forged()).Get("/me"), "токен с чужой подписью и ролью admin");
        Api.Status(HttpStatusCode.Unauthorized, await _app.WithToken(Auth.Forged()).Post("/accounts/00000000-0000-0000-0000-000000000001/deposit", new { amount = 1m }), "поддельный админ");
        var anna = await _app.User("anna");
        var broken = anna.Access[..^4] + (anna.Access[^4..] == "AAAA" ? "BBBB" : "AAAA");
        Api.Status(HttpStatusCode.Unauthorized, await _app.WithToken(broken).Get("/me"), "испорченная подпись");
    }

    [Fact(DisplayName = "Э7.06 /me: кто я, роли и мои счета")]
    public async Task Me()
    {
        var anna = await _app.User("anna");
        var acc = await anna.OwnAccount(_admin);
        var me = await anna.Http.Get("/me");
        Api.Status(HttpStatusCode.OK, me, "GET /me");
        Assert.Equal("anna", me.Body.Str("login"));
        Assert.Equal([acc], me.Body.GetProperty("accounts").EnumerateArray().Select(a => a.Id()));
        Assert.DoesNotContain("admin", me.Body.GetProperty("roles").EnumerateArray().Select(r => r.GetString()));
        Assert.Contains("admin", (await _admin.Get("/me")).Body.GetProperty("roles").EnumerateArray().Select(r => r.GetString()));
    }

    [Fact(DisplayName = "Э7.07 Короткий access-токен, refresh с ротацией, выход отзывает refresh")]
    public async Task Refresh()
    {
        using var app = ExchangeApp.With(("Auth:AccessSeconds", "2"));
        app.CreateClient();
        var anna = await app.User("anna");
        Api.Status(HttpStatusCode.OK, await anna.Http.Get("/me"), "свежий токен");
        await Task.Delay(3500);
        Api.Status(HttpStatusCode.Unauthorized, await anna.Http.Get("/me"), "истёкший access-токен");

        var anon = app.Anonymous();
        var r = await anon.Post("/auth/refresh", new { refreshToken = anna.Refresh });
        Api.Status(HttpStatusCode.OK, r, "обновление по refresh-токену");
        Api.Status(HttpStatusCode.OK, await app.WithToken(r.Body.Str("accessToken")).Get("/me"), "новый access-токен");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Post("/auth/refresh", new { refreshToken = anna.Refresh }), "старый refresh второй раз (ротация)");

        var next = r.Body.Str("refreshToken");
        var logout = await app.WithToken(r.Body.Str("accessToken")).Post("/auth/logout", new { refreshToken = next });
        Assert.True(logout.Status is HttpStatusCode.NoContent or HttpStatusCode.OK, $"выход: {(int)logout.Status}");
        Api.Status(HttpStatusCode.Unauthorized, await anon.Post("/auth/refresh", new { refreshToken = next }), "refresh после выхода");
    }

    [Fact(DisplayName = "Э7.08 Лимит частоты заявок — на пользователя и общий для всех экземпляров API")]
    public async Task RateLimit()
    {
        using var twin = _app.Twin();
        var anna = await _app.User("anna");
        var acc = await anna.OwnAccount(_admin, 1_000_000m);
        HttpClient[] servers = [anna.Http, twin.WithToken(anna.Access)];
        var results = await Task.WhenAll(Enumerable.Range(0, 60).Select(i =>
            servers[i % 2].Post("/orders", new { accountId = acc, ticker = "SBER", side = "buy", price = 10m + i % 5, qty = 1 })));
        var limited = results.Count(r => r.Status == HttpStatusCode.TooManyRequests);
        var created = results.Count(r => r.Status == HttpStatusCode.Created);
        Assert.True(limited > 0, "60 заявок за мгновение прошли все — лимита нет");
        Assert.True(created <= 30, $"Принято {created} из 60 за секунду при лимите 20 — счётчик не общий для двух экземпляров?");
        Assert.True(created >= 10, $"Принято всего {created}: лимит слишком строгий");

        var boris = await _app.User("boris");
        var borisAcc = await boris.OwnAccount(_admin, 1000m);
        Api.Status(HttpStatusCode.Created, await boris.Http.Post("/orders", new { accountId = borisAcc, ticker = "SBER", side = "buy", price = 10m, qty = 1 }), "другой пользователь не страдает от чужого лимита");

        await Task.Delay(1500);
        Api.Status(HttpStatusCode.Created, await anna.Http.Post("/orders", new { accountId = acc, ticker = "SBER", side = "buy", price = 10m, qty = 1 }), "лимит отпустил через секунду");
    }

    [Fact(DisplayName = "Э7.09 Ключ идемпотентности: повтор заявки не создаёт вторую")]
    public async Task Idempotency()
    {
        using var twin = _app.Twin();
        var anna = await _app.User("anna");
        var acc = await anna.OwnAccount(_admin, 10_000m);
        HttpClient[] servers = [anna.Http, twin.WithToken(anna.Access)];
        var key = Guid.NewGuid().ToString();

        async Task<(HttpStatusCode Status, JsonElement Body)> Send(HttpClient http, decimal price)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "/orders") { Content = System.Net.Http.Json.JsonContent.Create(new { accountId = acc, ticker = "SBER", side = "buy", price, qty = 1 }) };
            req.Headers.Add("Idempotency-Key", key);
            using var res = await http.SendAsync(req);
            var text = await res.Content.ReadAsStringAsync();
            return (res.StatusCode, string.IsNullOrEmpty(text) ? default : JsonDocument.Parse(text).RootElement.Clone());
        }

        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => Send(servers[i % 2], 100m)));
        Assert.All(results, r => Assert.Equal(HttpStatusCode.Created, r.Status));
        Assert.Single(results.Select(r => r.Body.Id()).Distinct());
        Assert.Single((await anna.Http.Get($"/accounts/{acc}/orders")).Body.EnumerateArray());
        Assert.Equal(100m, (await anna.Http.AccountState(acc)).Dec("reservedCash"));
        Api.Status(HttpStatusCode.UnprocessableEntity, await Send(anna.Http, 101m), "тот же ключ, другая заявка");
    }

    [Fact(DisplayName = "Э7.10 Подбор пароля: после 5 неудачных попыток вход временно закрыт")]
    public async Task BruteForce()
    {
        var anon = _app.Anonymous();
        await _app.User("anna");
        for (var i = 0; i < 5; i++) await anon.Post("/auth/login", new { login = "anna", password = $"guess-{i}" });
        var r = await anon.Post("/auth/login", new { login = "anna", password = "Passw0rd!long" });
        Api.Status(HttpStatusCode.TooManyRequests, r, "шестая попытка с верным паролем во время блокировки");
        await _app.User("boris"); // другой логин не заблокирован
    }
}

/// <summary>Вход в терминале.</summary>
public class Stage07WebTests : IAsyncLifetime
{
    private ExchangeApp _app = null!;
    private IBrowserContext? _context;

    public Task InitializeAsync() => Task.CompletedTask;

    async Task<HttpClient> Start(params (string, string)[] settings)
    {
        ExchangeApp.FlushRedis();
        _app = Web.Api(ExchangeApp.With(settings));
        return _app.CreateClient();
    }

    public async Task DisposeAsync()
    {
        if (_context is not null) await _context.CloseAsync();
        _app?.Dispose();
    }

    async Task<IPage> Login(string login, string password)
    {
        var (context, page, _) = await Web.Open("/", signedIn: false);
        _context = context;
        await page.GetByTestId("login-user").FillAsync(login);
        await page.GetByTestId("login-pass").FillAsync(password);
        await page.GetByTestId("login-submit").ClickAsync();
        return page;
    }

    [Fact(DisplayName = "Э7.11 Терминал: форма входа, неверный пароль, вход в свой счёт", Timeout = 120_000)]
    public async Task SignIn()
    {
        var admin = await Start();
        var anna = await _app.User("anna");
        var acc = await anna.OwnAccount(admin, 777m);
        var (context, page, _) = await Web.Open("/", signedIn: false);
        _context = context;
        await Assertions.Expect(page.GetByTestId("login-form")).ToBeVisibleAsync();
        await page.GetByTestId("login-user").FillAsync("anna");
        await page.GetByTestId("login-pass").FillAsync("неверный");
        await page.GetByTestId("login-submit").ClickAsync();
        await Assertions.Expect(page.GetByTestId("login-error")).ToBeVisibleAsync();
        await page.GetByTestId("login-pass").FillAsync("Passw0rd!long");
        await page.GetByTestId("login-submit").ClickAsync();
        await Web.Eventually(async () => await page.GetByTestId("cash").Value() == 777m, "терминал своего счёта после входа");
        var stored = await page.EvaluateAsync<string>("localStorage.getItem('exchange.auth') ?? ''");
        Assert.Contains("refreshToken", stored);
        _ = acc;
    }

    [Fact(DisplayName = "Э7.12 Выход возвращает к форме входа и забывает токены", Timeout = 120_000)]
    public async Task SignOut()
    {
        var admin = await Start();
        var anna = await _app.User("anna");
        await anna.OwnAccount(admin, 10m);
        var page = await Login("anna", "Passw0rd!long");
        await Web.Eventually(async () => await page.GetByTestId("cash").Value() == 10m, "вошли");
        await page.GetByTestId("logout").ClickAsync();
        await Assertions.Expect(page.GetByTestId("login-form")).ToBeVisibleAsync();
        await page.ReloadAsync();
        await Assertions.Expect(page.GetByTestId("login-form")).ToBeVisibleAsync();
    }

    [Fact(DisplayName = "Э7.13 Истёкший токен обновляется сам — заявка уходит без повторного входа", Timeout = 120_000)]
    public async Task SilentRefresh()
    {
        var admin = await Start(("Auth:AccessSeconds", "2"));
        var anna = await _app.User("anna");
        var acc = await anna.OwnAccount(admin, 1000m);
        var page = await Login("anna", "Passw0rd!long");
        await Web.Eventually(async () => await page.GetByTestId("cash").Value() == 1000m, "вошли");
        await Task.Delay(3500);
        await page.GetByTestId("side-buy").ClickAsync();
        await page.GetByTestId("order-price").FillAsync("100");
        await page.GetByTestId("order-qty").FillAsync("1");
        await page.GetByTestId("order-submit").ClickAsync();
        await Assertions.Expect(page.GetByTestId("orders").GetByTestId("order").First).ToHaveAttributeAsync("data-status", "new");
        await Assertions.Expect(page.GetByTestId("login-form")).ToHaveCountAsync(0);
        // Токены в этом тесте живут 2 секунды — у админа тоже, поэтому входим заново.
        var fresh = await _app.Anonymous().Post("/auth/login", new { login = ExchangeApp.AdminLogin, password = ExchangeApp.AdminPassword });
        Assert.Single((await _app.WithToken(fresh.Body.Str("accessToken")).Get($"/accounts/{acc}/orders")).Body.EnumerateArray());
    }
}
