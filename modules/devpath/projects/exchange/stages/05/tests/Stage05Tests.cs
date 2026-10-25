using System.Net;
using Microsoft.Playwright;

/// <summary>Терминал на React: настоящий браузер против настоящего API.</summary>
public class Stage05Tests : IAsyncLifetime
{
    private ExchangeApp _app = null!;
    private HttpClient _http = null!;
    private IBrowserContext? _context;

    public Task InitializeAsync()
    {
        ExchangeApp.FlushRedis();
        _app = Web.Api(new ExchangeApp());
        _http = _app.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        if (_context is not null) await _context.CloseAsync();
        _app.Dispose();
    }

    async Task<(IPage Page, List<string> Errors)> Open(string account, string? ticker = null)
    {
        var (context, page, errors) = await Web.Open($"/?account={account}{(ticker is null ? "" : $"&ticker={ticker}")}");
        _context = context;
        return (page, errors);
    }

    static ILocator Order(IPage page, string id) => page.GetByTestId("orders").Locator($"[data-testid=order][data-id='{id}']");

    [Fact(DisplayName = "Э5.01 API: CORS для терминала и список заявок счёта", Timeout = 60_000)]
    public async Task ApiAdditions()
    {
        var acc = await _http.Account("Аня", 1000m);
        var first = await _http.Order(acc, "SBER", "buy", 100m, 1);
        var second = await _http.Order(acc, "GAZP", "buy", 110m, 1);
        var r = await _http.Get($"/accounts/{acc}/orders");
        Api.Status(HttpStatusCode.OK, r, "GET /accounts/{id}/orders");
        Assert.Equal([second.Id(), first.Id()], r.Body.EnumerateArray().Select(o => o.Id()));

        using var preflight = new HttpRequestMessage(HttpMethod.Options, "/orders");
        preflight.Headers.Add("Origin", Web.SiteUrl);
        preflight.Headers.Add("Access-Control-Request-Method", "POST");
        preflight.Headers.Add("Access-Control-Request-Headers", "content-type");
        var res = await _http.SendAsync(preflight);
        Assert.True(res.Headers.TryGetValues("Access-Control-Allow-Origin", out var origins) && origins.Any(o => o == Web.SiteUrl || o == "*"),
            $"API не разрешает запросы с {Web.SiteUrl}: нужен CORS (AddCors + UseCors)");
    }

    [Fact(DisplayName = "Э5.02 Терминал показывает инструменты, деньги и бумаги счёта", Timeout = 120_000)]
    public async Task Overview()
    {
        var acc = await _http.Account("Аня", 1500.50m, ("SBER", 7));
        await _http.Order(acc, "SBER", "sell", 400m, 2);
        var (page, errors) = await Open(acc);
        await Assertions.Expect(page.GetByTestId("ticker-SBER")).ToBeVisibleAsync();
        await Assertions.Expect(page.GetByTestId("ticker-GAZP")).ToBeVisibleAsync();
        await Assertions.Expect(page.GetByTestId("ticker-LKOH")).ToBeVisibleAsync();
        await Web.Eventually(async () => await page.GetByTestId("cash").Value() == 1500.50m, "cash = 1500.50");
        var pos = page.GetByTestId("positions").Locator("[data-testid=position][data-ticker=SBER]");
        await Assertions.Expect(pos).ToHaveAttributeAsync("data-qty", "7");
        await Assertions.Expect(pos).ToHaveAttributeAsync("data-reserved", "2");
        Assert.Empty(errors);
    }

    [Fact(DisplayName = "Э5.03 Стакан, котировка и сделки текущего инструмента", Timeout = 120_000)]
    public async Task Market()
    {
        var mm = await _http.Account("Маркет-мейкер", 100_000m, ("SBER", 100));
        await _http.Order(mm, "SBER", "buy", 299m, 3);
        await _http.Order(mm, "SBER", "buy", 300m, 2);
        await _http.Order(mm, "SBER", "sell", 305m, 4);
        var taker = await _http.Account("Покупатель", 10_000m);
        await _http.Order(taker, "SBER", "buy", 305m, 1);
        var (page, _) = await Open(taker);
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(300m, 2), (299m, 3)]), "bids: 300×2, 299×3");
        Assert.Equal([(305m, 3)], await page.Levels("asks"));
        Assert.Equal(300m, await page.GetByTestId("quote-bid").Value());
        Assert.Equal(305m, await page.GetByTestId("quote-ask").Value());
        Assert.Equal(305m, await page.GetByTestId("quote-last").Value());
        var trade = page.GetByTestId("trades").GetByTestId("trade").First;
        await Assertions.Expect(trade).ToHaveAttributeAsync("data-price", "305");
        await Assertions.Expect(trade).ToHaveAttributeAsync("data-qty", "1");
    }

    [Fact(DisplayName = "Э5.04 Заявка из формы: появляется в списке, резерв и стакан обновляются без перезагрузки", Timeout = 120_000)]
    public async Task PlaceOrder()
    {
        var acc = await _http.Account("Аня", 1000m);
        var (page, errors) = await Open(acc);
        await page.GetByTestId("side-buy").ClickAsync();
        await page.GetByTestId("order-price").FillAsync("250.5");
        await page.GetByTestId("order-qty").FillAsync("2");
        await page.GetByTestId("order-submit").ClickAsync();

        var row = page.GetByTestId("orders").GetByTestId("order").First;
        await Assertions.Expect(row).ToHaveAttributeAsync("data-status", "new");
        await Web.Eventually(async () => await page.GetByTestId("reserved-cash").Value() == 501m, "reserved-cash = 501");
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(250.5m, 2)]), "в стакане 250.5 × 2");
        var orders = (await _http.Get($"/accounts/{acc}/orders")).Body.EnumerateArray().ToList();
        Assert.Single(orders);
        Assert.Equal(orders[0].Id(), await row.GetAttributeAsync("data-id"));
        Assert.Empty(errors);
    }

    [Fact(DisplayName = "Э5.05 Неверный ввод ловится до запроса, ошибка сервера показывается человеку", Timeout = 120_000)]
    public async Task Validation()
    {
        var acc = await _http.Account("Аня", 100m);
        var (page, _) = await Open(acc);
        var calls = Web.TrackApiCalls(page);
        await page.GetByTestId("side-buy").ClickAsync();
        await page.GetByTestId("order-price").FillAsync("10.005");
        await page.GetByTestId("order-qty").FillAsync("0");
        await page.GetByTestId("order-submit").ClickAsync();
        await Assertions.Expect(page.GetByTestId("form-error")).ToBeVisibleAsync();
        Assert.DoesNotContain(calls, c => c.StartsWith("POST /orders"));

        await page.GetByTestId("order-price").FillAsync("50");
        await page.GetByTestId("order-qty").FillAsync("3");
        await page.GetByTestId("order-submit").ClickAsync();
        await Web.Eventually(() => Task.FromResult(calls.Any(c => c.StartsWith("POST /orders"))), "запрос POST /orders");
        var error = page.GetByTestId("form-error");
        await Assertions.Expect(error).ToBeVisibleAsync();
        Assert.False(string.IsNullOrWhiteSpace(await error.TextContentAsync()), "Текст ошибки пустой — покажи, что ответил сервер");
        Assert.Empty((await _http.Get($"/accounts/{acc}/orders")).Body.EnumerateArray());
    }

    [Fact(DisplayName = "Э5.06 Отмена заявки кнопкой", Timeout = 120_000)]
    public async Task Cancel()
    {
        var acc = await _http.Account("Аня", 1000m);
        var order = await _http.Order(acc, "SBER", "buy", 100m, 5);
        var (page, _) = await Open(acc);
        var row = Order(page, order.Id());
        await row.GetByTestId("order-cancel").ClickAsync();
        await Assertions.Expect(row).ToHaveAttributeAsync("data-status", "cancelled");
        await Assertions.Expect(row.GetByTestId("order-cancel")).ToHaveCountAsync(0);
        await Web.Eventually(async () => await page.GetByTestId("reserved-cash").Value() == 0m, "резерв освободился");
        await Web.Eventually(async () => (await page.Levels("bids")).Count == 0, "стакан пуст");
        Assert.Equal("cancelled", (await _http.Get($"/orders/{order.Id()}")).Body.Str("status"));
    }

    [Fact(DisplayName = "Э5.07 Покупка через терминал исполняется: позиция и сделка на экране", Timeout = 120_000)]
    public async Task Trade()
    {
        var seller = await _http.Account("Продавец", 0, ("GAZP", 10));
        await _http.Order(seller, "GAZP", "sell", 120m, 10);
        var acc = await _http.Account("Аня", 1000m);
        var (page, _) = await Open(acc, "GAZP");
        await page.GetByTestId("side-buy").ClickAsync();
        await page.GetByTestId("order-price").FillAsync("120");
        await page.GetByTestId("order-qty").FillAsync("3");
        await page.GetByTestId("order-submit").ClickAsync();
        await Assertions.Expect(page.GetByTestId("orders").GetByTestId("order").First).ToHaveAttributeAsync("data-status", "filled");
        await Assertions.Expect(page.GetByTestId("positions").Locator("[data-testid=position][data-ticker=GAZP]")).ToHaveAttributeAsync("data-qty", "3");
        await Web.Eventually(async () => await page.GetByTestId("cash").Value() == 640m, "cash = 640");
        await Assertions.Expect(page.GetByTestId("trades").GetByTestId("trade").First).ToHaveAttributeAsync("data-price", "120");
    }

    [Fact(DisplayName = "Э5.08 Переключение инструмента меняет стакан и адрес; после перезагрузки инструмент тот же", Timeout = 120_000)]
    public async Task SwitchTicker()
    {
        var mm = await _http.Account("ММ", 100_000m);
        await _http.Order(mm, "SBER", "buy", 300m, 1);
        await _http.Order(mm, "LKOH", "buy", 7000m, 2);
        var acc = await _http.Account("Аня", 10m);
        var (page, _) = await Open(acc);
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(300m, 1)]), "стакан SBER");
        await page.GetByTestId("ticker-LKOH").ClickAsync();
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(7000m, 2)]), "стакан LKOH");
        Assert.Contains("ticker=LKOH", page.Url);
        await page.ReloadAsync();
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(7000m, 2)]), "после перезагрузки — снова LKOH");
    }

    [Fact(DisplayName = "Э5.09 Несуществующий счёт — понятная ошибка, а не белый экран", Timeout = 120_000)]
    public async Task UnknownAccount()
    {
        var (page, errors) = await Open(Guid.NewGuid().ToString());
        await Assertions.Expect(page.GetByTestId("app-error")).ToBeVisibleAsync();
        Assert.Empty(errors);
    }
}
