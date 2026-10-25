namespace Orders;

public record OrderRow(int Id, string Customer, DateTime CreatedAt, long TotalKopecks, int Items);

public class OrdersPage(ShopDb db)
{
    public List<OrderRow> Load(int page, int size)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(page, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(size, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(size, 100);

        // Один SQL: сортировка, OFFSET/LIMIT, JOIN клиента и суммы по позициям считает база.
        // Проекция в OrderRow — EF не создаёт сущности и ничего не отслеживает.
        return db.Orders
            .OrderByDescending(o => o.CreatedAt)
            .ThenByDescending(o => o.Id) // стабильный порядок, если даты совпадут
            .Skip((page - 1) * size)
            .Take(size)
            .Select(o => new OrderRow(
                o.Id,
                o.Customer.Name,
                o.CreatedAt,
                o.Lines.Sum(l => l.PriceKopecks * l.Qty),
                o.Lines.Sum(l => l.Qty)))
            .ToList();
    }
}
