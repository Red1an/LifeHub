using Exchange.Api.Matching;

public class MatcherTests
{
    static long _seq;
    static BookOrder Buy(decimal price, int qty) => new(Guid.NewGuid(), Side.Buy, price, qty, ++_seq);
    static BookOrder Sell(decimal price, int qty) => new(Guid.NewGuid(), Side.Sell, price, qty, ++_seq);

    [Fact]
    public void NoCross_NoFills()
    {
        var fills = Matcher.Match(Buy(99, 5), [Sell(100, 5)]);
        Assert.Empty(fills);
    }

    [Fact]
    public void SamePrice_FullFill()
    {
        var sell = Sell(100, 5);
        var buy = Buy(100, 5);
        var fill = Assert.Single(Matcher.Match(buy, [sell]));
        Assert.Equal((100m, 5), (fill.Price, fill.Qty));
        Assert.Equal(0, buy.Remaining);
        Assert.Equal(0, sell.Remaining);
    }

    [Fact]
    public void TradesAtRestingPrice()
    {
        Assert.Equal(98m, Assert.Single(Matcher.Match(Buy(105, 1), [Sell(98, 1)])).Price);
        Assert.Equal(105m, Assert.Single(Matcher.Match(Sell(98, 1), [Buy(105, 1)])).Price);
    }

    [Fact]
    public void PartialFill_LeavesRemainder()
    {
        var sell = Sell(100, 10);
        Matcher.Match(Buy(100, 3), [sell]);
        Assert.Equal(7, sell.Remaining);
    }

    [Fact]
    public void BestPriceFirst_ForBuy()
    {
        var cheap = Sell(100, 1);
        var fill = Assert.Single(Matcher.Match(Buy(110, 1), [Sell(105, 1), cheap]));
        Assert.Equal(cheap.Id, fill.RestingId);
    }

    [Fact]
    public void BestPriceFirst_ForSell()
    {
        var high = Buy(105, 1);
        var fill = Assert.Single(Matcher.Match(Sell(90, 1), [Buy(100, 1), high]));
        Assert.Equal(high.Id, fill.RestingId);
    }

    [Fact]
    public void SamePrice_EarlierFirst()
    {
        var early = Sell(100, 1);
        var late = Sell(100, 1);
        var fill = Assert.Single(Matcher.Match(Buy(100, 1), [late, early]));
        Assert.Equal(early.Id, fill.RestingId);
    }

    [Fact]
    public void Sweep_StopsAtLimit()
    {
        var fills = Matcher.Match(Buy(101, 12), [Sell(100, 5), Sell(101, 5), Sell(102, 5)]);
        Assert.Equal([(100m, 5), (101m, 5)], fills.Select(f => (f.Price, f.Qty)));
    }

    [Fact]
    public void IgnoresSameSideAndEmpty()
    {
        Assert.Empty(Matcher.Match(Buy(100, 1), [Buy(90, 1), Sell(100, 0)]));
    }
}
