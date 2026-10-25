using Microsoft.EntityFrameworkCore;

namespace Exchange.Api;

public class Account
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Name { get; set; }
    public decimal Cash { get; set; }
    public decimal ReservedCash { get; set; }
    public List<Position> Positions { get; set; } = [];
}

public class Position
{
    public Guid AccountId { get; set; }
    public required string Ticker { get; set; }
    public int Qty { get; set; }
    public int Reserved { get; set; }
}

public class Instrument
{
    public required string Ticker { get; set; }
    public required string Name { get; set; }
    public decimal Tick { get; set; } = 0.01m;
}

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AccountId { get; set; }
    public required string Ticker { get; set; }
    public required string Side { get; set; }
    public decimal Price { get; set; }
    public int Qty { get; set; }
    public int Filled { get; set; }
    public string Status { get; set; } = "new";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Порядок поступления — приоритет времени. Время в мс может совпасть, счётчик — нет.</summary>
    public long Seq { get; set; }
}

public class Trade
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Ticker { get; set; }
    public decimal Price { get; set; }
    public int Qty { get; set; }
    public Guid BuyOrderId { get; set; }
    public Guid SellOrderId { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public long Seq { get; set; }
}

public class ExchangeDb(DbContextOptions<ExchangeDb> options) : DbContext(options)
{
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Position> Positions => Set<Position>();
    public DbSet<Instrument> Instruments => Set<Instrument>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Trade> Trades => Set<Trade>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Position>().HasKey(p => new { p.AccountId, p.Ticker });
        b.Entity<Instrument>().HasKey(i => i.Ticker);
        b.Entity<Account>().Property(a => a.Cash).HasPrecision(18, 2);
        b.Entity<Account>().Property(a => a.ReservedCash).HasPrecision(18, 2);
        b.Entity<Order>().Property(o => o.Price).HasPrecision(18, 2);
        b.Entity<Order>().Property(o => o.Seq).UseIdentityAlwaysColumn();
        b.Entity<Order>().HasIndex(o => new { o.Ticker, o.Status });
        b.Entity<Trade>().Property(t => t.Price).HasPrecision(18, 2);
        b.Entity<Trade>().Property(t => t.Seq).UseIdentityAlwaysColumn();
        b.Entity<Trade>().HasIndex(t => new { t.Ticker, t.Seq });
        b.Entity<Instrument>().HasData(
            new Instrument { Ticker = "SBER", Name = "Сбербанк" },
            new Instrument { Ticker = "GAZP", Name = "Газпром" },
            new Instrument { Ticker = "LKOH", Name = "Лукойл" });
    }
}
