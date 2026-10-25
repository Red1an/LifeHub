using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Exchange.Api;

/// <summary>
/// Блокировки на стороне PostgreSQL: они работают для всех экземпляров API сразу, а не для одного процесса.
/// </summary>
public static class Locked
{
    /// <summary>Номер транзакционной блокировки «сведение». Снимается сама при COMMIT/ROLLBACK.</summary>
    private const long MatchingLock = 4242;

    /// <summary>
    /// Транзакция с повтором: если PostgreSQL прервал её из-за дедлока (40P01) или конфликта сериализации (40001),
    /// повторяем целиком — это нормальный способ работы с конкурентностью, а не ошибка.
    /// </summary>
    public static async Task<IResult> Run(ExchangeDb db, Func<Task<IResult>> body)
    {
        for (var attempt = 1; ; attempt++)
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            try
            {
                var result = await body();
                if (result is IStatusCodeHttpResult { StatusCode: >= 400 }) await tx.RollbackAsync();
                else await tx.CommitAsync();
                return result;
            }
            catch (Exception e) when (attempt < 5 && IsRetryable(e))
            {
                await tx.RollbackAsync();
                db.ChangeTracker.Clear();
                await Task.Delay(Random.Shared.Next(5, 30) * attempt);
            }
        }
    }

    public static Task Matching(ExchangeDb db) => db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({MatchingLock})");

    /// <summary>Блокировка сведения одного инструмента: разные инструменты сводятся параллельно.</summary>
    public static Task Matching(ExchangeDb db, string ticker) =>
        db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({(int)MatchingLock}::int, hashtext({ticker}))");

    /// <summary>
    /// SELECT … FOR UPDATE по счетам в порядке Id: одинаковый порядок у всех транзакций — дедлоков между ними нет.
    /// Возвращает false, если какого-то счёта нет.
    /// </summary>
    public static async Task<bool> Accounts(ExchangeDb db, IEnumerable<Guid> ids)
    {
        var list = ids.Distinct().OrderBy(id => id).ToArray();
        if (list.Length == 0) return true;
        var locked = await db.Database
            .SqlQuery<Guid>($"SELECT \"Id\" AS \"Value\" FROM \"Accounts\" WHERE \"Id\" = ANY({list}) ORDER BY \"Id\" FOR UPDATE")
            .ToListAsync();
        return locked.Count == list.Length;
    }

    private static bool IsRetryable(Exception e) =>
        e is PostgresException { SqlState: "40P01" or "40001" } || e.InnerException is PostgresException { SqlState: "40P01" or "40001" };
}
