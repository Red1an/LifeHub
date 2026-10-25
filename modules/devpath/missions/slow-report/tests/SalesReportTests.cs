using System.Diagnostics;
using Report;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

public class SalesReportTests
{
    static readonly Customer[] Few =
    [
        new(1, "Аня", "Москва"),
        new(2, "Борис", "Казань"),
        new(3, "Вера", "Москва"),
        new(4, "Гоша", "Сочи"),
    ];

    static readonly Order[] FewOrders =
    [
        new(1, 1, 100m),
        new(2, 2, 50m),
        new(3, 3, 25.5m),
        new(4, 1, 10m),
    ];

    [Fact(DisplayName = "1. Суммы по городам считаются верно")]
    public void ByCityIsCorrect()
    {
        var r = SalesReport.ByCity(Few, FewOrders);
        Assert.Equal(135.5m, r["Москва"]);
        Assert.Equal(50m, r["Казань"]);
        Assert.False(r.ContainsKey("Сочи"), "У Сочи нет заказов — в отчёте его быть не должно");
    }

    [Fact(DisplayName = "2. Заказ удалённого клиента не роняет отчёт")]
    public void OrphanOrder()
    {
        var r = SalesReport.ByCity(Few, [.. FewOrders, new Order(5, 99, 7m)]);
        Assert.Equal(7m, r[SalesReport.NoCustomer]);
    }

    [Fact(DisplayName = "3. Клиенты без заказов — в исходном порядке")]
    public void WithoutOrdersIsCorrect()
    {
        var r = SalesReport.WithoutOrders(Few, FewOrders);
        Assert.Equal([4], r.Select(c => c.Id));
    }

    static (Customer[] Customers, Order[] Orders) Big()
    {
        var rnd = new Random(42);
        string[] cities = ["Москва", "Казань", "Сочи", "Омск", "Тула", "Пермь"];
        var customers = Enumerable.Range(1, 20_000).Select(i => new Customer(i, $"Клиент {i}", cities[i % cities.Length])).ToArray();
        // Каждый пятый клиент — без заказов.
        var orders = Enumerable.Range(0, 100_000).Select(i =>
        {
            var c = i % 20_000 + 1;
            if (c % 5 == 0) c--;
            return new Order(i, c, rnd.Next(100, 10_000));
        }).OrderBy(_ => rnd.Next()).ToArray();
        return (customers, orders);
    }

    [Fact(DisplayName = "4. ByCity: 20 000 клиентов и 100 000 заказов — быстрее 300 мс")]
    public void ByCityIsFast()
    {
        var (customers, orders) = Big();
        SalesReport.ByCity(Few, FewOrders); // прогрев JIT
        var sw = Stopwatch.StartNew();
        var r = SalesReport.ByCity(customers, orders);
        sw.Stop();
        Assert.Equal(orders.Sum(o => o.Amount), r.Values.Sum());
        Assert.True(sw.ElapsedMilliseconds < 300, $"Заняло {sw.ElapsedMilliseconds} мс");
    }

    [Fact(DisplayName = "5. WithoutOrders: 20 000 клиентов и 100 000 заказов — быстрее 300 мс")]
    public void WithoutOrdersIsFast()
    {
        var (customers, orders) = Big();
        SalesReport.WithoutOrders(Few, FewOrders);
        var sw = Stopwatch.StartNew();
        var r = SalesReport.WithoutOrders(customers, orders);
        sw.Stop();
        Assert.Equal(4_000, r.Count);
        Assert.True(sw.ElapsedMilliseconds < 300, $"Заняло {sw.ElapsedMilliseconds} мс");
    }
}
