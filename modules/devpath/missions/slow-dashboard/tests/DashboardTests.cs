using System.Diagnostics;
using Dashboard;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

public class DashboardTests
{
    sealed class Orders(int ms, bool fail = false) : IOrdersApi
    {
        public async Task<int> GetTodayCountAsync(CancellationToken ct)
        {
            await Task.Delay(ms, ct);
            if (fail) throw new HttpRequestException("orders 500");
            return 42;
        }
    }

    sealed class Weather(int ms, bool fail = false) : IWeatherApi
    {
        public async Task<string> GetForecastAsync(CancellationToken ct)
        {
            await Task.Delay(ms, ct);
            if (fail) throw new HttpRequestException("weather 503");
            return "+18, солнечно";
        }
    }

    sealed class News(int ms, bool fail = false) : INewsApi
    {
        public int Calls;

        public async Task<IReadOnlyList<string>> GetHeadlinesAsync(CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            await Task.Delay(ms, ct);
            if (fail) throw new HttpRequestException("news 502");
            return ["Новость 1", "Новость 2"];
        }
    }

    static async Task<(DashboardData Data, long Ms)> Measure(DashboardLoader loader, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var data = await loader.LoadAsync(ct);
        return (data, sw.ElapsedMilliseconds);
    }

    [Fact(DisplayName = "1. Все сервисы ответили — все блоки заполнены")]
    public async Task AllOk()
    {
        var (d, _) = await Measure(new DashboardLoader(new Orders(50), new Weather(50), new News(50)));
        Assert.Equal(42, d.Orders);
        Assert.Equal("+18, солнечно", d.Weather);
        Assert.Equal(2, d.News.Count);
        Assert.Empty(d.Failed);
    }

    [Fact(DisplayName = "2. Три сервиса по 400 мс — дашборд быстрее 700 мс")]
    public async Task Parallel()
    {
        await Measure(new DashboardLoader(new Orders(1), new Weather(1), new News(1))); // прогрев
        var (_, ms) = await Measure(new DashboardLoader(new Orders(400), new Weather(400), new News(400)));
        Assert.True(ms < 700, $"Заняло {ms} мс — сервисы вызываются по очереди?");
    }

    [Fact(DisplayName = "3. Новости упали — остальное показывается")]
    public async Task NewsFails()
    {
        var (d, _) = await Measure(new DashboardLoader(new Orders(50), new Weather(50), new News(50, fail: true)));
        Assert.Equal(42, d.Orders);
        Assert.Equal("+18, солнечно", d.Weather);
        Assert.Empty(d.News);
        Assert.Equal(["news"], d.Failed);
    }

    [Fact(DisplayName = "4. Упали два сервиса — оба в списке Failed")]
    public async Task TwoFail()
    {
        var (d, _) = await Measure(new DashboardLoader(new Orders(50, fail: true), new Weather(50, fail: true), new News(50)));
        Assert.Null(d.Orders);
        Assert.Null(d.Weather);
        Assert.Equal(2, d.News.Count);
        Assert.Equal(["orders", "weather"], d.Failed.Order());
    }

    [Fact(DisplayName = "5. Погода висит 10 секунд — ждём не дольше секунды")]
    public async Task WeatherHangs()
    {
        var (d, ms) = await Measure(new DashboardLoader(new Orders(50), new Weather(10_000), new News(50)));
        Assert.True(ms < 1600, $"Заняло {ms} мс");
        Assert.Null(d.Weather);
        Assert.Equal(42, d.Orders);
        Assert.Equal(["weather"], d.Failed);
    }

    [Fact(DisplayName = "6. Пользователь ушёл со страницы — загрузка отменяется, а не «падает в Failed»")]
    public async Task CallerCancels()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        var loader = new DashboardLoader(new Orders(500), new Weather(500), new News(500));
        var sw = Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => loader.LoadAsync(cts.Token));
        Assert.True(sw.ElapsedMilliseconds < 450, $"Отмена сработала через {sw.ElapsedMilliseconds} мс");
    }

    [Fact(DisplayName = "7. Каждый сервис вызывается один раз")]
    public async Task CalledOnce()
    {
        var news = new News(50);
        await Measure(new DashboardLoader(new Orders(50), new Weather(50), news));
        Assert.Equal(1, news.Calls);
    }
}
