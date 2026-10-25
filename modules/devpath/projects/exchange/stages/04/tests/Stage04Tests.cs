using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using StackExchange.Redis;

/// <summary>Подписка на котировки через WebSocket: копит сообщения, ждёт нужное.</summary>
public sealed class QuoteFeed : IAsyncDisposable
{
    private readonly WebSocket _ws;
    private readonly Channel<JsonElement> _messages = Channel.CreateUnbounded<JsonElement>();
    private readonly Task _loop;

    private QuoteFeed(WebSocket ws)
    {
        _ws = ws;
        _loop = Task.Run(Receive);
    }

    public static async Task<QuoteFeed> Open(ExchangeApp app, string ticker)
    {
        app.CreateClient(); // запустить сервер, если ещё не запущен
        var ws = await app.Server.CreateWebSocketClient().ConnectAsync(new Uri($"ws://localhost/ws/quotes?ticker={ticker}"), CancellationToken.None);
        return new QuoteFeed(ws);
    }

    private async Task Receive()
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (_ws.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult r;
                do
                {
                    r = await _ws.ReceiveAsync(buffer, CancellationToken.None);
                    if (r.MessageType == WebSocketMessageType.Close) return;
                    ms.Write(buffer, 0, r.Count);
                } while (!r.EndOfMessage);
                var text = Encoding.UTF8.GetString(ms.ToArray());
                try { await _messages.Writer.WriteAsync(JsonDocument.Parse(text).RootElement.Clone()); }
                catch (JsonException) { }
            }
        }
        catch (Exception) { }
        finally { _messages.Writer.TryComplete(); }
    }

    /// <summary>Первое сообщение, подходящее под условие, за отведённое время (остальные пропускаются).</summary>
    public async Task<JsonElement> WaitFor(Func<JsonElement, bool> match, string what, int ms = 3000)
    {
        using var cts = new CancellationTokenSource(ms);
        try
        {
            while (true)
            {
                var m = await _messages.Reader.ReadAsync(cts.Token);
                if (match(m)) return m;
            }
        }
        catch (Exception e) when (e is OperationCanceledException or ChannelClosedException)
        {
            throw new Xunit.Sdk.XunitException($"За {ms} мс не пришло: {what}");
        }
    }

    /// <summary>Сообщения, пришедшие за время ожидания.</summary>
    public async Task<List<JsonElement>> Drain(int ms)
    {
        await Task.Delay(ms);
        var list = new List<JsonElement>();
        while (_messages.Reader.TryRead(out var m)) list.Add(m);
        return list;
    }

    public void Abort() => _ws.Abort();

    public async ValueTask DisposeAsync()
    {
        try
        {
            // Close без ожидания ответа: тест не должен зависнуть, даже если сервер не завершит рукопожатие.
            if (_ws.State == WebSocketState.Open)
                await _ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1));
        }
        catch { }
        _ws.Abort();
        _ws.Dispose();
        await Task.WhenAny(_loop, Task.Delay(1000));
    }
}

public static class Quotes
{
    public static bool Is(this JsonElement m, string type, string ticker) =>
        m.TryGetProperty("type", out var t) && t.GetString() == type && m.TryGetProperty("ticker", out var k) && k.GetString() == ticker;

    public static decimal? Num(this JsonElement m, string name) =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : null;
}

public class Stage04Tests : IDisposable
{
    private readonly ExchangeApp _app;
    private readonly HttpClient _http;

    public Stage04Tests()
    {
        // Чистый Redis на каждый тест: котировки прошлых тестов не должны мешать.
        ExchangeApp.FlushRedis();
        _app = new ExchangeApp();
        _http = _app.CreateClient();
    }

    public void Dispose() => _app.Dispose();

    async Task<JsonElement> Quote(HttpClient http, string ticker)
    {
        var r = await http.Get($"/quotes/{ticker}");
        Api.Status(HttpStatusCode.OK, r, $"GET /quotes/{ticker}");
        return r.Body;
    }

    [Fact(DisplayName = "Э4.01 Котировка: лучшая покупка, лучшая продажа, последняя сделка")]
    public async Task QuoteBasics()
    {
        var empty = await Quote(_http, "SBER");
        Assert.Null(empty.Num("bid"));
        Assert.Null(empty.Num("ask"));
        Assert.Null(empty.Num("last"));

        var a = await _http.Account("А", 100_000m, ("SBER", 100));
        await _http.Order(a, "SBER", "buy", 299m, 1);
        await _http.Order(a, "SBER", "buy", 300m, 1);
        await _http.Order(a, "SBER", "sell", 305m, 1);
        await _http.Order(a, "SBER", "sell", 304m, 1);
        var q = await Quote(_http, "SBER");
        Assert.Equal((300m, 304m), (q.Num("bid"), q.Num("ask")));

        var b = await _http.Account("Б", 100_000m);
        await _http.Order(b, "SBER", "buy", 304m, 1);
        q = await Quote(_http, "SBER");
        Assert.Equal((300m, 305m, 304m), (q.Num("bid"), q.Num("ask"), q.Num("last")));
        Assert.Equal(HttpStatusCode.NotFound, (await _http.Get("/quotes/NOPE")).Status);
    }

    [Fact(DisplayName = "Э4.02 Котировка хранится в Redis по ключу quote:{тикер}")]
    public async Task InRedis()
    {
        var a = await _http.Account("А", 100_000m);
        await _http.Order(a, "GAZP", "buy", 120m, 1);
        await Quote(_http, "GAZP");
        using var redis = await ConnectionMultiplexer.ConnectAsync(ExchangeApp.Redis);
        Assert.True(await redis.GetDatabase().KeyExistsAsync("quote:GAZP"), "В Redis нет ключа quote:GAZP");
    }

    [Fact(DisplayName = "Э4.03 Отмена лучшей заявки сразу меняет котировку — кэш не устаревает")]
    public async Task Invalidation()
    {
        var a = await _http.Account("А", 100_000m);
        await _http.Order(a, "SBER", "buy", 299m, 1);
        var best = await _http.Order(a, "SBER", "buy", 301m, 1);
        Assert.Equal(301m, (await Quote(_http, "SBER")).Num("bid"));
        await _http.Delete($"/orders/{best.Id()}");
        Assert.Equal(299m, (await Quote(_http, "SBER")).Num("bid"));
    }

    [Fact(DisplayName = "Э4.04 WebSocket: снимок при подключении, потом сделка и новая котировка", Timeout = 30_000)]
    public async Task Feed()
    {
        var a = await _http.Account("А", 0, ("SBER", 10));
        await _http.Order(a, "SBER", "sell", 310m, 5);
        await using var feed = await QuoteFeed.Open(_app, "SBER");
        var snap = await feed.WaitFor(m => m.Is("quote", "SBER"), "снимок котировки сразу после подключения");
        Assert.Equal(310m, snap.Num("ask"));

        var b = await _http.Account("Б", 10_000m);
        await _http.Order(b, "SBER", "buy", 310m, 2);
        var trade = await feed.WaitFor(m => m.Is("trade", "SBER"), "сообщение trade о сделке");
        Assert.Equal((310m, 2m), (trade.Num("price"), trade.Num("qty")));
        await feed.WaitFor(m => m.Is("quote", "SBER") && m.Num("last") == 310m, "котировка с last = 310 после сделки");
    }

    [Fact(DisplayName = "Э4.05 Подписка по тикеру: чужие инструменты не приходят", Timeout = 30_000)]
    public async Task PerTicker()
    {
        await using var feed = await QuoteFeed.Open(_app, "GAZP");
        await feed.WaitFor(m => m.Is("quote", "GAZP"), "снимок GAZP");
        var a = await _http.Account("А", 100_000m);
        await _http.Order(a, "SBER", "buy", 300m, 1);
        var extra = await feed.Drain(800);
        Assert.DoesNotContain(extra, m => m.TryGetProperty("ticker", out var t) && t.GetString() != "GAZP");
    }

    [Fact(DisplayName = "Э4.06 Два экземпляра API: заявка на одном — подписчик другого узнаёт сразу", Timeout = 30_000)]
    public async Task AcrossInstances()
    {
        using var twin = _app.Twin();
        await using var feed = await QuoteFeed.Open(twin, "LKOH");
        await feed.WaitFor(m => m.Is("quote", "LKOH"), "снимок LKOH на втором экземпляре");
        var a = await _http.Account("А", 100_000m);
        await _http.Order(a, "LKOH", "buy", 6900m, 1);
        var q = await feed.WaitFor(m => m.Is("quote", "LKOH") && m.Num("bid") == 6900m, "котировка с bid = 6900 на втором экземпляре (рассылка через Redis pub/sub)");
        Assert.Equal(6900m, q.Num("bid"));
        Assert.Equal(6900m, (await Quote(twin.CreateClient(), "LKOH")).Num("bid"));
    }

    [Fact(DisplayName = "Э4.07 Отвалившийся клиент не ломает рассылку остальным", Timeout = 30_000)]
    public async Task DeadClient()
    {
        var dead = await QuoteFeed.Open(_app, "SBER");
        await using var alive = await QuoteFeed.Open(_app, "SBER");
        await alive.WaitFor(m => m.Is("quote", "SBER"), "снимок");
        dead.Abort();
        var a = await _http.Account("А", 100_000m);
        for (var i = 0; i < 3; i++) await _http.Order(a, "SBER", "buy", 280m + i, 1);
        await alive.WaitFor(m => m.Is("quote", "SBER") && m.Num("bid") == 282m, "котировки после обрыва другого клиента");
        await dead.DisposeAsync();
    }

    [Fact(DisplayName = "Э4.08 После параллельной нагрузки с двух серверов котировка совпадает со стаканом", Timeout = 30_000)]
    public async Task ConsistentUnderLoad()
    {
        using var twin = _app.Twin();
        HttpClient[] servers = [_http, twin.CreateClient()];
        var accounts = new List<string>();
        for (var i = 0; i < 4; i++) accounts.Add(await _http.Account($"Т{i}", 100_000m, ("SBER", 200)));
        await Task.WhenAll(Enumerable.Range(0, 6).Select(async w =>
        {
            var rnd = new Random(w);
            for (var i = 0; i < 25; i++)
                await servers[w % 2].Post("/orders", new { accountId = accounts[rnd.Next(4)], ticker = "SBER", side = rnd.Next(2) == 0 ? "buy" : "sell", price = 290m + rnd.Next(0, 21), qty = rnd.Next(1, 4) });
        }));
        await Task.Delay(300);
        var book = (await _http.Get("/orderbook/SBER")).Body;
        decimal? Best(string side) => book.GetProperty(side).EnumerateArray().Select(l => (decimal?)l.Dec("price")).FirstOrDefault();
        var trades = (await _http.Get("/trades?ticker=SBER")).Body.EnumerateArray().ToList();
        foreach (var http in servers)
        {
            var q = await Quote(http, "SBER");
            Assert.Equal(Best("bids"), q.Num("bid"));
            Assert.Equal(Best("asks"), q.Num("ask"));
            Assert.Equal(trades.Count > 0 ? trades[0].Dec("price") : null, q.Num("last"));
        }
    }
}
