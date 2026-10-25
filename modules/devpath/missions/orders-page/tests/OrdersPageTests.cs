using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Orders;

/// <summary>Считает SQL-запросы, которые EF Core отправил в базу.</summary>
public sealed class SqlCounter : DbCommandInterceptor
{
    public List<string> Commands { get; } = [];

    public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        Commands.Add(command.CommandText);
        return result;
    }
}

/// <summary>Одна база на все тесты класса: 3000 заказов с позициями.</summary>
public sealed class ShopFixture : IDisposable
{
    public SqliteConnection Connection { get; } = new("DataSource=:memory:");
    public List<(int Id, string Customer, DateTime CreatedAt, long Total, int Items)> Expected { get; } = [];

    public ShopFixture()
    {
        Connection.Open();
        using var db = Create(null);
        db.Database.EnsureCreated();
        var rnd = new Random(7);
        var customers = Enumerable.Range(1, 300).Select(i => new Customer { Name = $"Клиент {i}" }).ToList();
        db.Customers.AddRange(customers);
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 3000; i++)
        {
            var c = customers[rnd.Next(customers.Count)];
            var order = new Order { Customer = c, CreatedAt = start.AddMinutes(rnd.Next(0, 400_000) * 3 + i % 3) };
            for (var k = rnd.Next(1, 6); k > 0; k--)
                order.Lines.Add(new OrderLine { Product = $"Товар {rnd.Next(100)}", PriceKopecks = rnd.Next(100, 500_000), Qty = rnd.Next(1, 4) });
            db.Orders.Add(order);
        }
        db.SaveChanges();
        foreach (var o in db.Orders.Include(o => o.Customer).Include(o => o.Lines).AsNoTracking().ToList())
            Expected.Add((o.Id, o.Customer.Name, o.CreatedAt, o.Lines.Sum(l => l.PriceKopecks * l.Qty), o.Lines.Sum(l => l.Qty)));
        Expected.Sort((a, b) => b.CreatedAt != a.CreatedAt ? b.CreatedAt.CompareTo(a.CreatedAt) : b.Id.CompareTo(a.Id));
    }

    public ShopDb Create(SqlCounter? counter)
    {
        var options = new DbContextOptionsBuilder<ShopDb>().UseSqlite(Connection);
        if (counter is not null) options.AddInterceptors(counter);
        return new ShopDb(options.Options);
    }

    public void Dispose() => Connection.Dispose();
}

public class OrdersPageTests(ShopFixture shop) : IClassFixture<ShopFixture>
{
    static void AssertRows(IEnumerable<(int Id, string Customer, DateTime CreatedAt, long Total, int Items)> expected, List<OrderRow> rows)
    {
        Assert.Equal(expected.Select(e => (e.Id, e.Customer, e.Total, e.Items)), rows.Select(r => (r.Id, r.Customer, r.TotalKopecks, r.Items)));
    }

    [Fact(DisplayName = "1. Первая страница: новые заказы сверху, суммы верные")]
    public void FirstPage()
    {
        using var db = shop.Create(null);
        AssertRows(shop.Expected.Take(20), new OrdersPage(db).Load(1, 20));
    }

    [Fact(DisplayName = "2. Пятая страница по 50 — без пропусков и повторов")]
    public void FifthPage()
    {
        using var db = shop.Create(null);
        AssertRows(shop.Expected.Skip(200).Take(50), new OrdersPage(db).Load(5, 50));
    }

    [Fact(DisplayName = "3. Страница загружается не больше чем двумя SQL-запросами")]
    public void FewQueries()
    {
        var counter = new SqlCounter();
        using var db = shop.Create(counter);
        new OrdersPage(db).Load(1, 20);
        Assert.True(counter.Commands.Count <= 2, $"Запросов к базе: {counter.Commands.Count}");
    }

    [Fact(DisplayName = "4. Пропуск и лимит делает база, а не C#")]
    public void PagingInDatabase()
    {
        var counter = new SqlCounter();
        using var db = shop.Create(counter);
        new OrdersPage(db).Load(3, 20);
        Assert.Contains(counter.Commands, sql => sql.Contains("LIMIT", StringComparison.OrdinalIgnoreCase));
    }

    [Fact(DisplayName = "5. Страница только для чтения — EF ничего не отслеживает")]
    public void NoTracking()
    {
        using var db = shop.Create(null);
        new OrdersPage(db).Load(1, 20);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Theory(DisplayName = "6. Странные параметры — ArgumentOutOfRangeException")]
    [InlineData(0, 20)]
    [InlineData(1, 0)]
    [InlineData(1, 1000)]
    public void BadArguments(int page, int size)
    {
        using var db = shop.Create(null);
        Assert.Throws<ArgumentOutOfRangeException>(() => new OrdersPage(db).Load(page, size));
    }
}
