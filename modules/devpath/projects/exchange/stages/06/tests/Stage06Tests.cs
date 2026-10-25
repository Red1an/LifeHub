using Microsoft.Playwright;

/// <summary>Терминал в реальном времени: изменения приходят сами, без перезагрузки и без опроса сервера.</summary>
public class Stage06Tests : IAsyncLifetime
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

    async Task<IPage> Open(string account, string? ticker = null)
    {
        var (context, page, _) = await Web.Open($"/?account={account}{(ticker is null ? "" : $"&ticker={ticker}")}");
        _context = context;
        await Assertions.Expect(page.GetByTestId("connection")).ToHaveAttributeAsync("data-state", "online", new() { Timeout = 8000 });
        return page;
    }

    [Fact(DisplayName = "Э6.01 Чужая заявка появляется в стакане сама", Timeout = 120_000)]
    public async Task LiveBook()
    {
        var me = await _http.Account("Аня", 10m);
        var page = await Open(me);
        var mm = await _http.Account("ММ", 100_000m);
        await _http.Order(mm, "SBER", "buy", 301m, 4);
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(301m, 4)]), "в стакане без перезагрузки 301 × 4", 3000);
    }

    [Fact(DisplayName = "Э6.02 Котировка и лента сделок обновляются вживую", Timeout = 120_000)]
    public async Task LiveQuoteAndTrades()
    {
        var me = await _http.Account("Аня", 10m);
        var page = await Open(me, "GAZP");
        var a = await _http.Account("А", 0, ("GAZP", 10));
        var b = await _http.Account("Б", 10_000m);
        await _http.Order(a, "GAZP", "sell", 125m, 10);
        await Web.Eventually(async () => await page.GetByTestId("quote-ask").Value() == 125m, "ask = 125", 3000);
        await _http.Order(b, "GAZP", "buy", 125m, 3);
        await Web.Eventually(async () => await page.GetByTestId("quote-last").Value() == 125m, "last = 125", 3000);
        await Assertions.Expect(page.GetByTestId("trades").GetByTestId("trade").First).ToHaveAttributeAsync("data-qty", "3", new() { Timeout = 3000 });
    }

    [Fact(DisplayName = "Э6.03 Мою заявку исполнил кто-то другой — статус и бумаги меняются сами", Timeout = 120_000)]
    public async Task MyOrderFilledByOthers()
    {
        var me = await _http.Account("Аня", 0, ("LKOH", 2));
        var page = await Open(me, "LKOH");
        await page.GetByTestId("side-sell").ClickAsync();
        await page.GetByTestId("order-price").FillAsync("7000");
        await page.GetByTestId("order-qty").FillAsync("2");
        await page.GetByTestId("order-submit").ClickAsync();
        var row = page.GetByTestId("orders").GetByTestId("order").First;
        await Assertions.Expect(row).ToHaveAttributeAsync("data-status", "new");

        var buyer = await _http.Account("Покупатель", 100_000m);
        await _http.Order(buyer, "LKOH", "buy", 7000m, 2);
        await Assertions.Expect(row).ToHaveAttributeAsync("data-status", "filled", new() { Timeout = 3000 });
        await Web.Eventually(async () => await page.GetByTestId("cash").Value() == 14_000m, "деньги за проданное пришли", 3000);
    }

    [Fact(DisplayName = "Э6.04 Без опроса: пока ничего не происходит, терминал не ходит в API", Timeout = 120_000)]
    public async Task NoPolling()
    {
        var me = await _http.Account("Аня", 10m);
        var page = await Open(me);
        await Task.Delay(1000); // первичная загрузка закончилась
        var calls = Web.TrackApiCalls(page);
        await Task.Delay(4000);
        Assert.True(calls.Count == 0, $"За 4 секунды тишины терминал сделал запросы: {string.Join(", ", calls.Take(5))}. Обновления должны приходить по WebSocket.");
    }

    [Fact(DisplayName = "Э6.05 Перезапуск API: индикатор связи, переподключение и догрузка пропущенного", Timeout = 120_000)]
    public async Task Reconnect()
    {
        var me = await _http.Account("Аня", 10m);
        var page = await Open(me);
        var connection = page.GetByTestId("connection");

        var next = _app.HandOver();
        _app.Dispose(); // сервер остановлен, база осталась
        await Assertions.Expect(connection).Not.ToHaveAttributeAsync("data-state", "online", new() { Timeout = 5000 });

        _app = Web.Api(next);
        _http = _app.CreateClient();
        // Пока терминал был без связи, в стакане появилась заявка — после переподключения она должна быть видна.
        var mm = await _http.Account("ММ", 100_000m);
        await _http.Order(mm, "SBER", "buy", 299m, 7);
        await Assertions.Expect(connection).ToHaveAttributeAsync("data-state", "online", new() { Timeout = 15_000 });
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(299m, 7)]), "заявка, пропущенная без связи, видна после переподключения", 5000);
    }

    [Fact(DisplayName = "Э6.06 Переключение инструментов не плодит WebSocket-соединения", Timeout = 120_000)]
    public async Task OneSocket()
    {
        var me = await _http.Account("Аня", 10m);
        var (context, page, _) = await Web.Open($"/?account={me}");
        _context = context;
        var open = 0;
        page.WebSocket += (_, ws) =>
        {
            Interlocked.Increment(ref open);
            ws.Close += (_, _) => Interlocked.Decrement(ref open);
        };
        await page.ReloadAsync();
        await Assertions.Expect(page.GetByTestId("connection")).ToHaveAttributeAsync("data-state", "online");
        foreach (var t in new[] { "GAZP", "LKOH", "SBER", "GAZP" })
        {
            await page.GetByTestId($"ticker-{t}").ClickAsync();
            await Assertions.Expect(page.GetByTestId("connection")).ToHaveAttributeAsync("data-state", "online");
        }
        await Task.Delay(1500);
        Assert.True(open <= 1, $"Открыто WebSocket-соединений: {open}. Старые подписки нужно закрывать (очистка в useEffect).");

        var mm = await _http.Account("ММ", 100_000m);
        await _http.Order(mm, "GAZP", "buy", 119m, 1);
        await Web.Eventually(async () => (await page.Levels("bids")).SequenceEqual([(119m, 1)]), "обновления GAZP после переключений", 3000);
    }
}
