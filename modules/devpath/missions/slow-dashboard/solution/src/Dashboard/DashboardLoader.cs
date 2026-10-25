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

public record DashboardData(int? Orders, string? Weather, IReadOnlyList<string> News, IReadOnlyList<string> Failed);

public class DashboardLoader(IOrdersApi orders, IWeatherApi weather, INewsApi news)
{
    public static readonly TimeSpan PerServiceTimeout = TimeSpan.FromSeconds(1);

    public async Task<DashboardData> LoadAsync(CancellationToken ct = default)
    {
        // Запускаем все три запроса сразу и только потом ждём: время = самый медленный, а не сумма.
        var o = Try(c => orders.GetTodayCountAsync(c), ct);
        var w = Try(c => weather.GetForecastAsync(c), ct);
        var n = Try(c => news.GetHeadlinesAsync(c), ct);
        await Task.WhenAll(o, w, n);

        var (ro, rw, rn) = (await o, await w, await n);
        var failed = new List<string>();
        if (!ro.Ok) failed.Add("orders");
        if (!rw.Ok) failed.Add("weather");
        if (!rn.Ok) failed.Add("news");
        return new DashboardData(ro.Ok ? ro.Value : null, rw.Value, rn.Value ?? [], failed);
    }

    private sealed record Outcome<T>(bool Ok, T? Value);

    /// <summary>Блок дашборда: свой таймаут, ошибка не роняет остальные. Отмену вызывающим — пробрасываем.</summary>
    private static async Task<Outcome<T>> Try<T>(Func<CancellationToken, Task<T>> call, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(PerServiceTimeout);
        try
        {
            return new Outcome<T>(true, await call(timeout.Token));
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new Outcome<T>(false, default); // сработал свой таймаут — блок пустой
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return new Outcome<T>(false, default); // в реальном коде здесь ещё лог
        }
    }
}
