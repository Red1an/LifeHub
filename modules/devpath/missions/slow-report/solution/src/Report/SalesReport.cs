namespace Report;

public record Customer(int Id, string Name, string City);

public record Order(int Id, int CustomerId, decimal Amount);

public static class SalesReport
{
    public const string NoCustomer = "(нет клиента)";

    public static Dictionary<string, decimal> ByCity(IReadOnlyList<Customer> customers, IReadOnlyList<Order> orders)
    {
        // Один проход по клиентам: дальше город ищется за O(1), а не перебором списка.
        var cityById = new Dictionary<int, string>(customers.Count);
        foreach (var c in customers)
            cityById[c.Id] = c.City;

        var result = new Dictionary<string, decimal>();
        foreach (var order in orders)
        {
            var city = cityById.TryGetValue(order.CustomerId, out var x) ? x : NoCustomer;
            result[city] = result.GetValueOrDefault(city) + order.Amount;
        }
        return result;
    }

    public static List<Customer> WithoutOrders(IReadOnlyList<Customer> customers, IReadOnlyList<Order> orders)
    {
        var withOrders = orders.Select(o => o.CustomerId).ToHashSet();
        return customers.Where(c => !withOrders.Contains(c.Id)).ToList();
    }
}
