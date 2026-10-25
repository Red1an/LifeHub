namespace Exchange.Api.Matching;

public enum Side { Buy, Sell }

/// <summary>Заявка глазами движка: только то, что нужно для сведения.</summary>
public sealed class BookOrder(Guid id, Side side, decimal price, int qty, long seq)
{
    public Guid Id { get; } = id;
    public Side Side { get; } = side;
    public decimal Price { get; } = price;
    public int Remaining { get; set; } = qty;
    /// <summary>Порядок поступления: при равной цене раньше — первым.</summary>
    public long Seq { get; } = seq;
}

public readonly record struct Fill(Guid RestingId, Guid IncomingId, decimal Price, int Qty);

/// <summary>
/// Сведение без базы и HTTP — поэтому его легко покрыть unit-тестами.
/// Приоритет: сначала лучшая цена, при равной — время. Цена сделки — цена стоящей заявки.
/// </summary>
public static class Matcher
{
    public static bool Crosses(BookOrder incoming, BookOrder resting) =>
        incoming.Side == Side.Buy ? resting.Price <= incoming.Price : resting.Price >= incoming.Price;

    /// <summary>Порядок, в котором встречные заявки забирают объём.</summary>
    public static IEnumerable<BookOrder> Priority(IEnumerable<BookOrder> opposite, Side incomingSide) =>
        incomingSide == Side.Buy
            ? opposite.OrderBy(o => o.Price).ThenBy(o => o.Seq)
            : opposite.OrderByDescending(o => o.Price).ThenBy(o => o.Seq);

    /// <summary>Свести входящую заявку со встречными. Меняет Remaining у обеих сторон.</summary>
    public static List<Fill> Match(BookOrder incoming, IEnumerable<BookOrder> opposite)
    {
        var fills = new List<Fill>();
        foreach (var resting in Priority(opposite.Where(o => o.Side != incoming.Side && o.Remaining > 0), incoming.Side))
        {
            if (incoming.Remaining == 0 || !Crosses(incoming, resting)) break;
            var qty = Math.Min(incoming.Remaining, resting.Remaining);
            incoming.Remaining -= qty;
            resting.Remaining -= qty;
            fills.Add(new Fill(resting.Id, incoming.Id, resting.Price, qty));
        }
        return fills;
    }
}
