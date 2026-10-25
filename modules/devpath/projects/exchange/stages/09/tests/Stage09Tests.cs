using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Confluent.Kafka;

public static class Obs
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    public const string Prometheus = "http://localhost:19090";
    public const string Grafana = "http://localhost:13000";
    public const string Jaeger = "http://localhost:16686";

    /// <summary>Значение PromQL-выражения (сумма по всем рядам) или null, если рядов нет.</summary>
    public static async Task<double?> Query(string promql)
    {
        var json = await Http.GetStringAsync($"{Prometheus}/api/v1/query?query={Uri.EscapeDataString(promql)}");
        var result = JsonDocument.Parse(json).RootElement.GetProperty("data").GetProperty("result");
        if (result.GetArrayLength() == 0) return null;
        return result.EnumerateArray().Sum(r => double.Parse(r.GetProperty("value")[1].GetString()!, CultureInfo.InvariantCulture));
    }

    public static async Task WaitMetric(string promql, Func<double, bool> ok, string what, int ms = 30_000) =>
        await Web.Eventually(async () => await Query(promql) is { } v && ok(v), $"{what} (PromQL: {promql})", ms);

    public static async Task<JsonElement> Get(string url) => JsonDocument.Parse(await Http.GetStringAsync(url)).RootElement.Clone();

    public static async Task Post(string url) => (await Http.PostAsync(url, null)).EnsureSuccessStatusCode();
}

public class Stage09Tests : IDisposable
{
    private readonly ExchangeApp _app;
    private readonly HttpClient _http;
    private string Instance => $"service_instance_id=\"{_app.Database}\"";

    public Stage09Tests()
    {
        ExchangeApp.FlushRedis();
        _app = new ExchangeApp();
        _http = _app.CreateClient();
    }

    public void Dispose() => _app.Dispose();

    async Task Trade(string ticker, decimal price, int qty, string? traceparent = null)
    {
        var seller = await _http.Account("Продавец", 0, (ticker, qty));
        var buyer = await _http.Account("Покупатель", 1_000_000m);
        await _http.Order(seller, ticker, "sell", price, qty);
        using var req = new HttpRequestMessage(HttpMethod.Post, "/orders") { Content = System.Net.Http.Json.JsonContent.Create(new { accountId = buyer, ticker, side = "buy", price, qty }) };
        if (traceparent is not null) req.Headers.Add("traceparent", traceparent);
        (await _http.SendAsync(req)).EnsureSuccessStatusCode();
    }

    [Fact(DisplayName = "Э9.01 Метрики заявок и сделок доходят до Prometheus", Timeout = 120_000)]
    public async Task OrderMetrics()
    {
        var acc = await _http.Account("Аня", 100_000m, ("SBER", 10));
        for (var i = 0; i < 3; i++) await _http.Order(acc, "SBER", "buy", 290m + i, 1);
        await _http.Order(acc, "SBER", "sell", 290m, 1); // сделка со своей же покупкой по 292
        await Obs.WaitMetric($"sum(exchange_orders_total{{{Instance},side=\"buy\",ticker=\"SBER\"}})", v => v == 3, "3 заявки на покупку SBER");
        await Obs.WaitMetric($"sum(exchange_orders_total{{{Instance},side=\"sell\"}})", v => v == 1, "1 заявка на продажу");
        await Obs.WaitMetric($"sum(exchange_trades_total{{{Instance},ticker=\"SBER\"}})", v => v >= 1, "счётчик сделок SBER");
    }

    [Fact(DisplayName = "Э9.02 Время сведения — гистограмма, по ней считается p99", Timeout = 120_000)]
    public async Task MatchHistogram()
    {
        var acc = await _http.Account("Аня", 100_000m);
        for (var i = 0; i < 5; i++) await _http.Order(acc, "GAZP", "buy", 100m + i, 1);
        await Obs.WaitMetric($"sum(exchange_match_duration_seconds_count{{{Instance}}})", v => v >= 5, "5 измерений времени сведения");
        await Obs.WaitMetric($"histogram_quantile(0.99, sum by (le) (exchange_match_duration_seconds_bucket{{{Instance}}}))", v => v > 0 && v < 10, "p99 времени сведения");
    }

    [Fact(DisplayName = "Э9.03 HTTP-метрики сервера с маршрутом", Timeout = 120_000)]
    public async Task HttpMetrics()
    {
        await _http.Get("/instruments");
        var acc = await _http.Account("Аня", 1000m);
        await _http.Order(acc, "SBER", "buy", 100m, 1);
        await Obs.WaitMetric($"sum(http_server_request_duration_seconds_count{{{Instance},http_route=\"/orders\"}})", v => v >= 1, "запросы POST /orders в http_server_request_duration_seconds");
    }

    [Fact(DisplayName = "Э9.04 Один трейс от HTTP-запроса через outbox и Kafka до потребителя свечей", Timeout = 120_000)]
    public async Task TraceThroughKafka()
    {
        var traceId = ActivityTraceId.CreateRandom().ToHexString();
        await Trade("LKOH", 7000m, 2, $"00-{traceId}-{ActivitySpanId.CreateRandom().ToHexString()}-01");

        // Контекст трейса едет в заголовке сообщения Kafka.
        using (var consumer = new ConsumerBuilder<string?, string>(new ConsumerConfig
        {
            BootstrapServers = ExchangeApp.Kafka, GroupId = "hub-trace-" + Guid.NewGuid().ToString("N"), AutoOffsetReset = AutoOffsetReset.Earliest, EnableAutoCommit = false,
        }).Build())
        {
            consumer.Subscribe(_app.TradesTopic);
            string? header = null;
            var until = DateTime.UtcNow.AddSeconds(20);
            while (header is null && DateTime.UtcNow < until)
            {
                var r = consumer.Consume(500);
                if (r?.Message?.Headers?.TryGetLastBytes("traceparent", out var bytes) == true) header = Encoding.UTF8.GetString(bytes);
            }
            Assert.True(header?.Contains(traceId) == true, $"В заголовке traceparent сообщения Kafka нет trace id запроса: {header ?? "(заголовка нет)"}");
        }

        JsonElement spans = default;
        await Web.Eventually(async () =>
        {
            try
            {
                var t = await Obs.Get($"{Obs.Jaeger}/api/traces/{traceId}");
                spans = t.GetProperty("data")[0].GetProperty("spans");
                var kinds = spans.EnumerateArray().Select(s => s.GetProperty("tags").EnumerateArray().FirstOrDefault(x => x.GetProperty("key").GetString() == "span.kind"))
                    .Where(x => x.ValueKind == JsonValueKind.Object).Select(x => x.GetProperty("value").GetString()).ToHashSet();
                return kinds.Contains("server") && kinds.Contains("consumer");
            }
            catch (HttpRequestException) { return false; }
        }, "в Jaeger трейс со span'ом HTTP-сервера и span'ом потребителя Kafka", 30_000);
    }

    [Fact(DisplayName = "Э9.05 Логи структурные: свойства, а не склеенные строки", Timeout = 60_000)]
    public async Task StructuredLogs()
    {
        var acc = await _http.Account("Аня", 1000m);
        var order = await _http.Order(acc, "SBER", "buy", 100m, 1);
        await Web.Eventually(() => Task.FromResult(_app.Logs.Entries.Any(e =>
            e.Properties.TryGetValue("OrderId", out var v) && v?.ToString() == order.Id())),
            "запись лога о заявке со свойством OrderId (шаблон \"… {OrderId} …\", а не интерполяция строки)", 5000);
    }

    [Fact(DisplayName = "Э9.06 Health checks: live — процесс жив, ready — зависимости доступны", Timeout = 180_000)]
    public async Task Health()
    {
        Api.Status(HttpStatusCode.OK, await _http.Get("/health/live"), "/health/live");
        Api.Status(HttpStatusCode.OK, await _http.Get("/health/ready"), "/health/ready");
        Bus.Compose("stop redis");
        try
        {
            await Web.Eventually(async () => (await _http.Get("/health/ready")).Status == HttpStatusCode.ServiceUnavailable, "ready = 503 без Redis", 15_000);
            Api.Status(HttpStatusCode.OK, await _http.Get("/health/live"), "live остаётся 200 — процесс жив, перезапускать не надо");
        }
        finally
        {
            Bus.Compose("up -d --wait redis");
        }
        await Web.Eventually(async () => (await _http.Get("/health/ready")).Status == HttpStatusCode.OK, "ready снова 200", 20_000);
    }

    [Fact(DisplayName = "Э9.07 Дашборд «Биржа» в Grafana: заявки и p99 сведения", Timeout = 60_000)]
    public async Task Dashboard()
    {
        // Дашборд — код в репозитории (observability/dashboards/*.json), а Grafana загружает его сама (provisioning).
        var dir = Path.Combine(Web.Root, "observability", "dashboards");
        var mine = Directory.Exists(dir)
            ? Directory.GetFiles(dir, "*.json").Select(f => JsonDocument.Parse(File.ReadAllText(f)).RootElement.Clone())
                .FirstOrDefault(d => d.TryGetProperty("title", out var t) && t.GetString()?.Contains("Биржа") == true)
            : default;
        Assert.True(mine.ValueKind == JsonValueKind.Object, "Нет файла дашборда с «Биржа» в названии в observability/dashboards/*.json");
        Assert.True(mine.TryGetProperty("uid", out var uidProp), "У дашборда нет uid — без него Grafana не сможет стабильно на него ссылаться");
        var text = mine.GetRawText();
        Assert.True(text.Contains("exchange_orders_total"), "На дашборде нет панели по exchange_orders_total");
        Assert.True(text.Contains("histogram_quantile"), "На дашборде нет перцентиля (histogram_quantile) времени сведения");

        var uid = uidProp.GetString();
        await Web.Eventually(async () =>
        {
            try { return (await Obs.Get($"{Obs.Grafana}/api/dashboards/uid/{uid}")).GetProperty("dashboard").GetProperty("title").GetString()?.Contains("Биржа") == true; }
            catch (HttpRequestException) { return false; }
        }, $"Grafana загрузила дашборд uid={uid}", 20_000);
    }

    [Fact(DisplayName = "Э9.08 Алерты Prometheus по метрикам биржи", Timeout = 60_000)]
    public async Task Alerts()
    {
        await Obs.Post($"{Obs.Prometheus}/-/reload"); // подхватить observability/*.yml
        await Web.Eventually(async () =>
        {
            var rules = await Obs.Get($"{Obs.Prometheus}/api/v1/rules?type=alert");
            return rules.GetProperty("data").GetProperty("groups").EnumerateArray()
                .SelectMany(g => g.GetProperty("rules").EnumerateArray())
                .Any(r => r.GetProperty("query").GetString()?.Contains("exchange_") == true);
        }, "хотя бы одно правило алерта по метрикам exchange_* (observability/alerts.yml)", 15_000);
    }
}
