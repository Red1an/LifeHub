namespace Report;

public record Customer(int Id, string Name, string City);

public record Order(int Id, int CustomerId, decimal Amount);

public static class SalesReport
{
    /// <summary>Сумма заказов по городам. Заказы без клиента — в группу NoCustomer.</summary>
    public static Dictionary<string, decimal> ByCity(IReadOnlyList<Customer> customers, IReadOnlyList<Order> orders)
    {
        var result = new Dictionary<string, decimal>();
        foreach (var order in orders)
        {
            var customer = customers.First(c => c.Id == order.CustomerId);
            if (!result.ContainsKey(customer.City))
                result[customer.City] = 0;
            result[customer.City] += order.Amount;
        }
        return result;
    }

    public const string NoCustomer = "(нет клиента)";

    /// <summary>Клиенты, у которых нет ни одного заказа, — в исходном порядке.</summary>
    public static List<Customer> WithoutOrders(IReadOnlyList<Customer> customers, IReadOnlyList<Order> orders)
    {
        return customers.Where(c => !orders.Any(o => o.CustomerId == c.Id)).ToList();
    }
}
