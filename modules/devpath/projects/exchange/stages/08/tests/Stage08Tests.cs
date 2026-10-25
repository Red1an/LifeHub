using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Confluent.Kafka;

public static class Bus
{
    /// <summary>Все сообщения топика с начала (своя группа — ничего не «съедаем» у приложения).</summary>
    public static List<(string? Key, JsonElement Value)> Read(string topic, Func<List<(string? Key, JsonElement Value)>, bool> enough, int timeoutMs = 15_000)
    {
        using var consumer = new ConsumerBuilder<string?, string>(new ConsumerConfig
        {
            BootstrapServers = ExchangeApp.Kafka,
            GroupId = "hub-reader-" + Guid.NewGuid().ToString("N"),
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,
            AllowAutoCreateTopics = false,
        }).Build();
        consumer.Subscribe(topic);
        var list = new List<(string?, JsonElement)>();
        var until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < until && !enough(list))
        {
            try
            {
                var r = consumer.Consume(500);
                if (r?.Message is null) continue;
                list.Add((r.Message.Key, JsonDocument.Parse(r.Message.Value).RootElement.Clone()));
            }
            catch (ConsumeException e) when (e.Error.Code == ErrorCode.UnknownTopicOrPart) { Thread.Sleep(300); }
        }
        consumer.Close();
        return list;
    }

    public static void Produce(string topic, string key, string json)
    {
        using var p = new ProducerBuilder<string, string>(new ProducerConfig { BootstrapServers = ExchangeApp.Kafka }).Build();
        p.Produce(topic, new Message<string, string> { Key = key, Value = json });
        p.Flush(TimeSpan.FromSeconds(10));
    }

    public static string TradeId(this JsonElement e) => e.GetProperty("tradeId").ToString();

    /// <summary>docker compose для инфраструктуры проекта (остановить или поднять брокер посреди теста).</summary>
    public static void Compose(string args)
    {
        var file = Path.Combine(Web.Root, "infra", "docker-compose.yml");
        using var p = Process.Start(new ProcessStartInfo("docker", $"compose -f \"{file}\" {args}") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
        p.WaitForExit(120_000);
        if (p.ExitCode != 0) throw new Xunit.Sdk.XunitException($"docker compose {args}: {p.StandardError.ReadToEnd()}");
    }
}

public class Stage08Tests : IDisposable
{
    private readonly ExchangeApp _app;
    private readonly HttpClient _http;

    public Stage08Tests()
    {
        ExchangeApp.FlushRedis();
        _app = new ExchangeApp();
        _http = _app.CreateClient();
    }

    public void Dispose() => _app.Dispose();

    /// <summary>n сделок по тикеру: продавец выставляет, покупатели забирают по одной штуке по разным ценам.</summary>
    async Task<List<JsonElement>> Trades(string ticker, params decimal[] prices)
    {
        var seller = await _http.Account("Продавец", 0, (ticker, prices.Length * 10));
        var buyer = await _http.Account("Покупатель", 1_000_000m);
        foreach (var (price, i) in prices.Select((p, i) => (p, i)))
        {
            await _http.Order(seller, ticker, "sell", price, i + 1);
            await _http.Order(buyer, ticker, "buy", price, i + 1);
        }
        var r = await _http.Get($"/trades?ticker={ticker}");
        return r.Body.EnumerateArray().Reverse().ToList();
    }

    /// <summary>
    /// Все минутные свечи инструмента, сложенные в одну (сделки теста могли попасть на стык минут):
    /// open первой, close последней, high/low — крайние, volume — сумма.
    /// </summary>
    async Task<JsonElement> Candle(string ticker, Func<JsonElement, bool> ready, string what, int ms = 15_000)
    {
        JsonElement merged = default;
        await Web.Eventually(async () =>
        {
            var r = await _http.Get($"/candles/{ticker}");
            if (r.Status != HttpStatusCode.OK) return false;
            var list = r.Body.EnumerateArray().ToList();
            if (list.Count == 0) return false;
            merged = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                start = list[0].GetProperty("start").ToString(),
                open = list[0].Dec("open"),
                high = list.Max(c => c.Dec("high")),
                low = list.Min(c => c.Dec("low")),
                close = list[^1].Dec("close"),
                volume = list.Sum(c => c.Dec("volume")),
            })).RootElement.Clone();
            return ready(merged);
        }, what, ms);
        return merged;
    }

    [Fact(DisplayName = "Э8.01 Каждая сделка уходит в Kafka: ключ — тикер, в сообщении всё о сделке", Timeout = 120_000)]
    public async Task Published()
    {
        var trades = await Trades("SBER", 300m, 301m, 302m);
        var ids = trades.Select(t => t.Id()).ToHashSet();
        var msgs = Bus.Read(_app.TradesTopic, l => ids.IsSubsetOf(l.Select(m => m.Value.TradeId())));
        Assert.True(ids.IsSubsetOf(msgs.Select(m => m.Value.TradeId())), $"В топике {_app.TradesTopic} нет всех сделок: {msgs.Count} сообщений из {ids.Count}");
        var m = msgs.First(x => x.Value.TradeId() == trades[0].Id());
        Assert.Equal("SBER", m.Key);
        Assert.Equal("SBER", m.Value.Str("ticker"));
        Assert.Equal(trades[0].Dec("price"), m.Value.Dec("price"));
        Assert.Equal(trades[0].Int("qty"), m.Value.Int("qty"));
        Assert.Equal(trades[0].GetProperty("buyOrderId").ToString(), m.Value.GetProperty("buyOrderId").ToString());
        Assert.True(m.Value.TryGetProperty("at", out _), "В сообщении нет времени сделки (at)");
    }

    [Fact(DisplayName = "Э8.02 Порядок сделок одного инструмента в топике совпадает с порядком исполнения", Timeout = 120_000)]
    public async Task Ordered()
    {
        var trades = await Trades("GAZP", 120m, 121m, 122m, 123m, 124m, 125m);
        var ids = trades.Select(t => t.Id()).ToList();
        var msgs = Bus.Read(_app.TradesTopic, l => ids.All(id => l.Any(m => m.Value.TradeId() == id)));
        var order = msgs.Where(m => m.Key == "GAZP").Select(m => m.Value.TradeId()).Distinct().ToList();
        Assert.Equal(ids, order);
    }

    [Fact(DisplayName = "Э8.03 Свечи за минуту: open, high, low, close, volume — из потока сделок", Timeout = 120_000)]
    public async Task Candles()
    {
        await Trades("LKOH", 7000m, 7050m, 6980m, 7020m);
        var c = await Candle("LKOH", x => x.Dec("volume") == 10m, "свеча с объёмом 1+2+3+4 = 10");
        Assert.Equal(7000m, c.Dec("open"));
        Assert.Equal(7050m, c.Dec("high"));
        Assert.Equal(6980m, c.Dec("low"));
        Assert.Equal(7020m, c.Dec("close"));
        Assert.True(c.TryGetProperty("start", out _), "У свечи нет начала интервала (start)");
    }

    [Fact(DisplayName = "Э8.04 Повтор события в Kafka не задваивает свечу — потребитель идемпотентный", Timeout = 120_000)]
    public async Task Duplicates()
    {
        var trades = await Trades("SBER", 300m, 310m);
        await Candle("SBER", x => x.Dec("volume") == 3m, "свеча с объёмом 3");
        var msgs = Bus.Read(_app.TradesTopic, l => l.Count >= 2);
        foreach (var m in msgs.Take(2)) Bus.Produce(_app.TradesTopic, m.Key ?? "SBER", m.Value.GetRawText());
        await Task.Delay(4000);
        var c = await Candle("SBER", _ => true, "свеча после повторов");
        Assert.Equal(3m, c.Dec("volume"));
        Assert.Equal(310m, c.Dec("high"));
        _ = trades;
    }

    [Fact(DisplayName = "Э8.05 Kafka упала: торговля идёт, события доходят, когда брокер вернулся", Timeout = 300_000)]
    public async Task BrokerDown()
    {
        await Trades("GAZP", 120m); // приложение уже подключилось к брокеру
        Bus.Compose("stop kafka");
        List<JsonElement> trades;
        try
        {
            var sw = Stopwatch.StartNew();
            trades = await Trades("GAZP", 130m, 131m, 132m);
            Assert.True(sw.ElapsedMilliseconds < 20_000, $"Сделки без брокера заняли {sw.ElapsedMilliseconds} мс — запрос ждёт Kafka?");
        }
        finally
        {
            Bus.Compose("up -d --wait kafka");
        }
        var ids = trades.Select(t => t.Id()).ToHashSet();
        var msgs = Bus.Read(_app.TradesTopic, l => ids.IsSubsetOf(l.Select(m => m.Value.TradeId())), 40_000);
        Assert.True(ids.IsSubsetOf(msgs.Select(m => m.Value.TradeId())), "Сделки, прошедшие без брокера, так и не попали в Kafka — нужен outbox");
        await Candle("GAZP", x => x.Dec("high") == 132m, "свеча догнала сделки после возвращения брокера", 30_000);
    }

    [Fact(DisplayName = "Э8.06 Два экземпляра в одной группе потребителей: каждая сделка учтена один раз", Timeout = 120_000)]
    public async Task ConsumerGroup()
    {
        using var twin = _app.Twin();
        twin.CreateClient();
        await Task.Delay(3000); // оба экземпляра вступили в группу
        await Trades("SBER", 300m, 301m, 302m, 303m);
        var c = await Candle("SBER", x => x.Dec("volume") >= 10m, "свеча с объёмом 10");
        await Task.Delay(2000);
        c = await Candle("SBER", _ => true, "свеча");
        Assert.Equal(10m, c.Dec("volume"));
    }
}
