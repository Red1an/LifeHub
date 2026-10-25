using System.Net;
using System.Text.Json;

public class Stage02Tests : IDisposable
{
    private readonly ExchangeApp _app = new();
    private readonly HttpClient _http;

    public Stage02Tests() => _http = _app.CreateClient();

    public void Dispose() => _app.Dispose();

    async Task<JsonElement> OrderState(JsonElement order)
    {
        var r = await _http.Get($"/orders/{order.Id()}");
        Api.Status(HttpStatusCode.OK, r, "GET /orders/{id}");
        return r.Body;
    }

    async Task<List<JsonElement>> Trades(string ticker)
    {
        var r = await _http.Get($"/trades?ticker={ticker}");
        Api.Status(HttpStatusCode.OK, r, "GET /trades");
        return r.Body.EnumerateArray().ToList();
    }

    async Task<(List<(decimal Price, int Qty)> Bids, List<(decimal Price, int Qty)> Asks)> Book(string ticker)
    {
        var r = await _http.Get($"/orderbook/{ticker}");
        Api.Status(HttpStatusCode.OK, r, "GET /orderbook/{ticker}");
        List<(decimal, int)> Levels(string side) => r.Body.GetProperty(side).EnumerateArray().Select(l => (l.Dec("price"), l.Int("qty"))).ToList();
        return (Levels("bids"), Levels("asks"));
    }

    [Fact(DisplayName = "Э2.01 Встречные заявки по одной цене исполняются целиком")]
    public async Task FullMatch()
    {
        var seller = await _http.Account("Продавец", 0, ("SBER", 10));
        var buyer = await _http.Account("Покупатель", 10_000m);
        var sell = await _http.Order(seller, "SBER", "sell", 300m, 10);
        var buy = await _http.Order(buyer, "SBER", "buy", 300m, 10);
        Assert.Equal("filled", buy.Str("status"));
        Assert.Equal("filled", (await OrderState(sell)).Str("status"));
        var trade = Assert.Single(await Trades("SBER"));
        Assert.Equal(300m, trade.Dec("price"));
        Assert.Equal(10, trade.Int("qty"));
        Assert.Equal(buy.Id(), trade.GetProperty("buyOrderId").ToString());
        Assert.Equal(sell.Id(), trade.GetProperty("sellOrderId").ToString());
    }

    [Fact(DisplayName = "Э2.02 Деньги и бумаги переходят от продавца к покупателю")]
    public async Task Settlement()
    {
        var seller = await _http.Account("Продавец", 0, ("SBER", 10));
        var buyer = await _http.Account("Покупатель", 10_000m);
        await _http.Order(seller, "SBER", "sell", 300m, 4);
        await _http.Order(buyer, "SBER", "buy", 300m, 4);
        var b = await _http.AccountState(buyer);
        var s = await _http.AccountState(seller);
        Assert.Equal(8800m, b.Dec("cash"));
        Assert.Equal(0m, b.Dec("reservedCash"));
        Assert.Equal((4, 0), b.Position("SBER"));
        Assert.Equal(1200m, s.Dec("cash"));
        Assert.Equal((6, 0), s.Position("SBER"));
    }

    [Fact(DisplayName = "Э2.03 Цена сделки — цена заявки, которая уже стояла в стакане")]
    public async Task RestingPrice()
    {
        var seller = await _http.Account("Продавец", 0, ("GAZP", 5));
        var buyer = await _http.Account("Покупатель", 1000m);
        await _http.Order(seller, "GAZP", "sell", 120m, 5);
        await _http.Order(buyer, "GAZP", "buy", 130m, 5);
        Assert.Equal(120m, Assert.Single(await Trades("GAZP")).Dec("price"));
        var b = await _http.AccountState(buyer);
        Assert.Equal(400m, b.Dec("cash"));
        Assert.Equal(0m, b.Dec("reservedCash"));
    }

    [Fact(DisplayName = "Э2.04 Частичное исполнение: остаток стоит в стакане")]
    public async Task Partial()
    {
        var seller = await _http.Account("Продавец", 0, ("SBER", 10));
        var buyer = await _http.Account("Покупатель", 10_000m);
        var sell = await _http.Order(seller, "SBER", "sell", 300m, 10);
        var buy = await _http.Order(buyer, "SBER", "buy", 300m, 3);
        Assert.Equal("filled", buy.Str("status"));
        var s = await OrderState(sell);
        Assert.Equal("partial", s.Str("status"));
        Assert.Equal(3, s.Int("filled"));
        Assert.Equal([(300m, 7)], (await Book("SBER")).Asks);
    }

    [Fact(DisplayName = "Э2.05 Сначала лучшая цена")]
    public async Task PricePriority()
    {
        var a = await _http.Account("Дорогой", 0, ("SBER", 5));
        var b = await _http.Account("Дешёвый", 0, ("SBER", 5));
        var buyer = await _http.Account("Покупатель", 10_000m);
        await _http.Order(a, "SBER", "sell", 305m, 5);
        var cheap = await _http.Order(b, "SBER", "sell", 301m, 5);
        await _http.Order(buyer, "SBER", "buy", 310m, 5);
        var trade = Assert.Single(await Trades("SBER"));
        Assert.Equal(cheap.Id(), trade.GetProperty("sellOrderId").ToString());
        Assert.Equal(301m, trade.Dec("price"));
    }

    [Fact(DisplayName = "Э2.06 При равной цене — кто раньше пришёл")]
    public async Task TimePriority()
    {
        var first = await _http.Account("Первый", 10_000m);
        var second = await _http.Account("Второй", 10_000m);
        var seller = await _http.Account("Продавец", 0, ("LKOH", 1));
        var early = await _http.Order(first, "LKOH", "buy", 7000m, 1);
        await _http.Order(second, "LKOH", "buy", 7000m, 1);
        await _http.Order(seller, "LKOH", "sell", 6900m, 1);
        var trade = Assert.Single(await Trades("LKOH"));
        Assert.Equal(early.Id(), trade.GetProperty("buyOrderId").ToString());
        Assert.Equal(7000m, trade.Dec("price"));
    }

    [Fact(DisplayName = "Э2.07 Большая заявка проходит несколько уровней стакана")]
    public async Task Sweep()
    {
        var seller = await _http.Account("Продавец", 0, ("SBER", 30));
        var buyer = await _http.Account("Покупатель", 100_000m);
        await _http.Order(seller, "SBER", "sell", 300m, 5);
        await _http.Order(seller, "SBER", "sell", 301m, 5);
        await _http.Order(seller, "SBER", "sell", 302m, 5);
        var buy = await _http.Order(buyer, "SBER", "buy", 301m, 12);
        Assert.Equal("partial", buy.Str("status"));
        Assert.Equal(10, buy.Int("filled"));
        var trades = await Trades("SBER");
        Assert.Equal(2, trades.Count);
        Assert.Equal([301m, 300m], trades.Select(t => t.Dec("price")));
        var book = await Book("SBER");
        Assert.Equal([(301m, 2)], book.Bids);
        Assert.Equal([(302m, 5)], book.Asks);
        var b = await _http.AccountState(buyer);
        Assert.Equal(100_000m - 300m * 5 - 301m * 5, b.Dec("cash"));
        Assert.Equal(301m * 2, b.Dec("reservedCash"));
    }

    [Fact(DisplayName = "Э2.08 Стакан: уровни сгруппированы, покупки по убыванию, продажи по возрастанию")]
    public async Task OrderBook()
    {
        var a = await _http.Account("А", 100_000m, ("GAZP", 100));
        var b = await _http.Account("Б", 100_000m, ("GAZP", 100));
        await _http.Order(a, "GAZP", "buy", 120m, 3);
        await _http.Order(b, "GAZP", "buy", 120m, 2);
        await _http.Order(a, "GAZP", "buy", 119.5m, 7);
        await _http.Order(a, "GAZP", "sell", 125m, 4);
        await _http.Order(b, "GAZP", "sell", 124m, 1);
        var cancelled = await _http.Order(b, "GAZP", "sell", 123m, 9);
        await _http.Delete($"/orders/{cancelled.Id()}");
        var book = await Book("GAZP");
        Assert.Equal([(120m, 5), (119.5m, 7)], book.Bids);
        Assert.Equal([(124m, 1), (125m, 4)], book.Asks);
    }

    [Fact(DisplayName = "Э2.09 Отмена частично исполненной заявки возвращает только остаток")]
    public async Task CancelPartial()
    {
        var seller = await _http.Account("Продавец", 0, ("SBER", 2));
        var buyer = await _http.Account("Покупатель", 10_000m);
        await _http.Order(seller, "SBER", "sell", 300m, 2);
        var buy = await _http.Order(buyer, "SBER", "buy", 310m, 5);
        var del = await _http.Delete($"/orders/{buy.Id()}");
        Api.Status(HttpStatusCode.OK, del, "отмена частично исполненной");
        var b = await _http.AccountState(buyer);
        Assert.Equal(10_000m - 600m, b.Dec("cash"));
        Assert.Equal(0m, b.Dec("reservedCash"));
        Assert.Empty((await Book("SBER")).Bids);
    }

    [Fact(DisplayName = "Э2.10 Деньги и бумаги не появляются из ниоткуда (200 случайных заявок)")]
    public async Task Conservation()
    {
        var rnd = new Random(2026);
        var accounts = new List<string>();
        for (var i = 0; i < 6; i++) accounts.Add(await _http.Account($"Трейдер {i}", 50_000m, ("SBER", 100)));
        var open = new List<string>();
        for (var i = 0; i < 200; i++)
        {
            var acc = accounts[rnd.Next(accounts.Count)];
            if (open.Count > 0 && rnd.Next(6) == 0)
            {
                var id = open[rnd.Next(open.Count)];
                open.Remove(id);
                await _http.Delete($"/orders/{id}");
                continue;
            }
            var side = rnd.Next(2) == 0 ? "buy" : "sell";
            var price = 290m + rnd.Next(0, 21);
            var r = await _http.Post("/orders", new { accountId = acc, ticker = "SBER", side, price, qty = rnd.Next(1, 8) });
            if (r.Status == HttpStatusCode.Created) open.Add(r.Body.Id());
            else Api.Status(HttpStatusCode.Conflict, r, "заявка либо принята, либо отклонена за нехваткой");
        }

        decimal cash = 0, reserved = 0;
        int shares = 0;
        foreach (var id in accounts)
        {
            var a = await _http.AccountState(id);
            Assert.True(a.Dec("cash") >= 0 && a.Dec("reservedCash") >= 0 && a.Dec("reservedCash") <= a.Dec("cash"), $"Счёт {id}: cash {a.Dec("cash")}, reserved {a.Dec("reservedCash")}");
            var (qty, res) = a.Position("SBER");
            Assert.True(qty >= 0 && res >= 0 && res <= qty, $"Счёт {id}: бумаг {qty}, в резерве {res}");
            cash += a.Dec("cash");
            reserved += a.Dec("reservedCash");
            shares += qty;
        }
        Assert.Equal(6 * 50_000m, cash);
        Assert.Equal(600, shares);

        var book = await Book("SBER");
        if (book.Bids.Count > 0 && book.Asks.Count > 0)
            Assert.True(book.Bids[0].Price < book.Asks[0].Price, "Лучшая покупка не может быть выше лучшей продажи — значит, что-то не свелось");
        Assert.Equal(book.Bids.Sum(l => l.Price * l.Qty), reserved);
    }
}
