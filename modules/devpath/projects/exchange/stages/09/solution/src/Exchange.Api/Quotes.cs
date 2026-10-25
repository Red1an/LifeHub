using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace Exchange.Api;

/// <param name="Version">Растёт с каждым изменением стакана: старая котировка не перезапишет новую.</param>
public record Quote(string Ticker, decimal? Bid, decimal? Ask, decimal? Last, long Version)
{
    public string Type => "quote";
}

public record TradeMessage(string Ticker, decimal Price, int Qty)
{
    public string Type => "trade";
}

/// <summary>
/// Котировки: считаются из базы при каждом изменении стакана, лежат в Redis (quote:{тикер}),
/// рассылаются через Redis pub/sub всем экземплярам API, а те — своим WebSocket-клиентам.
/// </summary>
public sealed class QuoteHub(IConnectionMultiplexer redis, IHostApplicationLifetime lifetime, ILogger<QuoteHub> log)
{
    private const string Channel = "quotes";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Записать, только если версия новее, и сразу разослать — атомарно на стороне Redis.</summary>
    private const string SetIfNewer = """
        local cur = redis.call('HGET', KEYS[1], 'v')
        if (not cur) or tonumber(cur) < tonumber(ARGV[1]) then
          redis.call('HSET', KEYS[1], 'v', ARGV[1], 'json', ARGV[2])
          if ARGV[3] == '1' then redis.call('PUBLISH', KEYS[2], ARGV[2]) end
          return 1
        end
        return 0
        """;

    private readonly ConcurrentDictionary<Guid, Client> _clients = new();

    private sealed record Client(string Ticker, WebSocket Socket, SemaphoreSlim Send);

    public static async Task<Quote> Compute(ExchangeDb db, string ticker, long version)
    {
        var active = db.Orders.Where(o => o.Ticker == ticker && (o.Status == "new" || o.Status == "partial"));
        var bid = await active.Where(o => o.Side == "buy").MaxAsync(o => (decimal?)o.Price);
        var ask = await active.Where(o => o.Side == "sell").MinAsync(o => (decimal?)o.Price);
        var last = await db.Trades.Where(t => t.Ticker == ticker).OrderByDescending(t => t.Seq).Select(t => (decimal?)t.Price).FirstOrDefaultAsync();
        return new Quote(ticker, bid, ask, last, version);
    }

    /// <summary>Следующая версия котировки. Берётся под блокировкой сведения — версии растут в порядке коммитов.</summary>
    public static async Task<long> NextVersion(ExchangeDb db) =>
        (await db.Database.SqlQuery<long>($"SELECT nextval('quote_version') AS \"Value\"").ToListAsync())[0];

    /// <summary>После COMMIT: сделки и новая котировка — в Redis и всем подписчикам.</summary>
    public async Task Publish(Quote quote, IEnumerable<TradeMessage> trades)
    {
        try
        {
            var db = redis.GetDatabase();
            foreach (var t in trades) await db.PublishAsync(RedisChannel.Literal(Channel), JsonSerializer.Serialize(t, Json));
            await db.ScriptEvaluateAsync(SetIfNewer, [$"quote:{quote.Ticker}", Channel], [quote.Version, JsonSerializer.Serialize(quote, Json), "1"]);
        }
        catch (Exception e) when (e is RedisException or TimeoutException)
        {
            // Redis лежит — сделка уже в базе, котировку пересчитают при следующем запросе. Ронять заявку нельзя.
            log.LogWarning(e, "Не удалось обновить котировку {Ticker} в Redis", quote.Ticker);
        }
    }

    /// <summary>Котировка для GET и снимка подписчику: из Redis, при промахе или без Redis — из базы.</summary>
    public async Task<Quote> Get(ExchangeDb db, string ticker)
    {
        try
        {
            var json = await redis.GetDatabase().HashGetAsync($"quote:{ticker}", "json");
            if (json.HasValue) return JsonSerializer.Deserialize<Quote>(json.ToString(), Json)!;
            var fresh = await Compute(db, ticker, 0);
            await redis.GetDatabase().ScriptEvaluateAsync(SetIfNewer, [$"quote:{ticker}", Channel], [0, JsonSerializer.Serialize(fresh, Json), "0"]);
            return fresh;
        }
        catch (Exception e) when (e is RedisException or TimeoutException)
        {
            log.LogWarning(e, "Redis недоступен, котировка {Ticker} из базы", ticker);
            return await Compute(db, ticker, 0);
        }
    }

    /// <summary>Подписка экземпляра на общий канал: сообщения с любого сервера уходят нашим клиентам.</summary>
    public async Task Subscribe()
    {
        await redis.GetSubscriber().SubscribeAsync(RedisChannel.Literal(Channel), (channel, message) =>
        {
            var text = message.ToString();
            string? ticker;
            try { ticker = JsonDocument.Parse(text).RootElement.GetProperty("ticker").GetString(); }
            catch (Exception) { return; }
            foreach (var (id, c) in _clients)
                if (c.Ticker == ticker) _ = Send(id, c, text);
        });
    }

    public async Task Serve(HttpContext ctx, ExchangeDb db, string ticker)
    {
        using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
        // Соединение живёт, пока клиент не уйдёт или сервер не начнёт останавливаться — иначе остановка повиснет.
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted, lifetime.ApplicationStopping);
        var id = Guid.NewGuid();
        var client = new Client(ticker, socket, new SemaphoreSlim(1, 1));
        _clients[id] = client;
        try
        {
            await Send(id, client, JsonSerializer.Serialize(await Get(db, ticker), Json));
            var buffer = new byte[1024];
            // Клиенту нечего нам слать — просто ждём, пока он закроет соединение.
            while (socket.State == WebSocketState.Open)
            {
                if ((await socket.ReceiveAsync(buffer, stop.Token)).MessageType != WebSocketMessageType.Close) continue;
                // Закрытие — рукопожатие: клиент прислал Close и ждёт наш Close в ответ.
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                break;
            }
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException or IOException or ObjectDisposedException) { }
        finally
        {
            _clients.TryRemove(id, out _);
        }
    }

    /// <summary>Отправка одному клиенту. WebSocket не терпит две отправки одновременно — у каждого свой замок.</summary>
    private async Task Send(Guid id, Client c, string text)
    {
        await c.Send.WaitAsync();
        try
        {
            if (c.Socket.State == WebSocketState.Open)
                await c.Socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception)
        {
            _clients.TryRemove(id, out _); // оборвался — убираем, рассылка остальным идёт дальше
        }
        finally
        {
            c.Send.Release();
        }
    }
}
