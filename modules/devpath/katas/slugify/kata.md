---
title: Адрес статьи из заголовка
level: 1
topics: csharp-strings
minutes: 15
---
Блог строит адрес статьи из заголовка: «Привет, Мир! C# 10» → `privet-mir-c-10`.

- Русские буквы — латиницей по таблице ниже, остальные латинские буквы и цифры — как есть, всё в нижнем регистре.
- Любые другие символы (пробелы, знаки, эмодзи) — разделители. Подряд идущие разделители дают **один** дефис.
- Дефисов в начале и в конце нет. Длина — не больше `maxLength` символов (по умолчанию 60), и обрезка не оставляет дефис в конце.

Таблица: а-a б-b в-v г-g д-d е-e ё-e ж-zh з-z и-i й-y к-k л-l м-m н-n о-o п-p р-r с-s т-t у-u ф-f х-kh ц-ts ч-ch ш-sh щ-shch
ъ-(ничего) ы-y ь-(ничего) э-e ю-yu я-ya.

---starter
```csharp
public static class Kata
{
    public static string Slugify(string title, int maxLength = 60)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея.** Один проход по строке: каждую букву переводим в «кусочек латиницы», а вместо разделителей ставим дефис,
только если предыдущий символ результата — не дефис. В конце убираем крайние дефисы и обрезаем.

**Почему `StringBuilder`.** Строки в .NET неизменяемые: `result += x` в цикле создаёт новую строку на каждой итерации
и копирует всё накопленное. На заголовке разницы нет, на мегабайтном тексте — O(n²). `StringBuilder` дописывает в буфер.

**Таблица — данные, а не код.** Словарь `Dictionary<char, string>` или `switch`-выражение читается и правится легче,
чем 33 `if`. И его можно отдельно проверить.

**Ловушки:** обрезка по `maxLength` после удаления дефисов может оставить новый дефис в конце; `char.IsLetter` пропустит
кириллицу в «остальные буквы», если проверять таблицу после; `ToLower()` без `Invariant`.

---solution
```csharp
public static class Kata
{
    private static readonly Dictionary<char, string> Ru = new()
    {
        ['а'] = "a", ['б'] = "b", ['в'] = "v", ['г'] = "g", ['д'] = "d", ['е'] = "e", ['ё'] = "e", ['ж'] = "zh",
        ['з'] = "z", ['и'] = "i", ['й'] = "y", ['к'] = "k", ['л'] = "l", ['м'] = "m", ['н'] = "n", ['о'] = "o",
        ['п'] = "p", ['р'] = "r", ['с'] = "s", ['т'] = "t", ['у'] = "u", ['ф'] = "f", ['х'] = "kh", ['ц'] = "ts",
        ['ч'] = "ch", ['ш'] = "sh", ['щ'] = "shch", ['ъ'] = "", ['ы'] = "y", ['ь'] = "", ['э'] = "e", ['ю'] = "yu", ['я'] = "ya",
    };

    public static string Slugify(string title, int maxLength = 60)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var raw in title)
        {
            var ch = char.ToLowerInvariant(raw);
            if (Ru.TryGetValue(ch, out var lat)) sb.Append(lat);
            else if (ch is >= 'a' and <= 'z' or >= '0' and <= '9') sb.Append(ch);
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }
        var slug = sb.ToString().Trim('-');
        return slug.Length <= maxLength ? slug : slug[..maxLength].TrimEnd('-');
    }
}
```
