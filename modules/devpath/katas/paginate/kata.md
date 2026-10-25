---
title: Страница списка
level: 1
topics: csharp-generics, dotnet-api
minutes: 15
---
API отдаёт списки страницами. Напиши обобщённую функцию, которая режет список и возвращает данные для интерфейса.

- `page` — с 1, `size` — от 1 до 100; иначе `ArgumentOutOfRangeException`.
- `TotalPages` — сколько всего страниц (для пустого списка — 0).
- Страница за концом списка — пустая, но не ошибка (`Items` пустой, `TotalPages` честный).
- `HasNext` — есть ли следующая страница.

```csharp
Kata.Paginate([1, 2, 3, 4, 5], page: 2, size: 2)
// Page { Items = [3, 4], Page = 2, Size = 2, TotalItems = 5, TotalPages = 3, HasNext = true }
```

---starter
```csharp
public record Page<T>(IReadOnlyList<T> Items, int Number, int Size, int TotalItems, int TotalPages, bool HasNext);

public static class Kata
{
    public static Page<T> Paginate<T>(IReadOnlyList<T> items, int page, int size)
    {
        throw new NotImplementedException();
    }
}
```

---why
**Обобщения.** Один метод на любые элементы: `Paginate<T>` работает и с заказами, и с пользователями — без копирования кода
и без `object` с приведением типов. Компилятор проверяет типы.

**Деление с округлением вверх.** `TotalPages = (TotalItems + size - 1) / size` — целочисленный трюк без `Math.Ceiling`
и `double`. `Math.Ceiling((double)n / size)` тоже работает, но гоняет целые через дробные.

**Почему страница за концом — не ошибка.** Между запросами список мог уменьшиться: пользователь был на 5-й странице, часть
записей удалили. Ошибка 400 сломает ему интерфейс, пустая страница с честным `TotalPages` позволит вернуться.
А вот `page = 0` или `size = 100000` — ошибка клиента: это защищает сервер от запроса «дай всё».

**Почему лимит на `size`.** Без него один запрос `?size=10000000` положит сервер. Это реальная уязвимость (DoS через API).

---solution
```csharp
public record Page<T>(IReadOnlyList<T> Items, int Number, int Size, int TotalItems, int TotalPages, bool HasNext);

public static class Kata
{
    public static Page<T> Paginate<T>(IReadOnlyList<T> items, int page, int size)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(page, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(size, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(size, 100);

        var totalPages = (items.Count + size - 1) / size;
        var slice = items.Skip((page - 1) * size).Take(size).ToList();
        return new Page<T>(slice, page, size, items.Count, totalPages, page < totalPages);
    }
}
```
