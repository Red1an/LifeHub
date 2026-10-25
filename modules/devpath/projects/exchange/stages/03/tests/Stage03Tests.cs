using System.Net;
using System.Text.Json;

/// <summary>
/// Два экземпляра API на одной базе — как два сервера за балансировщиком. Блокировка в памяти одного процесса
/// здесь не поможет: защищать данные должна база.
/// </summary>
public class Stage03Tests : IDisposable
{
    private readonly ExchangeApp _a = new();
    private readonly ExchangeApp _b;
    private readonly HttpClient _http;
    private readonly HttpClient[] _servers;

    public Stage03Tests()
    {
        _http = _a.CreateClient();
        _b = _a.Twin();
        _servers = [_http, _b.CreateClient()];
    }

    public void Dispose()
    {
        _b.Dispose();
        _a.Dispose();
    }

    HttpClient Server(int i) => _servers[i % 2];

    static void NoServerErrors(IEnumerable<(HttpStatusCode Status, JsonElement Body)> results)
    {
        var bad = results.Where(r => (int)r.Status >= 500).ToList();
        if (bad.Count > 0)
            throw new Xunit.Sdk.XunitException($"{bad.Count} ответов {(int)bad[0].Status}: {bad[0].Body}. Конфликт конкурентности не должен превращаться в ошибку сервера — повтори транзакцию или дождись блокировки.");
    }

    [Fact(DisplayName = "Э3.01 Двойная трата: 20 заявок на все деньги одновременно — проходит одна")]
    public async Task DoubleSpend()
    {
        var acc = await _http.Account("Аня", 1000m);
        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(i =>
            Server(i).Post("/orders", new { accountId = acc, ticker = "SBER", side = "buy", price = 100m, qty = 10 })));
        NoServerErrors(results);
        Assert.Equal(1, results.Count(r => r.Status == HttpStatusCode.Created));
        Assert.All(results.Where(r => r.Status != HttpStatusCode.Created), r => Assert.Equal(HttpStatusCode.Conflict, r.Status));
        Assert.Equal(1000m, (await _http.AccountState(acc)).Dec("reservedCash"));
    }

    [Fact(DisplayName = "Э3.02 Одну бумагу нельзя продать дважды")]
    public async Task DoubleSell()
    {
        var acc = await _http.Account("Борис", 0, ("LKOH", 1));
        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(i =>
            Server(i).Post("/orders", new { accountId = acc, ticker = "LKOH", side = "sell", price = 7000m + i, qty = 1 })));
        NoServerErrors(results);
        Assert.Equal(1, results.Count(r => r.Status == HttpStatusCode.Created));
        Assert.Equal((1, 1), (await _http.AccountState(acc)).Position("LKOH"));
    }

    [Fact(DisplayName = "Э3.03 Пополнения не теряются: 100 по 1 ₽ одновременно с двух серверов")]
    public async Task LostUpdate()
    {
        var acc = await _http.Account("Вера");
        var results = await Task.WhenAll(Enumerable.Range(0, 100).Select(i =>
            Server(i).Post($"/accounts/{acc}/deposit", new { amount = 1m })));
        NoServerErrors(results);
        Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.Status));
        Assert.Equal(100m, (await _http.AccountState(acc)).Dec("cash"));
    }

    [Fact(DisplayName = "Э3.04 Пополнение во время торговли не теряется")]
    public async Task DepositDuringTrading()
    {
        var buyer = await _http.Account("Покупатель", 100_000m);
        var seller = await _http.Account("Продавец", 0, ("SBER", 1000));
        var work = new List<Task<(HttpStatusCode Status, JsonElement Body)>>();
        for (var i = 0; i < 40; i++)
        {
            work.Add(Server(i).Post("/orders", new { accountId = seller, ticker = "SBER", side = "sell", price = 100m, qty = 1 }));
            work.Add(Server(i + 1).Post("/orders", new { accountId = buyer, ticker = "SBER", side = "buy", price = 100m, qty = 1 }));
            work.Add(Server(i).Post($"/accounts/{buyer}/deposit", new { amount = 10m }));
            work.Add(Server(i + 1).Post($"/accounts/{seller}/deposit", new { amount = 10m }));
        }
        var results = await Task.WhenAll(work);
        NoServerErrors(results);
        var b = await _http.AccountState(buyer);
        var s = await _http.AccountState(seller);
        var (bought, _) = b.Position("SBER");
        Assert.Equal(100_000m + 400m - 100m * bought, b.Dec("cash"));
        Assert.Equal(400m + 100m * bought, s.Dec("cash"));
        Assert.Equal(1000 - bought, s.Position("SBER").Qty);
    }

    [Fact(DisplayName = "Э3.05 Отмена и исполнение одновременно: заявка либо отменена, либо исполнена — не оба сразу")]
    public async Task CancelVsFill()
    {
        for (var round = 0; round < 15; round++)
        {
            var seller = await _http.Account($"Продавец {round}", 0, ("GAZP", 5));
            var buyer = await _http.Account($"Покупатель {round}", 10_000m);
            // Цена растёт с каждым раундом: заявки прошлых раундов не пересекутся с новыми.
            var price = 120m + round;
            var sell = await _http.Order(seller, "GAZP", "sell", price, 5);
            var cancel = Server(round).Delete($"/orders/{sell.Id()}");
            var buy = Server(round + 1).Post("/orders", new { accountId = buyer, ticker = "GAZP", side = "buy", price, qty = 5 });
            var both = await Task.WhenAll(cancel, buy);
            NoServerErrors(both);

            var final = (await _http.Get($"/orders/{sell.Id()}")).Body;
            var s = await _http.AccountState(seller);
            var b = await _http.AccountState(buyer);
            if (final.Str("status") == "cancelled")
            {
                Assert.Equal(0, final.Int("filled"));
                Assert.Equal((5, 0), s.Position("GAZP"));
                Assert.Equal(0, b.Position("GAZP").Qty);
            }
            else
            {
                Assert.Equal("filled", final.Str("status"));
                Assert.Equal(HttpStatusCode.Conflict, both[0].Status);
                Assert.Equal((0, 0), s.Position("GAZP"));
                Assert.Equal((5, 0), b.Position("GAZP"));
            }
            Assert.Equal(10_000m, b.Dec("cash") + s.Dec("cash"));
        }
    }

    [Fact(DisplayName = "Э3.06 Встречная торговля двух счетов не заканчивается дедлоком и 500")]
    public async Task NoDeadlock()
    {
        var a = await _http.Account("А", 100_000m, ("SBER", 100), ("GAZP", 100));
        var b = await _http.Account("Б", 100_000m, ("SBER", 100), ("GAZP", 100));
        var work = new List<Task<(HttpStatusCode Status, JsonElement Body)>>();
        for (var i = 0; i < 30; i++)
        {
            // А продаёт Б один инструмент, Б продаёт А другой — в одно и то же время.
            work.Add(Server(i).Post("/orders", new { accountId = a, ticker = "SBER", side = "sell", price = 300m, qty = 1 }));
            work.Add(Server(i + 1).Post("/orders", new { accountId = b, ticker = "GAZP", side = "sell", price = 120m, qty = 1 }));
            work.Add(Server(i + 1).Post("/orders", new { accountId = b, ticker = "SBER", side = "buy", price = 300m, qty = 1 }));
            work.Add(Server(i).Post("/orders", new { accountId = a, ticker = "GAZP", side = "buy", price = 120m, qty = 1 }));
        }
        var results = await Task.WhenAll(work);
        NoServerErrors(results);
        Assert.All(results, r => Assert.Equal(HttpStatusCode.Created, r.Status));
        var sa = await _http.AccountState(a);
        var sb = await _http.AccountState(b);
        Assert.Equal(200_000m, sa.Dec("cash") + sb.Dec("cash"));
        Assert.Equal(200, sa.Position("SBER").Qty + sb.Position("SBER").Qty);
        Assert.Equal(200, sa.Position("GAZP").Qty + sb.Position("GAZP").Qty);
    }

    [Fact(DisplayName = "Э3.07 300 случайных заявок с двух серверов параллельно — деньги и бумаги сходятся")]
    public async Task ParallelConservation()
    {
        var accounts = new List<string>();
        for (var i = 0; i < 6; i++) accounts.Add(await _http.Account($"Трейдер {i}", 50_000m, ("SBER", 100)));
        var created = new System.Collections.Concurrent.ConcurrentBag<string>();
        var all = new System.Collections.Concurrent.ConcurrentBag<(HttpStatusCode Status, JsonElement Body)>();
        await Task.WhenAll(Enumerable.Range(0, 8).Select(async worker =>
        {
            var rnd = new Random(100 + worker);
            for (var i = 0; i < 38; i++)
            {
                var acc = accounts[rnd.Next(accounts.Count)];
                var r = rnd.Next(5) == 0 && created.TryPeek(out var id)
                    ? await Server(worker).Delete($"/orders/{id}")
                    : await Server(worker).Post("/orders", new { accountId = acc, ticker = "SBER", side = rnd.Next(2) == 0 ? "buy" : "sell", price = 290m + rnd.Next(0, 21), qty = rnd.Next(1, 8) });
                all.Add(r);
                if (r.Status == HttpStatusCode.Created) created.Add(r.Body.Id());
            }
        }));
        NoServerErrors(all);

        decimal cash = 0, reserved = 0;
        var shares = 0;
        foreach (var id in accounts)
        {
            var a = await _http.AccountState(id);
            Assert.True(a.Dec("reservedCash") >= 0 && a.Dec("reservedCash") <= a.Dec("cash"), $"Счёт {id}: cash {a.Dec("cash")}, reserved {a.Dec("reservedCash")}");
            var (qty, res) = a.Position("SBER");
            Assert.True(res >= 0 && res <= qty, $"Счёт {id}: бумаг {qty}, в резерве {res}");
            cash += a.Dec("cash");
            reserved += a.Dec("reservedCash");
            shares += qty;
        }
        Assert.Equal(6 * 50_000m, cash);
        Assert.Equal(600, shares);

        var book = (await _http.Get("/orderbook/SBER")).Body;
        var bids = book.GetProperty("bids").EnumerateArray().Select(l => (Price: l.Dec("price"), Qty: l.Int("qty"))).ToList();
        var asks = book.GetProperty("asks").EnumerateArray().Select(l => (Price: l.Dec("price"), Qty: l.Int("qty"))).ToList();
        if (bids.Count > 0 && asks.Count > 0)
            Assert.True(bids[0].Price < asks[0].Price, "Стакан пересёкся: две встречные заявки не свелись — сведение шло параллельно");
        Assert.Equal(bids.Sum(l => l.Price * l.Qty), reserved);
    }
}
