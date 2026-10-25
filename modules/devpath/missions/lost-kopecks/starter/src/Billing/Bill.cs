namespace Billing;

public static class Bill
{
    /// <summary>Сумма чека. Считаем через double — «так быстрее».</summary>
    public static decimal Total(IEnumerable<decimal> prices)
    {
        double sum = 0;
        foreach (var p in prices)
            sum += (double)p;
        return (decimal)sum;
    }

    /// <summary>Округление до копеек по правилам магазина: 2,345 ₽ → 2,35 ₽, −2,345 ₽ → −2,35 ₽.</summary>
    public static decimal RoundRub(decimal amount) => Math.Round(amount, 2);

    /// <summary>
    /// Разделить счёт на людей. Сумма долей должна в точности равняться счёту,
    /// доли отличаются не больше чем на копейку, большие доли — первыми.
    /// </summary>
    public static decimal[] Split(decimal total, int people)
    {
        var part = RoundRub(total / people);
        return Enumerable.Repeat(part, people).ToArray();
    }
}
