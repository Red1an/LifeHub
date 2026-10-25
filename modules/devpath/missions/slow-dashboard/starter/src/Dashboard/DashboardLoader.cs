namespace Dashboard;

public interface IOrdersApi
{
    Task<int> GetTodayCountAsync(CancellationToken ct);
}

public interface IWeatherApi
{
    Task<string> GetForecastAsync(CancellationToken ct);
}

public interface INewsApi
{
    Task<IReadOnlyList<string>> GetHeadlinesAsync(CancellationToken ct);
}

/// <param name="Orders">null — заказы получить не удалось.</param>
/// <param name="Weather">null — погоду получить не удалось.</param>
/// <param name="Failed">Какие блоки не загрузились: "orders", "weather", "news".</param>
public record DashboardData(int? Orders, string? Weather, IReadOnlyList<string> News, IReadOnlyList<string> Failed);

public class DashboardLoader(IOrdersApi orders, IWeatherApi weather, INewsApi news)
{
    /// <summary>Сколько ждём каждый сервис, прежде чем показать блок пустым.</summary>
    public static readonly TimeSpan PerServiceTimeout = TimeSpan.FromSeconds(1);

    public async Task<DashboardData> LoadAsync(CancellationToken ct = default)
    {
        var o = await orders.GetTodayCountAsync(ct);
        var w = await weather.GetForecastAsync(ct);
        var n = await news.GetHeadlinesAsync(ct);
        return new DashboardData(o, w, n, []);
    }
}
