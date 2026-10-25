---
title: LRU-кэш
level: 2
topics: cs-structures, dotnet-caching
minutes: 30
---
Кэш превью картинок держит в памяти не больше `capacity` элементов. Когда место кончается, выбрасывается тот,
к которому **дольше всех не обращались** (Least Recently Used).

- `TryGet(key, out value)` — есть ли значение; обращение делает элемент «свежим».
- `Put(key, value)` — добавить или заменить (замена тоже делает элемент свежим).
- Обе операции — O(1): кэш на миллион элементов не должен перебирать их.
- `Count` — сколько сейчас элементов. `capacity <= 0` — `ArgumentOutOfRangeException`.

---starter
```csharp
public class LruCache<TKey, TValue> where TKey : notnull
{
    public LruCache(int capacity)
    {
        throw new NotImplementedException();
    }

    public int Count => throw new NotImplementedException();

    public bool TryGet(TKey key, out TValue value)
    {
        throw new NotImplementedException();
    }

    public void Put(TKey key, TValue value)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея — две структуры вместе.** Словарь даёт поиск по ключу за O(1), но не знает порядка. Двусвязный список знает порядок
и умеет за O(1) перенести узел в начало или удалить последний, но не умеет искать. Вместе: словарь «ключ → узел списка».
Свежие — в начале, кандидат на выброс — в конце.

**Почему не `List<T>`.** Удаление из середины списка-массива — O(n): сдвигаются все элементы после. На миллионе элементов
каждая операция кэша станет миллисекундной. `LinkedList<T>` удаляет узел, просто переставив две ссылки.

**Почему не хранить «время последнего обращения».** Тогда для выброса пришлось бы искать минимум — O(n), или держать
отсортированную структуру — O(log n). Список даёт O(1) бесплатно: порядок и есть время.

**В реальной жизни** — `IMemoryCache` (вытеснение по размеру и времени жизни), а между серверами — Redis с политикой
`allkeys-lru`. Свой LRU пишут редко, но это классика собеседований на понимание структур данных.

**Ловушки:** при замене значения не перенести узел в начало; при выбросе удалить из списка, но забыть из словаря.

---solution
```csharp
public class LruCache<TKey, TValue> where TKey : notnull
{
    private readonly int _capacity;
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map = new();
    private readonly LinkedList<(TKey Key, TValue Value)> _order = new(); // начало — самые свежие

    public LruCache(int capacity)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);
        _capacity = capacity;
    }

    public int Count => _map.Count;

    public bool TryGet(TKey key, out TValue value)
    {
        if (_map.TryGetValue(key, out var node))
        {
            _order.Remove(node);
            _order.AddFirst(node);
            value = node.Value.Value;
            return true;
        }
        value = default!;
        return false;
    }

    public void Put(TKey key, TValue value)
    {
        if (_map.TryGetValue(key, out var node))
        {
            _order.Remove(node);
        }
        else if (_map.Count == _capacity)
        {
            var oldest = _order.Last!;
            _order.RemoveLast();
            _map.Remove(oldest.Value.Key);
        }
        _map[key] = _order.AddFirst((key, value));
    }
}
```
