---
title: Любимая категория клиента
level: 1
topics: csharp-linq
minutes: 15
---
Для персональных рекомендаций нужно для каждого клиента найти категорию, в которой он потратил больше всего.

- На входе продажи `Sale(Customer, Category, Amount)`.
- Результат — словарь «клиент → категория». При равных суммах — категория, которая раньше по алфавиту (`StringComparer.Ordinal`).
- Возвраты приходят с отрицательной суммой и тоже учитываются. Если у клиента по всем категориям сумма ≤ 0, его в результате нет.

```csharp
Kata.TopCategory([new("anna", "Книги", 500), new("anna", "Кофе", 300), new("anna", "Кофе", 400)])
// { "anna": "Кофе" }
```

---starter
```csharp
public record Sale(string Customer, string Category, decimal Amount);

public static class Kata
{
    public static Dictionary<string, string> TopCategory(IEnumerable<Sale> sales)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея.** Две группировки: сначала по клиенту, внутри — по категории с суммой. Потом у каждого клиента берём лучшую категорию.
В LINQ это читается почти как условие:

```csharp
sales.GroupBy(s => s.Customer)
     .Select(c => c.GroupBy(s => s.Category).Select(g => (g.Key, Sum: g.Sum(s => s.Amount))) …)
```

**`MaxBy` или сортировка.** `OrderByDescending(...).ThenBy(...).First()` сортирует все категории — O(k log k).
`MaxBy` за один проход — O(k), но правило «при равенстве — по алфавиту» с ним выразить сложнее. Для десятка категорий
разницы нет, и читаемость важнее. Если категорий тысячи — это повод задуматься.

**Почему это задача для базы.** В продакшене такая агрегация — `GROUP BY customer, category` в SQL, а не LINQ в памяти.
Но LINQ-группировки нужны постоянно: данные из API, файла, кэша.

**Ловушки:** забыть про возвраты (отрицательные суммы); сравнивать строки культурно-зависимо;
`ToDictionary` с дублирующимися ключами (здесь их нет, потому что группируем по клиенту).

---solution
```csharp
public record Sale(string Customer, string Category, decimal Amount);

public static class Kata
{
    public static Dictionary<string, string> TopCategory(IEnumerable<Sale> sales)
    {
        var result = new Dictionary<string, string>();
        foreach (var customer in sales.GroupBy(s => s.Customer))
        {
            var best = customer
                .GroupBy(s => s.Category)
                .Select(g => (Category: g.Key, Sum: g.Sum(s => s.Amount)))
                .Where(x => x.Sum > 0)
                .OrderByDescending(x => x.Sum)
                .ThenBy(x => x.Category, StringComparer.Ordinal)
                .FirstOrDefault();
            if (best.Category is not null)
                result[customer.Key] = best.Category;
        }
        return result;
    }
}
```
