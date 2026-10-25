using Exchange.Api;
using Exchange.Api.Matching;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<ExchangeDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Exchange")));
builder.Services.AddProblemDetails();
// Сведение — по одной заявке за раз: проще всего доказать, что деньги не теряются. Узкое место разберём на этапе 3.
builder.Services.AddSingleton(new SemaphoreSlim(1, 1));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<ExchangeDb>().Database.EnsureCreated();

app.MapGet("/", () => "Биржа работает");

app.MapGet("/instruments", async (ExchangeDb db) =>
    await db.Instruments.OrderBy(i => i.Ticker).Select(i => new { i.Ticker, i.Name, i.Tick }).ToListAsync());

app.MapPost("/accounts", async (CreateAccount req, ExchangeDb db) =>
{
    if (string.IsNullOrWhiteSpace(req.Name)) return Invalid("name", "Нужно имя");
    var acc = new Account { Name = req.Name.Trim() };
    db.Accounts.Add(acc);
    await db.SaveChangesAsync();
    return Results.Created($"/accounts/{acc.Id}", View(acc));
});

app.MapGet("/accounts/{id:guid}", async (Guid id, ExchangeDb db) =>
    await db.Accounts.Include(a => a.Positions).FirstOrDefaultAsync(a => a.Id == id) is { } acc ? Results.Ok(View(acc)) : Results.NotFound());

app.MapPost("/accounts/{id:guid}/deposit", async (Guid id, Deposit req, ExchangeDb db) =>
{
    if (req.Amount <= 0 || decimal.Round(req.Amount, 2) != req.Amount) return Invalid("amount", "Сумма — больше нуля, до копеек");
    var acc = await db.Accounts.Include(a => a.Positions).FirstOrDefaultAsync(a => a.Id == id);
    if (acc is null) return Results.NotFound();
    acc.Cash += req.Amount;
    await db.SaveChangesAsync();
    return Results.Ok(View(acc));
});

app.MapPost("/accounts/{id:guid}/securities", async (Guid id, DepositSecurities req, ExchangeDb db) =>
{
    if (req.Qty <= 0) return Invalid("qty", "Количество — больше нуля");
    if (!await db.Instruments.AnyAsync(i => i.Ticker == req.Ticker)) return Invalid("ticker", "Нет такого инструмента");
    var acc = await db.Accounts.Include(a => a.Positions).FirstOrDefaultAsync(a => a.Id == id);
    if (acc is null) return Results.NotFound();
    var pos = acc.Positions.FirstOrDefault(p => p.Ticker == req.Ticker);
    if (pos is null) acc.Positions.Add(pos = new Position { AccountId = acc.Id, Ticker = req.Ticker });
    pos.Qty += req.Qty;
    await db.SaveChangesAsync();
    return Results.Ok(View(acc));
});

app.MapPost("/orders", async (PlaceOrder req, ExchangeDb db, SemaphoreSlim gate) =>
{
    var errors = new Dictionary<string, string[]>();
    if (req.Side is not ("buy" or "sell")) errors["side"] = ["buy или sell"];
    if (req.Qty <= 0) errors["qty"] = ["Количество — больше нуля"];
    var instrument = await db.Instruments.FindAsync(req.Ticker ?? "");
    if (instrument is null) errors["ticker"] = ["Нет такого инструмента"];
    else if (req.Price <= 0 || req.Price % instrument.Tick != 0) errors["price"] = [$"Цена — больше нуля и кратна {instrument.Tick}"];
    if (errors.Count > 0) return Results.ValidationProblem(errors);

    await gate.WaitAsync();
    try
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var acc = await db.Accounts.Include(a => a.Positions).FirstOrDefaultAsync(a => a.Id == req.AccountId);
        if (acc is null) return Results.NotFound();

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

        // Встречные заявки, которые могут пересечься по цене.
        var opposite = req.Side == "buy" ? "sell" : "buy";
        var candidates = await db.Orders
            .Where(o => o.Ticker == order.Ticker && o.Side == opposite && (o.Status == "new" || o.Status == "partial"))
            .Where(o => req.Side == "buy" ? o.Price <= order.Price : o.Price >= order.Price)
            .ToListAsync();
        var incoming = new BookOrder(order.Id, Parse(order.Side), order.Price, order.Qty, long.MaxValue);
        var resting = candidates.Select(o => new BookOrder(o.Id, Parse(o.Side), o.Price, o.Qty - o.Filled, o.Seq)).ToList();
        var fills = Matcher.Match(incoming, resting);

        foreach (var f in fills)
        {
            var other = candidates.First(o => o.Id == f.RestingId);
            var (buy, sell) = order.Side == "buy" ? (order, other) : (other, order);
            await Settle(db, buy, sell, f.Price, f.Qty);
            other.Filled += f.Qty;
            order.Filled += f.Qty;
            other.Status = other.Filled == other.Qty ? "filled" : "partial";
            db.Trades.Add(new Trade { Ticker = order.Ticker, Price = f.Price, Qty = f.Qty, BuyOrderId = buy.Id, SellOrderId = sell.Id });
            // Сделки сохраняем по одной, чтобы порядковый номер шёл в порядке исполнения.
            await db.SaveChangesAsync();
        }
        if (order.Filled > 0) order.Status = order.Filled == order.Qty ? "filled" : "partial";
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Created($"/orders/{order.Id}", order);
    }
    finally
    {
        gate.Release();
    }
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

app.MapGet("/trades", async (string ticker, ExchangeDb db) =>
    await db.Trades.Where(t => t.Ticker == ticker).OrderByDescending(t => t.Seq).Take(100).ToListAsync());

app.MapGet("/orders/{id:guid}", async (Guid id, ExchangeDb db) =>
    await db.Orders.FindAsync(id) is { } o ? Results.Ok(o) : Results.NotFound());

app.MapDelete("/orders/{id:guid}", async (Guid id, ExchangeDb db, SemaphoreSlim gate) =>
{
    await gate.WaitAsync();
    try
    {
        return await Cancel(id, db);
    }
    finally
    {
        gate.Release();
    }
});

app.Run();

static async Task<IResult> Cancel(Guid id, ExchangeDb db)
{
    var order = await db.Orders.FindAsync(id);
    if (order is null) return Results.NotFound();
    if (order.Status is not ("new" or "partial")) return Results.Problem("Заявка уже не активна", statusCode: 409);
    var acc = await db.Accounts.Include(a => a.Positions).FirstAsync(a => a.Id == order.AccountId);
    var rest = order.Qty - order.Filled;
    if (order.Side == "buy") acc.ReservedCash -= order.Price * rest;
    else acc.Positions.First(p => p.Ticker == order.Ticker).Reserved -= rest;
    order.Status = "cancelled";
    await db.SaveChangesAsync();
    return Results.Ok(order);
}

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
