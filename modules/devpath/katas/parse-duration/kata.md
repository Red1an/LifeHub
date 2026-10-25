---
title: Длительность «1h30m»
level: 1
topics: csharp-strings, csharp-exceptions
minutes: 20
---
В конфиге таймауты пишут по-человечески: `1h30m`, `45s`, `2h 5m 10s`. Напиши разбор.

- Части: число и единица `h`, `m`, `s` или `ms`. Порядок единиц — строго от крупных к мелким, каждая не больше одного раза.
- Между частями могут быть пробелы, регистр единиц не важен. Числа — целые, без знака.
- Неверная строка (`""`, `"10"`, `"5x"`, `"1m1h"`, `"1h1h"`, `"-5s"`) — `TryParse` возвращает `false`, а не бросает исключение.

```csharp
Kata.TryParse("1h30m", out var t)   // true, t = 01:30:00
Kata.TryParse("5x", out _)          // false
```

---starter
```csharp
public static class Kata
{
    public static bool TryParse(string text, out TimeSpan value)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Почему `TryParse`, а не `Parse` с исключением.** Неверный ввод от человека — ожидаемая ситуация, а не исключительная.
Исключения дороже и захламляют логи. Паттерн `bool TryX(…, out T)` — стандарт .NET (`int.TryParse`, `Dictionary.TryGetValue`);
`Parse`, который бросает исключение, обычно делают поверх `TryParse`.

**Идея.** Идём по строке: пропускаем пробелы, читаем цифры, читаем буквы единицы. Чтобы проверить порядок,
у каждой единицы есть «ранг» (h=0, m=1, s=2, ms=3), и ранг должен строго расти.

**Ловушка с `m` и `ms`.** Если читать единицу по одной букве, `500ms` разберётся как «500 минут» и «s без числа».
Читай все буквы подряд и сравнивай целиком. Это классическая ошибка лексеров: брать самое длинное совпадение.

**Регулярка — тоже вариант:** `^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?!s))?…$`. Короче, но сложнее читать и легко ошибиться.
Ручной разбор длиннее, но каждую проверку видно.

**Переполнение.** `99999999999999h` не помещается в `TimeSpan`. `checked` или `long.TryParse` + проверка спасают от тихого мусора.

---solution
```csharp
public static class Kata
{
    private static readonly string[] Units = ["h", "m", "s", "ms"];

    public static bool TryParse(string text, out TimeSpan value)
    {
        value = TimeSpan.Zero;
        var total = TimeSpan.Zero;
        var lastRank = -1;
        var i = 0;
        var parts = 0;
        while (true)
        {
            while (i < text.Length && char.IsWhiteSpace(text[i])) i++;
            if (i == text.Length) break;

            var start = i;
            while (i < text.Length && char.IsAsciiDigit(text[i])) i++;
            if (i == start || !long.TryParse(text.AsSpan(start, i - start), out var number)) return false;

            while (i < text.Length && char.IsWhiteSpace(text[i])) i++;
            start = i;
            while (i < text.Length && char.IsAsciiLetter(text[i])) i++;
            var rank = Array.IndexOf(Units, text[start..i].ToLowerInvariant());
            if (rank <= lastRank) return false; // нет единицы, повтор или неверный порядок
            lastRank = rank;

            try
            {
                total += rank switch
                {
                    0 => TimeSpan.FromHours(number),
                    1 => TimeSpan.FromMinutes(number),
                    2 => TimeSpan.FromSeconds(number),
                    _ => TimeSpan.FromMilliseconds(number),
                };
            }
            catch (OverflowException) { return false; }
            catch (ArgumentOutOfRangeException) { return false; }
            parts++;
        }
        if (parts == 0) return false;
        value = total;
        return true;
    }
}
```
