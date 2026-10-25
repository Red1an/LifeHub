---
title: Хлебные крошки категорий
level: 2
topics: cs-trees, csharp-collections
minutes: 25
---
Категории каталога хранятся плоским списком `(Id, ParentId, Name)`, `ParentId = null` — корень.
Для «хлебных крошек» нужен полный путь каждой категории: `Электроника > Телефоны > Смартфоны`.

- Результат — словарь «Id → путь», разделитель `" > "`.
- Родитель с несуществующим `Id` — `InvalidOperationException` (битые данные).
- Цикл (`A → B → A`) — `InvalidOperationException`, а не вечный цикл или переполнение стека.
- 50 000 категорий глубиной до 20 — быстро: путь родителя не пересчитывать для каждого ребёнка заново.

---starter
```csharp
public record Category(int Id, int? ParentId, string Name);

public static class Kata
{
    public static Dictionary<int, string> Paths(IReadOnlyList<Category> categories)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея — словарь + запоминание.** Сначала `Id → категория` для поиска родителя за O(1). Путь категории = путь родителя + имя.
Если пути уже посчитанных категорий запоминать (мемоизация), каждый путь считается ровно один раз — O(n) на всё дерево.
Без запоминания для каждой категории заново проходится вся цепочка родителей: O(n · глубина).

**Цикл.** Данные из базы бывают битыми. Во время подсчёта держи множество «сейчас в процессе»: если снова пришёл в категорию,
которая в процессе, — это цикл. Это тот же приём, что поиск цикла в графе обходом в глубину («серые» вершины).

**Рекурсия или явный стек.** Рекурсия читается проще, и при глубине 20 стек не страшен. Но если глубина не ограничена
(например, комментарии с ответами на ответы), рекурсия переполнит стек — тогда идут вверх по цепочке циклом, складывая
категории в список, и потом разворачивают.

**В базе** то же решают рекурсивным CTE (`WITH RECURSIVE`) или хранят путь заранее (materialized path, `ltree` в PostgreSQL),
если дерево читают часто, а меняют редко.

---solution
```csharp
public record Category(int Id, int? ParentId, string Name);

public static class Kata
{
    public static Dictionary<int, string> Paths(IReadOnlyList<Category> categories)
    {
        var byId = categories.ToDictionary(c => c.Id);
        var paths = new Dictionary<int, string>(categories.Count);
        var inProgress = new HashSet<int>();

        string PathOf(int id)
        {
            if (paths.TryGetValue(id, out var known)) return known;
            if (!byId.TryGetValue(id, out var c)) throw new InvalidOperationException($"Нет категории {id}");
            if (!inProgress.Add(id)) throw new InvalidOperationException($"Цикл через категорию {id}");
            var path = c.ParentId is int parent ? $"{PathOf(parent)} > {c.Name}" : c.Name;
            inProgress.Remove(id);
            return paths[id] = path;
        }

        foreach (var c in categories) PathOf(c.Id);
        return paths;
    }
}
```
