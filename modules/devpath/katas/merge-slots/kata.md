---
title: Занятые слоты в календаре
level: 1
topics: cs-arrays, cs-complexity
minutes: 20
---
Календарь переговорки хранит брони как отрезки времени в минутах от начала дня `(Start, End)`, конец не включается.
Нужно показать, когда комната занята: склеить пересекающиеся и **соприкасающиеся** брони.

- `(60, 120)` и `(90, 150)` → `(60, 150)`;
- `(60, 120)` и `(120, 180)` → `(60, 180)` — встречи встык, комната занята без перерыва;
- брони приходят в любом порядке; результат — по возрастанию `Start`;
- бронь с `End <= Start` — `ArgumentException`.

```csharp
Kata.Merge([(90, 150), (60, 120), (200, 230)])  // [(60, 150), (200, 230)]
```

---starter
```csharp
public static class Kata
{
    public static List<(int Start, int End)> Merge(IEnumerable<(int Start, int End)> slots)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея.** Отсортировать по началу. Тогда пересекаться могут только соседние: идём по порядку и либо расширяем текущий отрезок
(`next.Start <= current.End`), либо закрываем его и начинаем новый.

**Почему сортировка обязательна.** Без неё каждый отрезок пришлось бы сравнивать со всеми — O(n²), и склейка цепочкой
(A пересекается с C только через B) потребовала бы повторных проходов. Сортировка O(n log n) + один проход O(n).

**Ловушки:**
- `<` вместо `<=` — встречи встык не склеиваются;
- `current.End = next.End` вместо `Math.Max` — сломается, если следующий отрезок целиком внутри текущего (`(60, 300)` и `(90, 120)`);
- забыть добавить последний отрезок после цикла.

**Где встречается в работе:** занятость ресурсов, объединение диапазонов IP, «рабочее время» сотрудника по сменам,
объединение диапазонов дат в отчёте.

---solution
```csharp
public static class Kata
{
    public static List<(int Start, int End)> Merge(IEnumerable<(int Start, int End)> slots)
    {
        var sorted = slots.ToList();
        if (sorted.Any(s => s.End <= s.Start))
            throw new ArgumentException("Конец брони должен быть позже начала");
        sorted.Sort((a, b) => a.Start.CompareTo(b.Start));

        var result = new List<(int Start, int End)>();
        foreach (var s in sorted)
        {
            if (result.Count > 0 && s.Start <= result[^1].End)
                result[^1] = (result[^1].Start, Math.Max(result[^1].End, s.End));
            else
                result.Add(s);
        }
        return result;
    }
}
```
