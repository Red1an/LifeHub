using Billing;

public class BillTests
{
    [Fact(DisplayName = "1. Сумма миллиона позиций по 1 копейке — ровно 10 000 ₽")]
    public void TotalIsExact()
    {
        Assert.Equal(10_000.00m, Bill.Total(Enumerable.Repeat(0.01m, 1_000_000)));
    }

    [Fact(DisplayName = "2. Сумма обычного чека")]
    public void TotalSmall()
    {
        Assert.Equal(1047.35m, Bill.Total([199.90m, 0.15m, 847.30m]));
    }

    [Theory(DisplayName = "3. Половина копейки округляется от нуля")]
    [InlineData("2.345", "2.35")]
    [InlineData("2.355", "2.36")]
    [InlineData("-2.345", "-2.35")]
    [InlineData("10.004", "10.00")]
    public void RoundsAwayFromZero(string input, string expected)
    {
        Assert.Equal(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture),
            Bill.RoundRub(decimal.Parse(input, System.Globalization.CultureInfo.InvariantCulture)));
    }

    [Theory(DisplayName = "4. Доли в сумме дают ровно весь счёт")]
    [InlineData(100, 3)]
    [InlineData(0.05, 3)]
    [InlineData(1000.01, 7)]
    [InlineData(999.99, 4)]
    public void SplitSumsToTotal(double totalD, int people)
    {
        var total = (decimal)totalD;
        var parts = Bill.Split(total, people);
        Assert.Equal(people, parts.Length);
        Assert.Equal(total, parts.Sum());
    }

    [Fact(DisplayName = "5. 100 ₽ на троих: 33,34 + 33,33 + 33,33")]
    public void SplitHundred()
    {
        Assert.Equal([33.34m, 33.33m, 33.33m], Bill.Split(100m, 3));
    }

    [Fact(DisplayName = "6. Доли отличаются не больше чем на копейку и идут по убыванию")]
    public void SplitIsFair()
    {
        var parts = Bill.Split(1000.05m, 6);
        Assert.True(parts.Max() - parts.Min() <= 0.01m);
        Assert.Equal(parts.OrderByDescending(x => x), parts);
        Assert.All(parts, p => Assert.Equal(p, Math.Round(p, 2)));
    }

    [Fact(DisplayName = "7. Делить на ноль людей нельзя")]
    public void SplitZeroPeople()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Bill.Split(100m, 0));
    }
}
