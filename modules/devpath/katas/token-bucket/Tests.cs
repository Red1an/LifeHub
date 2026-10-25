using Xunit;

/// <summary>Управляемые часы для тестов: время идёт, только когда его двигают.</summary>
public sealed class ManualTime : TimeProvider
{
    private long _ticks;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override long GetTimestamp() => _ticks;
    public void Advance(double seconds) => _ticks += (long)(seconds * TimeSpan.TicksPerSecond);
}

public class TokenBucketTests
{
    static int Burst(RateLimiter l)
    {
        var n = 0;
        while (n < 1000 && l.TryAcquire()) n++;
        return n;
    }

    [Fact(DisplayName = "В начале ведро полное")]
    public void StartsFull() => Assert.Equal(5, Burst(new RateLimiter(5, 1, new ManualTime())));

    [Fact(DisplayName = "Без времени жетоны не появляются")]
    public void NoTimeNoTokens()
    {
        var l = new RateLimiter(2, 1, new ManualTime());
        Burst(l);
        Assert.False(l.TryAcquire());
    }

    [Fact(DisplayName = "Через секунду — новый жетон")]
    public void Refills()
    {
        var time = new ManualTime();
        var l = new RateLimiter(3, 1, time);
        Burst(l);
        time.Advance(1);
        Assert.True(l.TryAcquire());
        Assert.False(l.TryAcquire());
    }

    [Fact(DisplayName = "Дробная скорость копится, а не теряется")]
    public void Fractional()
    {
        var time = new ManualTime();
        var l = new RateLimiter(1, 0.5, time);
        Burst(l);
        time.Advance(1);
        Assert.False(l.TryAcquire());
        time.Advance(1);
        Assert.True(l.TryAcquire());
    }

    [Fact(DisplayName = "Пополнение не выше capacity")]
    public void Capped()
    {
        var time = new ManualTime();
        var l = new RateLimiter(3, 10, time);
        Burst(l);
        time.Advance(60);
        Assert.Equal(3, Burst(l));
    }

    [Fact(DisplayName = "Средняя скорость держится: 10 секунд по 2 в секунду — 20 + ёмкость")]
    public void SteadyRate()
    {
        var time = new ManualTime();
        var l = new RateLimiter(4, 2, time);
        var n = 0;
        for (var i = 0; i < 100; i++)
        {
            n += Burst(l);
            time.Advance(0.1);
        }
        Assert.InRange(n, 23, 24);
    }
}
