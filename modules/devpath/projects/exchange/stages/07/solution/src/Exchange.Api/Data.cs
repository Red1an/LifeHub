using Microsoft.EntityFrameworkCore;

namespace Exchange.Api;

public class Account
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Владелец счёта. Доступ к счёту — у владельца и у администратора.</summary>
    public Guid OwnerId { get; set; }
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

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Login { get; set; }
    /// <summary>PBKDF2: соль, число итераций и хэш — пароль в открытом виде не хранится нигде.</summary>
    public required string PasswordHash { get; set; }
    public bool IsAdmin { get; set; }
}

/// <summary>Refresh-токен хранится хэшем: утёкшая база не даёт войти чужими токенами.</summary>
public class RefreshToken
{
    public required string Hash { get; set; }
    public Guid UserId { get; set; }
    public DateTime ExpiresAt { get; set; }
    /// <summary>Использован или отозван — повтор отклоняется (ротация).</summary>
    public DateTime? UsedAt { get; set; }
}

/// <summary>Ответ на запрос с ключом идемпотентности: повтор получает тот же ответ.</summary>
public class IdempotencyRecord
{
    public Guid UserId { get; set; }
    public required string Key { get; set; }
    public required string RequestHash { get; set; }
    public Guid OrderId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ExchangeDb(DbContextOptions<ExchangeDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Position> Positions => Set<Position>();
    public DbSet<Instrument> Instruments => Set<Instrument>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Trade> Trades => Set<Trade>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Position>().HasKey(p => new { p.AccountId, p.Ticker });
        b.Entity<User>().HasIndex(u => u.Login).IsUnique();
        b.Entity<RefreshToken>().HasKey(t => t.Hash);
        b.Entity<IdempotencyRecord>().HasKey(r => new { r.UserId, r.Key });
        b.Entity<Account>().HasIndex(a => a.OwnerId);
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
