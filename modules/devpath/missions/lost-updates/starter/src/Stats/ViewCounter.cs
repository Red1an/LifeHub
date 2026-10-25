namespace Stats;

/// <summary>Счётчик просмотров страниц. Один экземпляр на всё приложение, Hit вызывается из всех запросов сразу.</summary>
public class ViewCounter
{
    private readonly Dictionary<string, int> _views = new();
    private int _total;

    public void Hit(string page)
    {
        if (_views.ContainsKey(page))
            _views[page]++;
        else
            _views[page] = 1;
        _total++;
    }

    public int Get(string page) => _views.TryGetValue(page, out var v) ? v : 0;

    public int Total => _total;

    /// <summary>Снимок для отчёта: не должен меняться после того, как его получили.</summary>
    public IReadOnlyDictionary<string, int> Snapshot() => _views;
}
