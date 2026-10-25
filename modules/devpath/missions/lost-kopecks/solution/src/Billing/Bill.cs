namespace Billing;

public static class Bill
{
    public static decimal Total(IEnumerable<decimal> prices)
    {
        // decimal хранит десятичные дроби точно: 0,01 — это ровно одна сотая, а не 0,01000000000000000021.
        decimal sum = 0;
        foreach (var p in prices)
            sum += p;
        return sum;
    }

    // По умолчанию Math.Round округляет «к чётному» (банковское): 2,345 → 2,34.
    public static decimal RoundRub(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);

    public static decimal[] Split(decimal total, int people)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(people);
        // Работаем в целых копейках: делим нацело, остаток раздаём по копейке первым.
        var kopecks = (long)RoundRub(total * 100);
        var basePart = kopecks / people;
        var rest = kopecks % people;
        var parts = new decimal[people];
        for (var i = 0; i < people; i++)
            parts[i] = (basePart + (i < rest ? 1 : 0)) / 100m;
        return parts;
    }
}
