---
title: Что поменялось в настройках
level: 1
topics: csharp-collections
minutes: 15
---
Журнал аудита показывает, что изменилось в настройках между двумя версиями. Обе версии — словари «ключ → значение».

- `Added` — ключи, которых не было; `Removed` — ключи, которые пропали; `Changed` — ключи, у которых значение стало другим.
- Ключи сравниваются **без учёта регистра** (`Timeout` и `timeout` — один ключ), значения — точно.
- Каждый список отсортирован (`StringComparer.Ordinal`), ключи в нём — как написаны в новой версии (для `Removed` — в старой).

---starter
```csharp
public record Diff(List<string> Added, List<string> Removed, List<string> Changed);

public static class Kata
{
    public static Diff Compare(IReadOnlyDictionary<string, string> before, IReadOnlyDictionary<string, string> after)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея.** Три вопроса — три прохода, каждый с поиском в словаре за O(1): что есть в новом, но нет в старом;
что есть в старом, но нет в новом; что есть в обоих, но различается. Итого O(n + m).

**Регистр ключей — это решение о сравнении, а не о данных.** Можно было бы привести все ключи к нижнему регистру, но тогда
в журнале покажется не то, что написал человек. Правильнее сравнивать **компаратором**: построить
`new Dictionary<string, string>(before, StringComparer.OrdinalIgnoreCase)` — и поиск сам станет нечувствительным к регистру,
а ключи сохранят исходное написание.

**Почему не `Except`.** `after.Keys.Except(before.Keys)` хорош для `Added` и `Removed`, но для `Changed` всё равно нужен поиск
по ключу. Плюс у `Except` тоже есть перегрузка с компаратором — про неё часто забывают.

**Где встречается:** синхронизация справочников (что создать, удалить, обновить), миграции конфигов, сравнение снапшотов в тестах.

---solution
```csharp
public record Diff(List<string> Added, List<string> Removed, List<string> Changed);

public static class Kata
{
    public static Diff Compare(IReadOnlyDictionary<string, string> before, IReadOnlyDictionary<string, string> after)
    {
        var old = new Dictionary<string, string>(before, StringComparer.OrdinalIgnoreCase);
        var now = new Dictionary<string, string>(after, StringComparer.OrdinalIgnoreCase);

        var added = after.Keys.Where(k => !old.ContainsKey(k)).Order(StringComparer.Ordinal).ToList();
        var removed = before.Keys.Where(k => !now.ContainsKey(k)).Order(StringComparer.Ordinal).ToList();
        var changed = after.Where(kv => old.TryGetValue(kv.Key, out var v) && v != kv.Value)
            .Select(kv => kv.Key).Order(StringComparer.Ordinal).ToList();
        return new Diff(added, removed, changed);
    }
}
```
