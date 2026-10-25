using Exchange.Api;
using Exchange.Api.Matching;
using System.Diagnostics;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<ExchangeDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Exchange")));
builder.Services.AddProblemDetails();
// Без Redis приложение должно стартовать и работать (котировки из базы): abortConnect=false — подключаться в фоне.
builder.Services.AddSingleton<StackExchange.Redis.IConnectionMultiplexer>(_ =>
    StackExchange.Redis.ConnectionMultiplexer.Connect($"{builder.Configuration.GetConnectionString("Redis") ?? "localhost:16379"},abortConnect=false"));
builder.Services.AddSingleton<QuoteHub>();
// Терминал открыт с другого адреса (порт) — без CORS браузер не даст ему читать ответы API.
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://127.0.0.1:15090", "http://localhost:5173"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()));
builder.AddExchangeAuth();
builder.Services.AddSingleton(KafkaOptions.From(builder.Configuration));
builder.Services.AddHostedService<OutboxPublisher>();
builder.Services.AddHostedService<CandleConsumer>();
builder.AddExchangeTelemetry();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ExchangeDb>();
    db.Database.EnsureCreated();
    db.Database.ExecuteSqlRaw("CREATE SEQUENCE IF NOT EXISTS quote_version");
    await AuthEndpoints.EnsureAdmin(db, app.Services.GetRequiredService<AuthOptions>());
}
await app.Services.GetRequiredService<QuoteHub>().Subscribe();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseWebSockets();
app.MapAuth();
app.MapExchangeHealth();

app.MapGet("/", () => "Биржа работает");

app.MapGet("/instruments", async (ExchangeDb db) =>
    await db.Instruments.OrderBy(i => i.Ticker).Select(i => new { i.Ticker, i.Name, i.Tick }).ToListAsync());

app.MapPost("/accounts", async (CreateAccount req, ClaimsPrincipal user, ExchangeDb db) =>
{
    if (string.IsNullOrWhiteSpace(req.Name)) return Invalid("name", "Нужно имя");
    var acc = new Account { Name = req.Name.Trim(), OwnerId = Caller.From(user).Id };
    db.Accounts.Add(acc);
    await db.SaveChangesAsync();
    return Results.Created($"/accounts/{acc.Id}", View(acc));
}).RequireAuthorization();

// Чужой счёт — 404, а не 403: не подтверждаем, что такой счёт вообще существует.
app.MapGet("/accounts/{id:guid}", async (Guid id, ClaimsPrincipal user, ExchangeDb db) =>
    await db.Accounts.AsNoTracking().Include(a => a.Positions).FirstOrDefaultAsync(a => a.Id == id) is { } acc && Caller.From(user).Owns(acc)
        ? Results.Ok(View(acc))
        : Results.NotFound()).RequireAuthorization();

app.MapGet("/accounts/{id:guid}/orders", async (Guid id, ClaimsPrincipal user, ExchangeDb db) =>
    await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id) is { } acc && Caller.From(user).Owns(acc)
        ? Results.Ok(await db.Orders.AsNoTracking().Where(o => o.AccountId == id).OrderByDescending(o => o.Seq).Take(200).ToListAsync())
        : Results.NotFound()).RequireAuthorization();

app.MapPost("/accounts/{id:guid}/deposit", async (Guid id, Deposit req, ExchangeDb db) =>
{
    if (req.Amount <= 0 || decimal.Round(req.Amount, 2) != req.Amount) return Invalid("amount", "Сумма — больше нуля, до копеек");
    // Атомарно в базе: UPDATE … SET cash = cash + @amount. «Прочитать — прибавить — записать» в C# теряет пополнения.
    var changed = await db.Accounts.Where(a => a.Id == id).ExecuteUpdateAsync(s => s.SetProperty(a => a.Cash, a => a.Cash + req.Amount));
    if (changed == 0) return Results.NotFound();
    return Results.Ok(View(await db.Accounts.AsNoTracking().Include(a => a.Positions).FirstAsync(a => a.Id == id)));
}).RequireAuthorization("admin");

app.MapPost("/accounts/{id:guid}/securities", async (Guid id, DepositSecurities req, ExchangeDb db) =>
{
    if (req.Qty <= 0) return Invalid("qty", "Количество — больше нуля");
    if (!await db.Instruments.AnyAsync(i => i.Ticker == req.Ticker)) return Invalid("ticker", "Нет такого инструмента");
    return await Locked.Run(db, async () =>
    {
        if (!await Locked.Accounts(db, [id])) return Results.NotFound();
        var acc = await db.Accounts.Include(a => a.Positions).FirstAsync(a => a.Id == id);
        var pos = acc.Positions.FirstOrDefault(p => p.Ticker == req.Ticker);
        if (pos is null) acc.Positions.Add(pos = new Position { AccountId = acc.Id, Ticker = req.Ticker });
        pos.Qty += req.Qty;
        await db.SaveChangesAsync();
        return Results.Ok(View(acc));
    });
}).RequireAuthorization("admin");

app.MapPost("/orders", async (PlaceOrder req, HttpContext http, ClaimsPrincipal user, ExchangeDb db, QuoteHub quotes, StackExchange.Redis.IConnectionMultiplexer redis, KafkaOptions kafka, ILogger<Program> log) =>
{
    var caller = Caller.From(user);
    if (!await OrderRateLimit.Allow(redis, caller))
    {
        http.Response.Headers.RetryAfter = "1";
        return Results.Problem($"Не больше {OrderRateLimit.PerSecond} заявок в секунду", statusCode: 429);
    }
    var key = http.Request.Headers["Idempotency-Key"].ToString();
    if (key.Length > 100) return Invalid("Idempotency-Key", "Ключ — не длиннее 100 символов");
    var requestHash = AuthEndpoints.Sha256($"{req.AccountId}|{req.Ticker}|{req.Side}|{req.Price}|{req.Qty}");
    var errors = new Dictionary<string, string[]>();
    if (req.Side is not ("buy" or "sell")) errors["side"] = ["buy или sell"];
    if (req.Qty <= 0) errors["qty"] = ["Количество — больше нуля"];
    var instrument = await db.Instruments.FindAsync(req.Ticker ?? "");
    if (instrument is null) errors["ticker"] = ["Нет такого инструмента"];
    else if (req.Price <= 0 || req.Price % instrument.Tick != 0) errors["price"] = [$"Цена — больше нуля и кратна {instrument.Tick}"];
    if (errors.Count > 0) return Results.ValidationProblem(errors);

    Quote? quote = null;
    var trades = new List<TradeMessage>();
    Order? placed = null;
    var result = await Locked.Run(db, async () =>
    {
        trades.Clear();
        // Сведение — строго по одному на всю биржу, даже с нескольких серверов: транзакционная блокировка PostgreSQL.
        await Locked.Matching(db);
        // Повтор с тем же ключом — тот же ответ. Проверка под блокировкой сведения: два повтора с разных серверов не пройдут оба.
        if (key.Length > 0 && await db.IdempotencyRecords.AsNoTracking().FirstOrDefaultAsync(r => r.UserId == caller.Id && r.Key == key) is { } seen)
        {
            if (seen.RequestHash != requestHash) return Results.Problem("Этот ключ идемпотентности уже использован для другой заявки", statusCode: 422);
            return Results.Created($"/orders/{seen.OrderId}", await db.Orders.AsNoTracking().FirstAsync(o => o.Id == seen.OrderId));
        }
        if (!await Locked.Accounts(db, [req.AccountId])) return Results.NotFound();
        var acc = await db.Accounts.Include(a => a.Positions).FirstAsync(a => a.Id == req.AccountId);
        if (!caller.Owns(acc)) return Results.NotFound();

        if (req.Side == "buy")
        {
            var cost = req.Price * req.Qty;
            if (acc.Cash - acc.ReservedCash < cost) return Results.Problem("Не хватает свободных денег", statusCode: 409);
            acc.ReservedCash += cost;
        }
        else
        {
            var pos = acc.Positions.FirstOrDefault(p => p.Ticker == req.Ticker);
            if (pos is null || pos.Qty - pos.Reserved < req.Qty) return Results.Problem("Не хватает свободных бумаг", statusCode: 409);
            pos.Reserved += req.Qty;
        }

        var order = new Order { AccountId = acc.Id, Ticker = req.Ticker!, Side = req.Side!, Price = req.Price, Qty = req.Qty };
        db.Orders.Add(order);
        if (key.Length > 0) db.IdempotencyRecords.Add(new IdempotencyRecord { UserId = caller.Id, Key = key, RequestHash = requestHash, OrderId = order.Id });

        var opposite = req.Side == "buy" ? "sell" : "buy";
        var candidates = await db.Orders
            .Where(o => o.Ticker == order.Ticker && o.Side == opposite && (o.Status == "new" || o.Status == "partial"))
            .Where(o => req.Side == "buy" ? o.Price <= order.Price : o.Price >= order.Price)
            .ToListAsync();
        var matching = Stopwatch.StartNew();
        var incoming = new BookOrder(order.Id, Parse(order.Side), order.Price, order.Qty, long.MaxValue);
        var fills = Matcher.Match(incoming, candidates.Select(o => new BookOrder(o.Id, Parse(o.Side), o.Price, o.Qty - o.Filled, o.Seq)).ToList());

        // Счета встречных сторон блокируем до расчётов — иначе параллельное пополнение затрёт их изменения.
        await Locked.Accounts(db, fills.Select(f => candidates.First(o => o.Id == f.RestingId).AccountId));
        foreach (var f in fills)
        {
            var other = candidates.First(o => o.Id == f.RestingId);
            var (buy, sell) = order.Side == "buy" ? (order, other) : (other, order);
            await Settle(db, buy, sell, f.Price, f.Qty);
            other.Filled += f.Qty;
            order.Filled += f.Qty;
            other.Status = other.Filled == other.Qty ? "filled" : "partial";
            var trade = new Trade { Ticker = order.Ticker, Price = f.Price, Qty = f.Qty, BuyOrderId = buy.Id, SellOrderId = sell.Id };
            db.Trades.Add(trade);
            Outbox.Trade(db, kafka, trade);
            trades.Add(new TradeMessage(order.Ticker, f.Price, f.Qty));
            await db.SaveChangesAsync();
        }
        if (order.Filled > 0) order.Status = order.Filled == order.Qty ? "filled" : "partial";
        await db.SaveChangesAsync();
        Telemetry.MatchDuration.Record(matching.Elapsed.TotalSeconds, new KeyValuePair<string, object?>("ticker", order.Ticker));
        placed = order;
        // Котировку считаем ещё под блокировкой: версия и состояние стакана соответствуют порядку коммитов.
        quote = await QuoteHub.Compute(db, order.Ticker, await QuoteHub.NextVersion(db));
        return Results.Created($"/orders/{order.Id}", order);
    });
    // Публикуем только после COMMIT: клиенты не должны увидеть сделку, которая откатится.
    if (quote is not null && placed is not null && result is IStatusCodeHttpResult { StatusCode: 201 })
    {
        await quotes.Publish(quote, trades);
        // Метрики и лог — только для закоммиченной заявки. В логе — шаблон со свойствами, а не склеенная строка.
        Telemetry.Orders.Add(1, new("side", placed.Side), new("ticker", placed.Ticker));
        if (trades.Count > 0) Telemetry.Trades.Add(trades.Count, new KeyValuePair<string, object?>("ticker", placed.Ticker));
        log.LogInformation("Заявка {OrderId}: {Side} {Qty} {Ticker} по {Price}, статус {Status}, сделок {Trades}",
            placed.Id, placed.Side, placed.Qty, placed.Ticker, placed.Price, placed.Status, trades.Count);
    }
    return result;
}).RequireAuthorization();

app.MapGet("/orders/{id:guid}", async (Guid id, ClaimsPrincipal user, ExchangeDb db) =>
{
    var o = await db.Orders.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
    if (o is null) return Results.NotFound();
    var acc = await db.Accounts.AsNoTracking().FirstAsync(a => a.Id == o.AccountId);
    return Caller.From(user).Owns(acc) ? Results.Ok(o) : Results.NotFound();
}).RequireAuthorization();

app.MapDelete("/orders/{id:guid}", async (Guid id, ClaimsPrincipal user, ExchangeDb db, QuoteHub quotes) =>
{
    var caller = Caller.From(user);
    Quote? quote = null;
    var result = await Locked.Run(db, async () =>
{
    // Та же блокировка, что у сведения: отмена и исполнение одной заявки не пересекутся.
    await Locked.Matching(db);
    var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == id);
    if (order is null) return Results.NotFound();
    await Locked.Accounts(db, [order.AccountId]);
    var acc = await db.Accounts.Include(a => a.Positions).FirstAsync(a => a.Id == order.AccountId);
    if (!caller.Owns(acc)) return Results.NotFound();
    if (order.Status is not ("new" or "partial")) return Results.Problem("Заявка уже не активна", statusCode: 409);
    var rest = order.Qty - order.Filled;
    if (order.Side == "buy") acc.ReservedCash -= order.Price * rest;
    else acc.Positions.First(p => p.Ticker == order.Ticker).Reserved -= rest;
    order.Status = "cancelled";
    await db.SaveChangesAsync();
    quote = await QuoteHub.Compute(db, order.Ticker, await QuoteHub.NextVersion(db));
    return Results.Ok(order);
});
    if (quote is not null && result is IStatusCodeHttpResult { StatusCode: 200 }) await quotes.Publish(quote, []);
    return result;
}).RequireAuthorization();

app.MapGet("/quotes/{ticker}", async (string ticker, ExchangeDb db, QuoteHub quotes) =>
    await db.Instruments.AnyAsync(i => i.Ticker == ticker) ? Results.Ok(await quotes.Get(db, ticker)) : Results.NotFound());

app.Map("/ws/quotes", async (HttpContext ctx, string ticker, ExchangeDb db, QuoteHub quotes) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest) return Results.BadRequest();
    if (!await db.Instruments.AnyAsync(i => i.Ticker == ticker)) return Results.NotFound();
    await quotes.Serve(ctx, db, ticker);
    return Results.Empty;
});

app.MapGet("/orderbook/{ticker}", async (string ticker, ExchangeDb db) =>
{
    if (!await db.Instruments.AnyAsync(i => i.Ticker == ticker)) return Results.NotFound();
    var active = await db.Orders.Where(o => o.Ticker == ticker && (o.Status == "new" || o.Status == "partial"))
        .Select(o => new { o.Side, o.Price, Rest = o.Qty - o.Filled }).ToListAsync();
    object Levels(string side, bool desc)
    {
        var g = active.Where(o => o.Side == side).GroupBy(o => o.Price).Select(x => new { Price = x.Key, Qty = x.Sum(o => o.Rest) });
        return desc ? g.OrderByDescending(l => l.Price).ToList() : g.OrderBy(l => l.Price).ToList();
    }
    return Results.Ok(new { Ticker = ticker, Bids = Levels("buy", true), Asks = Levels("sell", false) });
});

app.MapGet("/candles/{ticker}", async (string ticker, ExchangeDb db) =>
    await db.Instruments.AnyAsync(i => i.Ticker == ticker)
        ? Results.Ok(await db.Candles.AsNoTracking().Where(c => c.Ticker == ticker).OrderBy(c => c.Start)
            .Select(c => new { c.Start, c.Open, c.High, c.Low, c.Close, c.Volume }).ToListAsync())
        : Results.NotFound());

app.MapGet("/trades", async (string ticker, ExchangeDb db) =>
    await db.Trades.AsNoTracking().Where(t => t.Ticker == ticker).OrderByDescending(t => t.Seq).Take(100).ToListAsync());

app.Run();

/// <summary>Расчёт по сделке: покупатель платит цену сделки, резерв снимается по цене его заявки.</summary>
static async Task Settle(ExchangeDb db, Order buy, Order sell, decimal price, int qty)
{
    var buyer = await db.Accounts.Include(a => a.Positions).FirstAsync(a => a.Id == buy.AccountId);
    var seller = await db.Accounts.Include(a => a.Positions).FirstAsync(a => a.Id == sell.AccountId);
    buyer.ReservedCash -= buy.Price * qty;
    buyer.Cash -= price * qty;
    var bpos = buyer.Positions.FirstOrDefault(p => p.Ticker == buy.Ticker);
    if (bpos is null) buyer.Positions.Add(bpos = new Position { AccountId = buyer.Id, Ticker = buy.Ticker });
    bpos.Qty += qty;
    var spos = seller.Positions.First(p => p.Ticker == sell.Ticker);
    spos.Qty -= qty;
    spos.Reserved -= qty;
    seller.Cash += price * qty;
}

static Side Parse(string side) => side == "buy" ? Side.Buy : Side.Sell;

static IResult Invalid(string field, string message) => Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

static object View(Account a) => new
{
    a.Id,
    a.Name,
    a.Cash,
    a.ReservedCash,
    Positions = a.Positions.OrderBy(p => p.Ticker).Select(p => new { p.Ticker, p.Qty, p.Reserved }),
};

record CreateAccount(string? Name);
record Deposit(decimal Amount);
record DepositSecurities(string Ticker, int Qty);
record PlaceOrder(Guid AccountId, string? Ticker, string? Side, decimal Price, int Qty);

public partial class Program;
