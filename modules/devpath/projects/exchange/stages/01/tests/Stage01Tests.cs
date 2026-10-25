using System.Net;

public class Stage01Tests : IDisposable
{
    private readonly ExchangeApp _app = new();
    private readonly HttpClient _http;

    public Stage01Tests() => _http = _app.CreateClient();

    public void Dispose() => _app.Dispose();

    [Fact(DisplayName = "Э1.01 Инструменты SBER, GAZP, LKOH есть сразу после старта")]
    public async Task Instruments()
    {
        var r = await _http.Get("/instruments");
        Api.Status(HttpStatusCode.OK, r, "GET /instruments");
        var tickers = r.Body.EnumerateArray().Select(i => i.Str("ticker")).ToList();
        Assert.Contains("SBER", tickers);
        Assert.Contains("GAZP", tickers);
        Assert.Contains("LKOH", tickers);
    }

    [Fact(DisplayName = "Э1.02 Счёт создаётся с нулевым балансом")]
    public async Task CreateAccount()
    {
        var r = await _http.Post("/accounts", new { name = "Аня" });
        Api.Status(HttpStatusCode.Created, r, "POST /accounts");
        Assert.NotNull(r.Body.GetProperty("id").ToString());
        var acc = await _http.AccountState(r.Body.Id());
        Assert.Equal("Аня", acc.Str("name"));
        Assert.Equal(0m, acc.Dec("cash"));
        Assert.Equal(0m, acc.Dec("reservedCash"));
        Assert.Empty(acc.GetProperty("positions").EnumerateArray());
    }

    [Fact(DisplayName = "Э1.03 Пополнение деньгами и бумагами")]
    public async Task Deposit()
    {
        var id = await _http.Account("Аня", 1000.50m, ("SBER", 10));
        Api.Status(HttpStatusCode.OK, await _http.Post($"/accounts/{id}/deposit", new { amount = 0.25m }), "второе пополнение");
        var acc = await _http.AccountState(id);
        Assert.Equal(1000.75m, acc.Dec("cash"));
        Assert.Equal((10, 0), acc.Position("SBER"));
    }

    [Fact(DisplayName = "Э1.04 Неверные данные — 400 с описанием ошибки")]
    public async Task Validation()
    {
        var id = await _http.Account("Аня", 1000m);
        Api.Status(HttpStatusCode.BadRequest, await _http.Post("/accounts", new { name = "" }), "счёт без имени");
        Api.Status(HttpStatusCode.BadRequest, await _http.Post($"/accounts/{id}/deposit", new { amount = -5m }), "отрицательное пополнение");
        Api.Status(HttpStatusCode.BadRequest, await _http.Post($"/accounts/{id}/securities", new { ticker = "NOPE", qty = 1 }), "неизвестная бумага");
        Api.Status(HttpStatusCode.BadRequest, await _http.Post("/orders", new { accountId = id, ticker = "SBER", side = "buy", price = 100m, qty = 0 }), "заявка на 0 штук");
        Api.Status(HttpStatusCode.BadRequest, await _http.Post("/orders", new { accountId = id, ticker = "SBER", side = "buy", price = 100.005m, qty = 1 }), "цена не кратна шагу 0,01");
        Api.Status(HttpStatusCode.BadRequest, await _http.Post("/orders", new { accountId = id, ticker = "SBER", side = "hold", price = 100m, qty = 1 }), "неизвестная сторона");
        var r = await _http.Post("/orders", new { accountId = id, ticker = "NOPE", side = "buy", price = 100m, qty = 1 });
        Api.Status(HttpStatusCode.BadRequest, r, "неизвестный инструмент");
        Assert.True(r.Body.TryGetProperty("title", out _) || r.Body.TryGetProperty("errors", out _), "Ошибка должна быть в формате ProblemDetails (title/errors)");
    }

    [Fact(DisplayName = "Э1.05 Несуществующий счёт или заявка — 404")]
    public async Task NotFound()
    {
        var missing = Guid.NewGuid().ToString();
        Assert.Equal(HttpStatusCode.NotFound, (await _http.Get($"/accounts/{missing}")).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.Get($"/orders/{missing}")).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.Post("/orders", new { accountId = missing, ticker = "SBER", side = "buy", price = 100m, qty = 1 })).Status);
    }

    [Fact(DisplayName = "Э1.06 Заявка на покупку резервирует деньги")]
    public async Task BuyReservesCash()
    {
        var id = await _http.Account("Аня", 1000m);
        var order = await _http.Order(id, "SBER", "buy", 250.10m, 3);
        Assert.Equal("new", order.Str("status"));
        var acc = await _http.AccountState(id);
        Assert.Equal(1000m, acc.Dec("cash"));
        Assert.Equal(750.30m, acc.Dec("reservedCash"));
    }

    [Fact(DisplayName = "Э1.07 Заявка на продажу резервирует бумаги")]
    public async Task SellReservesSecurities()
    {
        var id = await _http.Account("Борис", 0, ("GAZP", 10));
        await _http.Order(id, "GAZP", "sell", 130m, 4);
        Assert.Equal((10, 4), (await _http.AccountState(id)).Position("GAZP"));
    }

    [Fact(DisplayName = "Э1.08 Не хватает свободных денег или бумаг — 409")]
    public async Task Insufficient()
    {
        var id = await _http.Account("Аня", 1000m, ("SBER", 5));
        await _http.Order(id, "SBER", "buy", 100m, 9);
        Api.Status(HttpStatusCode.Conflict, await _http.Post("/orders", new { accountId = id, ticker = "SBER", side = "buy", price = 100m, qty = 2 }), "покупка на 200 при свободных 100");
        await _http.Order(id, "SBER", "sell", 300m, 5);
        Api.Status(HttpStatusCode.Conflict, await _http.Post("/orders", new { accountId = id, ticker = "SBER", side = "sell", price = 300m, qty = 1 }), "продажа шестой бумаги из пяти");
        Api.Status(HttpStatusCode.Conflict, await _http.Post("/orders", new { accountId = id, ticker = "GAZP", side = "sell", price = 300m, qty = 1 }), "продажа бумаги, которой нет");
    }

    [Fact(DisplayName = "Э1.09 Заявку можно получить и отменить, резерв освобождается")]
    public async Task Cancel()
    {
        var id = await _http.Account("Аня", 1000m);
        var order = await _http.Order(id, "SBER", "buy", 100m, 5);
        var got = await _http.Get($"/orders/{order.Id()}");
        Api.Status(HttpStatusCode.OK, got, "GET /orders/{id}");
        Assert.Equal("SBER", got.Body.Str("ticker"));
        Assert.Equal("buy", got.Body.Str("side"));
        Assert.Equal(100m, got.Body.Dec("price"));
        Assert.Equal(5, got.Body.Int("qty"));
        Assert.Equal(0, got.Body.Int("filled"));

        var del = await _http.Delete($"/orders/{order.Id()}");
        Api.Status(HttpStatusCode.OK, del, "DELETE /orders/{id}");
        Assert.Equal("cancelled", del.Body.Str("status"));
        Assert.Equal(0m, (await _http.AccountState(id)).Dec("reservedCash"));
        Api.Status(HttpStatusCode.Conflict, await _http.Delete($"/orders/{order.Id()}"), "повторная отмена");
    }

    [Fact(DisplayName = "Э1.10 Данные переживают перезапуск сервера")]
    public async Task Persistence()
    {
        var id = await _http.Account("Аня", 500m, ("LKOH", 2));
        var order = await _http.Order(id, "LKOH", "sell", 7000m, 1);
        using var again = _app.Restart();
        var http2 = again.CreateClient();
        var acc = await http2.AccountState(id);
        Assert.Equal(500m, acc.Dec("cash"));
        Assert.Equal((2, 1), acc.Position("LKOH"));
        Api.Status(HttpStatusCode.OK, await http2.Get($"/orders/{order.Id()}"), "заявка после перезапуска");
    }
}
