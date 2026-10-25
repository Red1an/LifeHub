using Stats;

public class ViewCounterTests
{
    static readonly string[] Pages = ["/", "/catalog", "/cart", "/about", "/blog", "/faq", "/login", "/profile"];

    static void Hammer(ViewCounter counter, int hits)
    {
        Parallel.For(0, hits, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(4, Environment.ProcessorCount) },
            i => counter.Hit(Pages[i % Pages.Length]));
    }

    [Fact(DisplayName = "1. Один поток — всё считается")]
    public void SingleThread()
    {
        var c = new ViewCounter();
        c.Hit("/");
        c.Hit("/");
        c.Hit("/cart");
        Assert.Equal(2, c.Get("/"));
        Assert.Equal(1, c.Get("/cart"));
        Assert.Equal(0, c.Get("/nope"));
        Assert.Equal(3, c.Total);
    }

    [Fact(DisplayName = "2. 800 000 просмотров из многих потоков — ни один не потерян")]
    public void NoLostUpdates()
    {
        var c = new ViewCounter();
        var ex = Record.Exception(() => Hammer(c, 800_000));
        Assert.Null(ex);
        Assert.All(Pages, p => Assert.Equal(100_000, c.Get(p)));
    }

    [Fact(DisplayName = "3. Общий счётчик под нагрузкой тоже точный")]
    public void TotalIsExact()
    {
        var c = new ViewCounter();
        Record.Exception(() => Hammer(c, 800_000));
        Assert.Equal(800_000, c.Total);
    }

    [Fact(DisplayName = "4. Снимок не меняется после получения")]
    public void SnapshotIsFrozen()
    {
        var c = new ViewCounter();
        c.Hit("/");
        var snap = c.Snapshot();
        c.Hit("/");
        c.Hit("/new");
        Assert.Equal(1, snap["/"]);
        Assert.False(snap.ContainsKey("/new"));
    }

    [Fact(DisplayName = "5. Снимок можно брать прямо во время нагрузки")]
    public void SnapshotUnderLoad()
    {
        var c = new ViewCounter();
        var load = Task.Run(() => Hammer(c, 400_000));
        var ex = Record.Exception(() =>
        {
            while (!load.IsCompleted)
                _ = c.Snapshot().Values.Sum();
        });
        load.Wait();
        Assert.Null(ex);
        Assert.Equal(400_000, c.Snapshot().Values.Sum());
    }
}
