using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging;
using Npgsql;

// Тесты хаба меняют переменные окружения и поднимают приложение целиком — по одному за раз.
[assembly: CollectionBehavior(DisableTestParallelization = true)]

/// <summary>
/// Приложение биржи в памяти со своей чистой базой в PostgreSQL из infra/docker-compose.yml.
/// База создаётся самим приложением при старте (миграции) и удаляется после тестов.
/// </summary>
public sealed class ExchangeApp : WebApplicationFactory<Program>
{
    public const string Postgres = "Host=localhost;Port=15432;Username=exchange;Password=exchange";

    public string Database { get; }
    public string ConnectionString => $"{Postgres};Database={Database}";
    private bool _owner;

    public ExchangeApp() : this("exchange_t" + Guid.NewGuid().ToString("N")[..12], owner: true) { }

    /// <summary>Redis из infra/docker-compose.yml (с этапа 4).</summary>
    public const string Redis = "localhost:16379";

    /// <summary>Kafka из infra/docker-compose.yml (с этапа 8).</summary>
    public const string Kafka = "localhost:19092";

    public string TradesTopic => _settings["Kafka:TradesTopic"];

    /// <summary>
    /// Чистый Redis перед тестом (с этапа 4). Своя база у каждого теста новая, и версии котировок в ней начинаются заново —
    /// старая котировка в Redis с большей версией иначе «победила» бы новую.
    /// </summary>
    public static void FlushRedis()
    {
        using var redis = StackExchange.Redis.ConnectionMultiplexer.Connect($"{Redis},allowAdmin=true");
        redis.GetServer(Redis).FlushDatabase();
    }

    /// <summary>
    /// То же, но молча, если Redis ещё нет (этапы 1–3). Новая база — чистый кэш: иначе кэш с версиями от прошлой базы
    /// «перебивает» свежие данные (сделал бы и в жизни, пересоздавая базу).
    /// </summary>
    private static void FlushRedisIfRunning()
    {
        try
        {
            using var tcp = new System.Net.Sockets.TcpClient();
            if (!tcp.ConnectAsync("localhost", 16379).Wait(300) || !tcp.Connected) return;
        }
        catch (Exception) { return; }
        try { FlushRedis(); } catch (Exception) { }
    }

    /* С этапа 7 у API есть вход. Тестам он передаёт администратора и ключ подписи через настройки. */
    public const string AdminLogin = "admin";
    public const string AdminPassword = "Hub-Admin-Passw0rd!";
    public const string SigningKey = "devpath-hub-tests-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz";

    private readonly Dictionary<string, string> _settings;
    private static readonly HashSet<string> SetByTests = [];

    /// <summary>Второй запуск на той же базе — «перезапуск сервера».</summary>
    public ExchangeApp Restart() => new(Database, owner: false, _settings);

    /// <summary>Второй экземпляр API на той же базе, работающий одновременно с первым (как за балансировщиком).</summary>
    public ExchangeApp Twin() => new(Database, owner: false, _settings);

    /// <summary>Новый экземпляр на той же базе, который теперь отвечает за её удаление: этот можно остановить, база останется.</summary>
    public ExchangeApp HandOver()
    {
        _owner = false;
        return new(Database, owner: true, _settings);
    }

    /// <summary>Приложение со своими настройками поверх стандартных (например, Auth:AccessSeconds).</summary>
    public static ExchangeApp With(params (string Key, string Value)[] settings) =>
        new("exchange_t" + Guid.NewGuid().ToString("N")[..12], owner: true, settings.ToDictionary(x => x.Key, x => x.Value));

    private ExchangeApp(string database, bool owner, Dictionary<string, string>? extra = null)
    {
        Database = database;
        _owner = owner;
        if (owner && extra is null) FlushRedisIfRunning();
        _settings = new Dictionary<string, string>
        {
            ["ConnectionStrings:Exchange"] = ConnectionString,
            ["ConnectionStrings:Redis"] = Redis,
            ["Auth:AdminLogin"] = AdminLogin,
            ["Auth:AdminPassword"] = AdminPassword,
            ["Auth:SigningKey"] = SigningKey,
            // С этапа 8: свой топик и своя группа потребителей у каждой тестовой базы — события тестов не смешиваются.
            ["ConnectionStrings:Kafka"] = Kafka,
            ["Kafka:TradesTopic"] = $"exchange.trades.{database}",
            ["Kafka:CandlesGroup"] = $"exchange.candles.{database}",
            // С этапа 9: стандартные переменные OpenTelemetry. Свой service.instance.id — метрики тестов не смешиваются.
            ["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:14318",
            ["OTEL_EXPORTER_OTLP_PROTOCOL"] = "http/protobuf",
            ["OTEL_METRIC_EXPORT_INTERVAL"] = "1000",
            ["OTEL_BSP_SCHEDULE_DELAY"] = "500",
            ["OTEL_SERVICE_NAME"] = "exchange-api",
            ["OTEL_RESOURCE_ATTRIBUTES"] = $"service.instance.id={database}",
        };
        foreach (var (k, v) in extra ?? []) _settings[k] = v;
        // Приложение может читать настройки ещё до Build() — переменные окружения видны сразу.
        // Настройки прошлого приложения, которых у этого нет, убираем.
        foreach (var k in SetByTests.Except(_settings.Keys).ToList()) Environment.SetEnvironmentVariable(k.Replace(":", "__"), null);
        foreach (var (k, v) in _settings)
        {
            Environment.SetEnvironmentVariable(k.Replace(":", "__"), v);
            SetByTests.Add(k);
        }
    }

    /// <summary>Всё, что приложение написало в лог (этап 9: структурные логи).</summary>
    public CapturedLogs Logs { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        foreach (var (k, v) in _settings) builder.UseSetting(k, v);
        builder.ConfigureLogging(l => l.AddProvider(Logs));
    }

    private bool _resolvingAdmin;
    private bool _adminResolved;

    /// <summary>
    /// Токен администратора, если в API уже есть вход (этап 7+), иначе null.
    /// Им пользуются клиенты тестов прошлых этапов, чтобы старые проверки работали и после появления авторизации.
    /// </summary>
    public string? AdminToken { get; private set; }

    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        if (_resolvingAdmin) return;
        if (!_adminResolved)
        {
            _resolvingAdmin = true;
            try
            {
                using var raw = CreateClient();
                var res = raw.PostAsJsonAsync("/auth/login", new { login = AdminLogin, password = AdminPassword }).GetAwaiter().GetResult();
                if (res.IsSuccessStatusCode)
                    AdminToken = JsonDocument.Parse(res.Content.ReadAsStringAsync().GetAwaiter().GetResult()).RootElement.GetProperty("accessToken").GetString();
            }
            catch (Exception) { }
            finally
            {
                _resolvingAdmin = false;
                _adminResolved = true;
                Web.AdminToken = AdminToken;
            }
        }
        if (AdminToken is not null) client.DefaultRequestHeaders.Authorization = new("Bearer", AdminToken);
    }

    /// <summary>Клиент без токена — как посторонний человек.</summary>
    public HttpClient Anonymous()
    {
        var c = CreateClient();
        c.DefaultRequestHeaders.Authorization = null;
        return c;
    }

    /// <summary>Клиент с токеном.</summary>
    public HttpClient WithToken(string token)
    {
        var c = CreateClient();
        c.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return c;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing || !_owner) return;
        try
        {
            NpgsqlConnection.ClearAllPools();
            using var conn = new NpgsqlConnection($"{Postgres};Database=postgres");
            conn.Open();
            using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{Database}\" WITH (FORCE)", conn);
            cmd.ExecuteNonQuery();
        }
        catch
        {
            // Не удалилась — не страшно: тестовые базы с префиксом exchange_t можно стереть руками.
        }
    }
}

/// <summary>Короткие HTTP-вызовы для тестов: статус + JSON.</summary>
public static class Api
{
    public static async Task<(HttpStatusCode Status, JsonElement Body)> Send(this HttpClient http, HttpMethod method, string url, object? body = null)
    {
        using var req = new HttpRequestMessage(method, url);
        if (body is not null) req.Content = JsonContent.Create(body);
        using var res = await http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        JsonElement json = default;
        if (!string.IsNullOrWhiteSpace(text))
        {
            try { json = JsonDocument.Parse(text).RootElement.Clone(); }
            catch (JsonException) { json = JsonDocument.Parse(JsonSerializer.Serialize(text)).RootElement.Clone(); }
        }
        return (res.StatusCode, json);
    }

    public static Task<(HttpStatusCode Status, JsonElement Body)> Post(this HttpClient http, string url, object? body = null) => http.Send(HttpMethod.Post, url, body);
    public static Task<(HttpStatusCode Status, JsonElement Body)> Get(this HttpClient http, string url) => http.Send(HttpMethod.Get, url);
    public static Task<(HttpStatusCode Status, JsonElement Body)> Delete(this HttpClient http, string url) => http.Send(HttpMethod.Delete, url);

    /// <summary>Id из ответа: строкой, каким бы типом его ни отдало приложение (число, Guid).</summary>
    public static string Id(this JsonElement e) => e.GetProperty("id").ToString();

    public static decimal Dec(this JsonElement e, string name) => e.GetProperty(name).GetDecimal();
    public static int Int(this JsonElement e, string name) => e.GetProperty(name).GetInt32();
    public static string Str(this JsonElement e, string name) => e.GetProperty(name).GetString() ?? "";

    public static void Status(HttpStatusCode expected, (HttpStatusCode Status, JsonElement Body) r, string what)
    {
        if (r.Status != expected)
            throw new Xunit.Sdk.XunitException($"{what}: ожидался {(int)expected} {expected}, пришёл {(int)r.Status} {r.Status}. Ответ: {(r.Body.ValueKind == JsonValueKind.Undefined ? "(пусто)" : r.Body.ToString())}");
    }

    /// <summary>Создать счёт, пополнить деньгами и бумагами.</summary>
    public static async Task<string> Account(this HttpClient http, string name, decimal cash = 0, params (string Ticker, int Qty)[] securities)
    {
        var r = await http.Post("/accounts", new { name });
        Status(HttpStatusCode.Created, r, "POST /accounts");
        var id = r.Body.Id();
        if (cash > 0) Status(HttpStatusCode.OK, await http.Post($"/accounts/{id}/deposit", new { amount = cash }), "POST /accounts/{id}/deposit");
        foreach (var (ticker, qty) in securities)
            Status(HttpStatusCode.OK, await http.Post($"/accounts/{id}/securities", new { ticker, qty }), "POST /accounts/{id}/securities");
        return id;
    }

    public static async Task<JsonElement> AccountState(this HttpClient http, string id)
    {
        var r = await http.Get($"/accounts/{id}");
        Status(HttpStatusCode.OK, r, $"GET /accounts/{id}");
        return r.Body;
    }

    /// <summary>Позиция по бумаге: (количество, в резерве). Нет позиции — нули.</summary>
    public static (int Qty, int Reserved) Position(this JsonElement account, string ticker)
    {
        foreach (var p in account.GetProperty("positions").EnumerateArray())
            if (p.Str("ticker") == ticker) return (p.Int("qty"), p.Int("reserved"));
        return (0, 0);
    }

    public static async Task<JsonElement> Order(this HttpClient http, string accountId, string ticker, string side, decimal price, int qty)
    {
        var r = await http.Post("/orders", new { accountId, ticker, side, price, qty });
        Status(HttpStatusCode.Created, r, $"POST /orders ({side} {qty} {ticker} по {price})");
        return r.Body;
    }
}

/// <summary>Логи приложения в памяти: категория, текст и именованные свойства шаблона ({OrderId} и т. п.).</summary>
public sealed class CapturedLogs : ILoggerProvider
{
    public record Entry(string Category, LogLevel Level, string Message, IReadOnlyDictionary<string, object?> Properties);

    private readonly List<Entry> _entries = [];

    public IReadOnlyList<Entry> Entries
    {
        get { lock (_entries) return [.. _entries]; }
    }

    public ILogger CreateLogger(string category) => new Logger(this, category);

    public void Dispose() { }

    private sealed class Logger(CapturedLogs owner, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => level >= LogLevel.Information;

        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? e, Func<TState, Exception?, string> format)
        {
            if (!IsEnabled(level)) return;
            var props = state is IEnumerable<KeyValuePair<string, object?>> kv
                ? kv.Where(p => p.Key != "{OriginalFormat}").GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.First().Value)
                : new Dictionary<string, object?>();
            lock (owner._entries)
            {
                if (owner._entries.Count < 20_000) owner._entries.Add(new Entry(category, level, format(state, e), props));
            }
        }
    }
}
