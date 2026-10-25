using System.Collections.Concurrent;

namespace Stats;

public class ViewCounter
{
    // ConcurrentDictionary безопасен для одновременного чтения и записи из разных потоков.
    private readonly ConcurrentDictionary<string, int> _views = new();
    private int _total;

    public void Hit(string page)
    {
        // AddOrUpdate атомарен для ключа: «прочитать — прибавить — записать» не перемешается с другим потоком.
        _views.AddOrUpdate(page, 1, (_, v) => v + 1);
        // ++ — это три действия (прочитать, прибавить, записать). Interlocked делает их одной инструкцией процессора.
        Interlocked.Increment(ref _total);
    }

    public int Get(string page) => _views.TryGetValue(page, out var v) ? v : 0;

    public int Total => Volatile.Read(ref _total);

    // Копия, а не ссылка на внутренний словарь: снаружи его не изменят и не увидят «живые» изменения.
    public IReadOnlyDictionary<string, int> Snapshot() => new Dictionary<string, int>(_views);
}
