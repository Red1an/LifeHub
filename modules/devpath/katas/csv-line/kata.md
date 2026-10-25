---
title: Разбор строки CSV
level: 1
topics: csharp-strings
minutes: 20
---
Банк присылает выписку в CSV. Разбери одну строку на поля.

- Разделитель — запятая.
- Поле в двойных кавычках может содержать запятые: `"Иванов, ИП"` — одно поле `Иванов, ИП`.
- Кавычка внутри такого поля записывается двумя: `"ООО ""Ромашка"""` → `ООО "Ромашка"`.
- Поля без кавычек берутся как есть (пробелы не обрезать).
- Пустая строка — одно пустое поле. Незакрытая кавычка — `FormatException`.

```csharp
Kata.Parse("2026-10-01,\"Иванов, ИП\",1500.00")  // ["2026-10-01", "Иванов, ИП", "1500.00"]
```

---starter
```csharp
public static class Kata
{
    public static List<string> Parse(string line)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея — конечный автомат.** Идём по символам и помним одно состояние: внутри кавычек мы или нет.
- Вне кавычек: `,` — конец поля, `"` в начале поля — вход в кавычки, остальное — в поле.
- Внутри: `"` + `"` — это одна кавычка в тексте; `"` + что-то другое — выход из кавычек; остальное — в поле.

**Почему не `Split(',')`.** Он не знает про кавычки и разрежет `"Иванов, ИП"` пополам. Регулярное выражение для CSV
существует, но его сложно читать и проверить. Автомат — короткий и очевидно правильный код.

**В реальном проекте** CSV разбирают библиотекой (CsvHelper): там ещё переносы строк внутри кавычек, другие разделители,
кодировки и BOM. Но собеседования и тестовые задания любят именно эту задачу: она проверяет, умеешь ли ты думать состояниями.

**Ловушки:** забыть добавить последнее поле после цикла; потерять пустое поле в конце (`a,` — это два поля);
выйти за границу строки, проверяя «следующий символ».

---solution
```csharp
public static class Kata
{
    public static List<string> Parse(string line)
    {
        var fields = new List<string>();
        var field = new System.Text.StringBuilder();
        var quoted = false;

        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (quoted)
            {
                if (ch != '"') field.Append(ch);
                else if (i + 1 < line.Length && line[i + 1] == '"') { field.Append('"'); i++; }
                else quoted = false;
            }
            else if (ch == ',') { fields.Add(field.ToString()); field.Clear(); }
            else if (ch == '"' && field.Length == 0) quoted = true;
            else field.Append(ch);
        }

        if (quoted) throw new FormatException("Незакрытая кавычка");
        fields.Add(field.ToString());
        return fields;
    }
}
```
