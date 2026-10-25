---
title: Самые частые слова
level: 1
topics: csharp-collections, csharp-linq, csharp-strings
minutes: 15
---
Для облака тегов нужно найти `n` самых частых слов в тексте.

- Слово — непрерывная последовательность букв (`char.IsLetter`) и цифр; всё остальное — разделители.
- Регистр не важен: «Кот» и «кот» — одно слово, в ответе — в нижнем регистре.
- Сортировка: по убыванию частоты, при равенстве — по алфавиту (`string.CompareOrdinal`).
- Слов меньше `n` — вернуть сколько есть. `n <= 0` — `ArgumentOutOfRangeException`.

```csharp
Kata.Top("Кот и пёс. Кот!", 2)   // [("кот", 2), ("и", 1)]
```

---starter
```csharp
public static class Kata
{
    public static List<(string Word, int Count)> Top(string text, int n)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея.** Один проход по тексту, словарь «слово → сколько раз», потом сортировка пар. Слова можно собирать вручную
(`StringBuilder` и проверка `char.IsLetterOrDigit`) или `Regex.Matches(text, @"[\p{L}\p{N}]+")`.

**Почему словарь, а не `GroupBy`.** `text.Split(...).GroupBy(w => w)` тоже работает и читается приятно. Внутри он тоже хэш-таблица,
но хранит все вхождения каждого слова списком. Для частот это лишняя память: словарь хранит только число.

**Сложность.** O(L) на подсчёт (L — длина текста) и O(U log U) на сортировку (U — уникальных слов). Если `n` маленькое,
а уникальных слов миллион, полную сортировку можно заменить кучей на `n` элементов — `PriorityQueue` — O(U log n).

**Типичные ошибки:**
- `Split(' ')` — пунктуация прилипает к словам («кот!» ≠ «кот»), двойные пробелы дают пустые строки;
- `ToLower()` без `Invariant` — зависит от языка системы;
- сравнение строк при сортировке через `CompareTo` — тоже зависит от культуры; для стабильного результата — ordinal.

---solution
```csharp
public static class Kata
{
    public static List<(string Word, int Count)> Top(string text, int n)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(n);
        var counts = new Dictionary<string, int>();
        var word = new System.Text.StringBuilder();

        void Flush()
        {
            if (word.Length == 0) return;
            var w = word.ToString().ToLowerInvariant();
            counts[w] = counts.GetValueOrDefault(w) + 1;
            word.Clear();
        }

        foreach (var ch in text)
        {
            if (char.IsLetterOrDigit(ch)) word.Append(ch);
            else Flush();
        }
        Flush();

        return counts
            .OrderByDescending(x => x.Value)
            .ThenBy(x => x.Key, StringComparer.Ordinal)
            .Take(n)
            .Select(x => (x.Key, x.Value))
            .ToList();
    }
}
```
