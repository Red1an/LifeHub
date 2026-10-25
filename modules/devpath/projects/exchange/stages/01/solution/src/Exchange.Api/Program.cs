using Exchange.Api;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<ExchangeDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Exchange")));
builder.Services.AddProblemDetails();

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

app.MapPost("/orders", async (PlaceOrder req, ExchangeDb db) =>
{
    var errors = new Dictionary<string, string[]>();
    if (req.Side is not ("buy" or "sell")) errors["side"] = ["buy или sell"];
    if (req.Qty <= 0) errors["qty"] = ["Количество — больше нуля"];
    var instrument = await db.Instruments.FindAsync(req.Ticker ?? "");
    if (instrument is null) errors["ticker"] = ["Нет такого инструмента"];
    else if (req.Price <= 0 || req.Price % instrument.Tick != 0) errors["price"] = [$"Цена — больше нуля и кратна {instrument.Tick}"];
    if (errors.Count > 0) return Results.ValidationProblem(errors);

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
    await db.SaveChangesAsync();
    return Results.Created($"/orders/{order.Id}", order);
});

app.MapGet("/orders/{id:guid}", async (Guid id, ExchangeDb db) =>
    await db.Orders.FindAsync(id) is { } o ? Results.Ok(o) : Results.NotFound());

app.MapDelete("/orders/{id:guid}", async (Guid id, ExchangeDb db) =>
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
});

app.Run();

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
