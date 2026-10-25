namespace Orders;

/// <summary>Строка таблицы «Мои заказы» в админке.</summary>
public record OrderRow(int Id, string Customer, DateTime CreatedAt, long TotalKopecks, int Items);

public class OrdersPage(ShopDb db)
{
    /// <summary>Страница заказов, новые сверху. page — с 1, size — от 1 до 100.</summary>
    public List<OrderRow> Load(int page, int size)
    {
        var orders = db.Orders
            .OrderByDescending(o => o.CreatedAt)
            .ToList()
            .Skip((page - 1) * size)
            .Take(size);

        var rows = new List<OrderRow>();
        foreach (var o in orders)
        {
            var customer = db.Customers.First(c => c.Id == o.CustomerId);
            var lines = db.OrderLines.Where(l => l.OrderId == o.Id).ToList();
            rows.Add(new OrderRow(o.Id, customer.Name, o.CreatedAt, lines.Sum(l => l.PriceKopecks * l.Qty), lines.Sum(l => l.Qty)));
        }
        return rows;
    }
}
