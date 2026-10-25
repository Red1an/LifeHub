using System.Diagnostics;
using System.Diagnostics.Metrics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using StackExchange.Redis;

namespace Exchange.Api;

/// <summary>
/// Свои метрики и span'ы биржи. Имена — по соглашениям OpenTelemetry (точки, единицы в unit);
/// в Prometheus они превращаются в exchange_orders_total, exchange_match_duration_seconds и т. д.
/// </summary>
public static class Telemetry
{
    public const string Name = "Exchange";
    public static readonly ActivitySource Source = new(Name);
    private static readonly Meter Meter = new(Name);

    public static readonly Counter<long> Orders = Meter.CreateCounter<long>("exchange.orders", description: "Принятые заявки");
    public static readonly Counter<long> Trades = Meter.CreateCounter<long>("exchange.trades", description: "Сделки");

    /// <summary>Границы корзин в секундах: сведение — миллисекунды, дефолтные корзины OpenTelemetry для этого слишком крупные.</summary>
    public static readonly Histogram<double> MatchDuration = Meter.CreateHistogram<double>(
        "exchange.match.duration", unit: "s", description: "Время сведения заявки (под блокировкой)",
        advice: new InstrumentAdvice<double> { HistogramBucketBoundaries = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5] });

    /// <summary>Метрики и трейсы по OTLP. Адрес, протокол, имя сервиса и интервал — стандартные переменные OTEL_*.</summary>
    public static void AddExchangeTelemetry(this WebApplicationBuilder builder)
    {
        builder.Services.AddOpenTelemetry()
            // service.instance.id не генерируем сами: его задают через OTEL_RESOURCE_ATTRIBUTES (у каждого экземпляра свой).
            .ConfigureResource(r => r.AddService("exchange-api", autoGenerateServiceInstanceId: false))
            .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddMeter(Name).AddOtlpExporter())
            .WithTracing(t => t.AddAspNetCoreInstrumentation(o => o.Filter = ctx => !ctx.Request.Path.StartsWithSegments("/health")).AddSource(Name).AddOtlpExporter());

        builder.Services.AddHealthChecks()
            .AddCheck<DatabaseCheck>("postgres", tags: ["ready"])
            .AddCheck<RedisCheck>("redis", tags: ["ready"]);
    }

    /// <summary>live — процесс жив (без зависимостей: иначе оркестратор перезапустит здоровый процесс из-за упавшей базы); ready — можно слать трафик.</summary>
    public static void MapExchangeHealth(this WebApplication app)
    {
        app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
        app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
    }

    /// <summary>Продолжить трейс из заголовка (traceparent), пришедшего из другого процесса.</summary>
    public static Activity? StartLinked(string name, ActivityKind kind, string? traceParent) =>
        ActivityContext.TryParse(traceParent, null, out var parent) ? Source.StartActivity(name, kind, parent) : Source.StartActivity(name, kind);
}

public sealed class DatabaseCheck(IServiceScopeFactory scopes) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        using var scope = scopes.CreateScope();
        try
        {
            await scope.ServiceProvider.GetRequiredService<ExchangeDb>().Database.ExecuteSqlRawAsync("SELECT 1", ct);
            return HealthCheckResult.Healthy();
        }
        catch (Exception e)
        {
            return HealthCheckResult.Unhealthy("PostgreSQL недоступен", e);
        }
    }
}

public sealed class RedisCheck(IConnectionMultiplexer redis) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        try
        {
            await redis.GetDatabase().PingAsync().WaitAsync(TimeSpan.FromSeconds(2), ct);
            return HealthCheckResult.Healthy();
        }
        catch (Exception e)
        {
            return HealthCheckResult.Unhealthy("Redis недоступен", e);
        }
    }
}
