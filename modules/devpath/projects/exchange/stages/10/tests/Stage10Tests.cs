using System.Diagnostics;
using System.Net;
using Xunit.Abstractions;

public static class Load
{
    public static double Percentile(List<double> values, double p)
    {
        var s = values.OrderBy(x => x).ToList();
        return s.Count == 0 ? 0 : s[Math.Clamp((int)Math.Ceiling(p * s.Count) - 1, 0, s.Count - 1)];
    }

    /// <summary>Выставить заявку и замерить время ответа (мс).</summary>
    public static async Task<double> Timed(HttpClient http, string account, string ticker, string side, decimal price, int qty)
    {
        var sw = Stopwatch.StartNew();
        var r = await http.Post("/orders", new { accountId = account, ticker, side, price, qty });
        sw.Stop();
        if (r.Status != HttpStatusCode.Created) throw new Xunit.Sdk.XunitException($"Заявка под нагрузкой не прошла: {(int)r.Status} {r.Body}");
        return sw.Elapsed.TotalMilliseconds;
    }

    /// <summary>Глубокий стакан: n продаж по разным ценам, параллельно (не пересекаются — цены выше любых покупок).</summary>
    public static async Task Fill(HttpClient[] servers, string account, string ticker, int n, decimal from)
    {
        var next = -1;
        await Task.WhenAll(Enumerable.Range(0, 16).Select(async w =>
        {
            int i;
            while ((i = Interlocked.Increment(ref next)) < n)
                await Timed(servers[w % servers.Length], account, ticker, "sell", from + i % 2000 * 0.5m, 1);
        }));
    }
}

/// <summary>
/// Скорость под нагрузкой. Пороги подобраны под этот компьютер: наивное сведение (все встречные заявки из базы, одна блокировка
/// на всю биржу, по запросу на каждую сделку) их не проходит.
/// </summary>
public class Stage10Tests(ITestOutputHelper output) : IDisposable
{
    private readonly ExchangeApp _app = Start();
    private HttpClient Http => _app.CreateClient();

    private static ExchangeApp Start()
    {
        ExchangeApp.FlushRedis();
        return new ExchangeApp();
    }

    public void Dispose() => _app.Dispose();

    [Fact(DisplayName = "Э10.01 Поток: 1500 заявок с двух серверов по трём инструментам — не меньше 80 в секунду, p99 до 800 мс", Timeout = 300_000)]
    public async Task Throughput()
    {
        using var twin = _app.Twin();
        HttpClient[] servers = [Http, twin.CreateClient()];
        var tickers = new[] { "SBER", "GAZP", "LKOH" };
        var accounts = new List<string>();
        // Свой счёт у каждого потока: тест меряет движок, а не очередь на один горячий счёт.
        for (var i = 0; i < 32; i++) accounts.Add(await servers[0].Account($"Т{i}", 100_000_000m, ("SBER", 100_000), ("GAZP", 100_000), ("LKOH", 100_000)));
        // Прогрев: JIT, пулы соединений, планы запросов.
        for (var i = 0; i < 30; i++) await Load.Timed(servers[i % 2], accounts[0], tickers[i % 3], i % 2 == 0 ? "buy" : "sell", 100m, 1);

        var latencies = new System.Collections.Concurrent.ConcurrentBag<double>();
        var total = 1500;
        var next = -1;
        var sw = Stopwatch.StartNew();
        await Task.WhenAll(Enumerable.Range(0, 32).Select(async w =>
        {
            var rnd = new Random(w);
            while (Interlocked.Increment(ref next) < total)
                latencies.Add(await Load.Timed(servers[w % 2], accounts[w], tickers[rnd.Next(3)], rnd.Next(2) == 0 ? "buy" : "sell", 95m + rnd.Next(0, 11), rnd.Next(1, 5)));
        }));
        sw.Stop();
        var rps = total / sw.Elapsed.TotalSeconds;
        var p99 = Load.Percentile([.. latencies], 0.99);
        output.WriteLine($"{rps:F0} заявок/с, p50 {Load.Percentile([.. latencies], 0.5):F1} мс, p99 {p99:F1} мс");
        Assert.True(rps >= 80, $"Пропускная способность {rps:F0} заявок/с (нужно ≥ 80), p99 {p99:F0} мс");
        Assert.True(p99 <= 800, $"p99 задержки {p99:F0} мс (нужно ≤ 800), {rps:F0} заявок/с");
    }

    [Fact(DisplayName = "Э10.02 Глубокий стакан (3000 заявок) не замедляет сведение: p95 до 45 мс", Timeout = 300_000)]
    public async Task DeepBook()
    {
        HttpClient[] servers = [Http];
        var mm = await servers[0].Account("ММ", 0, ("SBER", 1_000_000));
        var buyer = await servers[0].Account("Покупатель", 1_000_000_000m);
        await Load.Fill(servers, mm, "SBER", 3000, 1000m);
        var latencies = new List<double>();
        // Каждая покупка по 5000 пересекает весь стакан, но берёт только 1 штуку — лучшую цену.
        for (var i = 0; i < 150; i++) latencies.Add(await Load.Timed(servers[0], buyer, "SBER", "buy", 5000m, 1));
        var p95 = Load.Percentile(latencies, 0.95);
        output.WriteLine($"сведение по глубокому стакану: p50 {Load.Percentile(latencies, 0.5):F1} мс, p95 {p95:F1} мс");
        Assert.True(p95 <= 45, $"p95 сведения по глубокому стакану {p95:F0} мс (нужно ≤ 45): заявка не должна читать весь стакан, чтобы взять лучшую цену");
        // 150 покупок по штуке съели по порядку уровни 1000, 1000.5, … (по две заявки на уровне): последняя сделка — по 1037.
        var trades = (await servers[0].Get("/trades?ticker=SBER")).Body.EnumerateArray().ToList();
        Assert.Equal(1037m, trades[0].Dec("price"));
    }

    [Fact(DisplayName = "Э10.03 Стакан на 3000 заявок отдаётся быстро: p95 GET /orderbook до 5 мс", Timeout = 300_000)]
    public async Task BookRead()
    {
        HttpClient[] servers = [Http];
        var mm = await servers[0].Account("ММ", 0, ("GAZP", 1_000_000));
        await Load.Fill(servers, mm, "GAZP", 3000, 200m);
        var latencies = new List<double>();
        for (var i = 0; i < 100; i++)
        {
            var sw = Stopwatch.StartNew();
            var r = await servers[0].Get("/orderbook/GAZP");
            latencies.Add(sw.Elapsed.TotalMilliseconds);
            Api.Status(HttpStatusCode.OK, r, "GET /orderbook");
        }
        var p95 = Load.Percentile(latencies, 0.95);
        output.WriteLine($"GET /orderbook: p50 {Load.Percentile(latencies, 0.5):F1} мс, p95 {p95:F1} мс");
        Assert.True(p95 <= 5, $"p95 GET /orderbook {p95:F1} мс (нужно ≤ 5): стакан не должен пересчитываться из базы на каждый запрос");
        var book = (await servers[0].Get("/orderbook/GAZP")).Body;
        Assert.Equal(2000, book.GetProperty("asks").GetArrayLength()); // 3000 заявок на 2000 уровнях цены
    }
}
