using System.Diagnostics;
using Xunit;

public class LruCacheTests
{
    [Fact(DisplayName = "Положил — достал")]
    public void PutGet()
    {
        var c = new LruCache<string, int>(2);
        c.Put("a", 1);
        Assert.True(c.TryGet("a", out var v));
        Assert.Equal(1, v);
        Assert.False(c.TryGet("b", out _));
    }

    [Fact(DisplayName = "Выбрасывается самый давний")]
    public void EvictsOldest()
    {
        var c = new LruCache<string, int>(2);
        c.Put("a", 1);
        c.Put("b", 2);
        c.Put("c", 3);
        Assert.False(c.TryGet("a", out _));
        Assert.True(c.TryGet("b", out _));
        Assert.True(c.TryGet("c", out _));
        Assert.Equal(2, c.Count);
    }

    [Fact(DisplayName = "Чтение делает элемент свежим")]
    public void GetRefreshes()
    {
        var c = new LruCache<string, int>(2);
        c.Put("a", 1);
        c.Put("b", 2);
        c.TryGet("a", out _);
        c.Put("c", 3);
        Assert.True(c.TryGet("a", out _));
        Assert.False(c.TryGet("b", out _));
    }

    [Fact(DisplayName = "Замена значения делает элемент свежим и не растит Count")]
    public void PutRefreshes()
    {
        var c = new LruCache<string, int>(2);
        c.Put("a", 1);
        c.Put("b", 2);
        c.Put("a", 10);
        c.Put("c", 3);
        Assert.Equal(2, c.Count);
        Assert.True(c.TryGet("a", out var v));
        Assert.Equal(10, v);
        Assert.False(c.TryGet("b", out _));
    }

    [Fact(DisplayName = "Миллион операций на кэше в 100 000 — быстрее секунды")]
    public void Fast()
    {
        var c = new LruCache<int, int>(100_000);
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 1_000_000; i++)
        {
            c.Put(i % 150_000, i);
            c.TryGet((i * 7) % 150_000, out _);
        }
        Assert.True(sw.ElapsedMilliseconds < 1000, $"Заняло {sw.ElapsedMilliseconds} мс — где-то O(n)?");
        Assert.Equal(100_000, c.Count);
    }

    [Fact(DisplayName = "capacity <= 0 — ArgumentOutOfRangeException")]
    public void BadCapacity() => Assert.Throws<ArgumentOutOfRangeException>(() => new LruCache<int, int>(0));
}
