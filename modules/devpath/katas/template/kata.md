---
title: Шаблон письма
level: 1
topics: csharp-strings, csharp-exceptions
minutes: 20
---
Письма собираются из шаблонов: `Здравствуйте, {name}! Ваш заказ №{order} готов.`

- `{ключ}` заменяется значением из словаря (`ToString()`), `null` — пустая строка.
- `{{` и `}}` — это просто символы `{` и `}`.
- Ключа нет в словаре — `KeyNotFoundException` с именем ключа в сообщении (лучше упасть при проверке шаблона, чем отправить письмо с `{name}`).
- Незакрытая `{` или одиночная `}` — `FormatException`.

```csharp
Kata.Render("Привет, {name}! {{скидка}}", new Dictionary<string, object?> { ["name"] = "Аня" })
// "Привет, Аня! {скидка}"
```

---starter
```csharp
public static class Kata
{
    public static string Render(string template, IReadOnlyDictionary<string, object?> values)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Почему не `Replace` в цикле.** `template.Replace("{" + key + "}", value)` по всем ключам ломается двумя способами:
не знает про `{{`, и **подставляет внутрь подставленного**: если имя пользователя `{order}`, второй `Replace` заменит и его.
Это уже не баг, а дыра — пользователь управляет тем, что попадёт в письмо (template injection).

**Идея.** Один проход слева направо: обычный текст копируем, `{{`/`}}` — один символ, `{` — читаем имя до `}` и подставляем.
Подставленное значение больше не разбираем — поэтому инъекция невозможна.

**Почему исключение на отсутствующий ключ.** «Тихо оставить `{name}`» или «тихо подставить пустоту» — это письмо клиенту
«Здравствуйте, !». Громкая ошибка ловится в тестах шаблонов, тихая — в жалобах.

**В реальной жизни** — `string.Format` с позиционными `{0}`, интерполяция `$"..."` (если шаблон известен при компиляции)
или движки шаблонов (Scriban, Razor) для писем со списками и условиями.

---solution
```csharp
public static class Kata
{
    public static string Render(string template, IReadOnlyDictionary<string, object?> values)
    {
        var sb = new System.Text.StringBuilder(template.Length);
        for (var i = 0; i < template.Length; i++)
        {
            var ch = template[i];
            var next = i + 1 < template.Length ? template[i + 1] : '\0';
            if (ch == '{' && next == '{') { sb.Append('{'); i++; }
            else if (ch == '}' && next == '}') { sb.Append('}'); i++; }
            else if (ch == '}') throw new FormatException($"Одиночная }} в позиции {i}");
            else if (ch == '{')
            {
                var end = template.IndexOf('}', i + 1);
                if (end < 0) throw new FormatException($"Незакрытая {{ в позиции {i}");
                var key = template[(i + 1)..end];
                if (!values.TryGetValue(key, out var value)) throw new KeyNotFoundException($"Нет значения для {{{key}}}");
                sb.Append(value?.ToString());
                i = end;
            }
            else sb.Append(ch);
        }
        return sb.ToString();
    }
}
```
