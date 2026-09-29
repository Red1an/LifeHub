# @csharp-types

## Глубже: защитные копии и in-параметры
Компилятор незаметно копирует struct, чтобы не нарушить неизменяемость: вызов метода на `readonly`-поле с изменяемым struct или передача через `in` приводит к **защитной копии** (defensive copy). На большом struct в горячем цикле это заметные затраты. Лечение — `readonly struct` (компилятор знает, что методы не меняют состояние) или `readonly`-методы.

`ref`-семантика для struct: `ref`-локальные переменные и `ref return` позволяют работать с элементом массива на месте, без копирования: `ref var p = ref points[i]; p.X++;`. `Span<T>` и `CollectionsMarshal.AsSpan(list)` дают то же для списков.

Размер struct влияет на копирование: до 16 байт копируется дёшево (регистры), больше — `memcpy`. Правило Microsoft: struct — если логически одно значение, маленький (≤16 байт), неизменяемый и редко упаковывается.

`Equals` у struct без переопределения использует рефлексию (если есть ссылочные поля) — медленно; всегда реализуйте `IEquatable<T>` или используйте `record struct`.

---quiz
? Что произойдёт при вызове метода изменяемого struct через readonly-поле класса?
- [ ] Ошибка компиляции
- [x] Вызов выполнится на защитной копии — изменения не сохранятся в поле
- [ ] Поле станет изменяемым
- [ ] Будет упаковка в object
> Компилятор защищает readonly-поле, копируя struct перед вызовом.

? Какой struct лучше по рекомендациям Microsoft?
- [ ] 64-байтный изменяемый struct с десятком полей
- [x] Маленький (≤16 байт) неизменяемый readonly struct, представляющий одно значение
- [ ] struct со ссылкой на List<T> и методом Add
- [ ] struct, который часто приводится к object
> Большие и изменяемые struct — источник скрытых копий и багов.

? Как изменить поле структуры, лежащей в List<Point>, без копирования?
- [ ] list[i].X++
- [x] ref var p = ref CollectionsMarshal.AsSpan(list)[i]; p.X++;
- [ ] var p = list[i]; p.X++;
- [ ] list.ForEach(p => p.X++)
> Span даёт ссылку на элемент внутреннего массива списка.

? Почему Equals у struct без IEquatable<T> может быть медленным?
- [ ] Он всегда возвращает false
- [x] ValueType.Equals может сравнивать поля через рефлексию и упаковывает аргумент
- [ ] Он вызывает GC.Collect
- [ ] Он сравнивает ссылки
> IEquatable<T> или record struct генерируют быстрое сравнение.

---recall
Q: Что такое защитная копия struct и как её избежать?
A: Компилятор копирует struct перед вызовом метода, если значение нельзя менять (readonly-поле, in-параметр), а метод может изменить состояние. Избегают, объявляя readonly struct или readonly-методы.

---read
- [Выбор между классом и структурой — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/design-guidelines/choosing-between-class-and-struct)
- [Типы значений — справочник C#](https://learn.microsoft.com/ru-ru/dotnet/csharp/language-reference/builtin-types/value-types)
- Книга «CLR via C#», Джеффри Рихтер — глава о типах значений и ссылочных типах, упаковка
- Книга «C# in Depth», Джон Скит — эволюция struct, ref и Span в языке

# @csharp-oop

## Глубже: как работает виртуальный вызов
У каждого объекта в заголовке есть указатель на **MethodTable** типа; в ней — таблица слотов виртуальных методов. `override` заменяет адрес в слоте наследника, `new` добавляет новый слот. Виртуальный вызов = чтение MethodTable → чтение слота → косвенный переход. Вызов метода интерфейса сложнее: .NET использует **virtual stub dispatch** — кэширующие заглушки на месте вызова.

JIT убирает косвенность, когда тип известен: `sealed`-класс, локальная переменная точного типа, **guarded devirtualization** по PGO (если на практике почти всегда приходит `Dog`, JIT вставляет проверку «это Dog?» и прямой вызов с инлайнингом).

Проектирование иерархий: наследование — это самая сильная связь между классами. Базовый класс, открытый для наследования, — публичный контракт, который трудно менять (**fragile base class**). Если класс не проектировался для наследования — `sealed`. Шаблонный метод (`protected virtual` хук) лучше, чем разрешать переопределять всё.

Default interface methods решают проблему эволюции библиотечных интерфейсов, но не заменяют абстрактные классы: у них нет состояния, а вызов идёт только через интерфейс.

---quiz
? Где хранятся адреса виртуальных методов объекта?
- [ ] В самом объекте
- [x] В MethodTable его типа, на которую указывает заголовок объекта
- [ ] В стеке
- [ ] В GC-куче отдельно
> Все объекты одного типа разделяют одну MethodTable.

? Что делает guarded devirtualization?
- [ ] Запрещает виртуальные вызовы
- [x] По профилю вставляет проверку частого типа и прямой (инлайнящийся) вызов для него
- [ ] Делает все классы sealed
- [ ] Кэширует объекты
> Работает с Dynamic PGO.

? Почему стоит делать классы sealed по умолчанию?
- [ ] Это требование C#
- [x] Наследование — жёсткий контракт; sealed оставляет свободу менять класс и помогает JIT
- [ ] sealed-классы не собираются GC
- [ ] Их нельзя тестировать
> Открыть класс для наследования позже можно, закрыть — ломающее изменение.

? Чем default interface method отличается от метода абстрактного класса?
- [ ] Ничем
- [x] Не имеет доступа к состоянию экземпляра и вызывается только через ссылку на интерфейс
- [ ] Всегда статический
- [ ] Работает быстрее
> Реализация по умолчанию не видна через переменную типа класса.

---recall
Q: Почему наследование создаёт хрупкость (fragile base class)?
A: Наследники зависят от внутреннего поведения базового класса (порядок вызовов, виртуальные хуки). Изменение базового класса, корректное само по себе, может сломать наследников, о которых автор базы не знает.

---read
- [Наследование — руководство по C#](https://learn.microsoft.com/ru-ru/dotnet/csharp/fundamentals/object-oriented/inheritance)
- [Framework Design Guidelines: проектирование для расширяемости](https://learn.microsoft.com/ru-ru/dotnet/standard/design-guidelines/designing-for-extensibility)
- Книга «Effective C#», Билл Вагнер — правила проектирования типов
- Книга «Design Patterns» (GoF) — вводная глава о композиции и наследовании

# @csharp-exceptions

## Глубже: исключения в продакшен-коде
**Стоимость**: бросок исключения в .NET — это микросекунды (сбор стека, двухпроходная обработка). С .NET 9 механизм переписан и стал в разы быстрее, но исключение в горячем цикле всё равно плохая идея. Для частых «ошибок» — `TryParse`-паттерн или Result.

**Границы обработки**: ловите исключения там, где можете что-то сделать — повторить, откатить, преобразовать в ответ. Всё остальное — в глобальном обработчике (`IExceptionHandler` в ASP.NET Core), который логирует и возвращает ProblemDetails.

**Исключения, которые нельзя глотать**: `OperationCanceledException` при отмене — не ошибка, а штатное завершение; `OutOfMemoryException`, `StackOverflowException` (последнее вообще не ловится). Фильтр `when (ex is not OperationCanceledException)` — хорошая привычка.

**ExceptionDispatchInfo.Capture(ex).Throw()** — пробросить исключение в другом месте (другом потоке) с сохранением стека. **finally** выполняется даже при `return`; `using` — это try/finally.

**Result-паттерн** в .NET: библиотеки (FluentResults, ErrorOr, OneOf) или свой `Result<T, TError>`; в сочетании с pattern matching даёт явную обработку бизнес-ошибок.

---quiz
? Как правильно обрабатывать OperationCanceledException в фоновой задаче при остановке приложения?
- [ ] Логировать как ошибку уровня Critical
- [x] Считать штатной отменой и не логировать как ошибку
- [ ] Перезапускать задачу
- [ ] Бросать дальше в Main
> Отмена — ожидаемый сценарий завершения.

? Для чего ExceptionDispatchInfo.Capture(ex).Throw()?
- [ ] Для подавления исключения
- [x] Чтобы перебросить сохранённое исключение в другом месте, сохранив исходный стек
- [ ] Для логирования
- [ ] Для конвертации в Result
> Используется в инфраструктуре async/await.

? Где в веб-приложении лучше всего обрабатывать неожиданные исключения?
- [ ] try/catch в каждом методе
- [x] В глобальном обработчике (IExceptionHandler), который логирует и возвращает ProblemDetails
- [ ] В клиенте
- [ ] Нигде
> Локально ловят только то, что умеют исправить.

? Что будет с finally при return внутри try?
- [ ] Не выполнится
- [x] Выполнится перед фактическим возвратом из метода
- [ ] Выполнится только при исключении
- [ ] Вызовет ошибку компиляции
> Поэтому using надёжно освобождает ресурсы.

---recall
Q: Где стоит ловить исключения в приложении?
A: Только там, где можно осмысленно отреагировать: повторить операцию, откатить, перевести в понятный ответ или добавить контекст и пробросить. Остальное — в глобальном обработчике с логированием; отмену (OperationCanceledException) не считать ошибкой.

---read
- [Рекомендации по исключениям — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/exceptions/best-practices-for-exceptions)
- [Обработка ошибок в ASP.NET Core](https://learn.microsoft.com/ru-ru/aspnet/core/fundamentals/error-handling)
- Книга «Framework Design Guidelines», Цвалина и Абрамс — глава об исключениях

# @csharp-generics

## Глубже: generics и производительность
**Специализация для value types** даёт скорость, но увеличивает объём машинного кода: каждое `List<MyStruct>` — отдельная копия. Для reference types код общий, а конкретный тип передаётся через скрытый параметр (generic dictionary) — это небольшая косвенность в статических generic-методах.

**Ограничения и JIT**: `where T : struct, IComparable<T>` позволяет вызывать `CompareTo` без упаковки — JIT генерирует прямой вызов. Трюк `constrained.` в IL обеспечивает это.

**Статические абстрактные члены** (C# 11) открывают generic math и «статический полиморфизм»: `T.Parse`, `T.Zero`, операторы в интерфейсах. Стандартные интерфейсы: `INumber<T>`, `IAdditionOperators<T,T,T>`, `IParsable<T>`.

**Вариантность и безопасность**: ковариантность массивов (`object[] a = new string[1]; a[0] = 1;` → `ArrayTypeMismatchException` в рантайме) — историческая ошибка дизайна; generic-интерфейсы с `out` безопасны на этапе компиляции.

**Кэш на тип**: `static class Cache<T> { public static readonly Func<T> Factory = Build(); }` — инициализируется один раз на тип без словаря и блокировок (используется в System.Text.Json, EqualityComparer<T>.Default).

---quiz
? Что произойдёт: `object[] a = new string[1]; a[0] = 42;`?
- [ ] Ошибка компиляции
- [x] ArrayTypeMismatchException во время выполнения
- [ ] Число упакуется и сохранится
- [ ] Строка "42"
> Ковариантность массивов проверяется в рантайме на каждой записи.

? Почему where T : IComparable<T> на struct не приводит к упаковке при вызове CompareTo?
- [ ] Компилятор копирует интерфейс
- [x] JIT генерирует специализированный код с прямым (constrained) вызовом метода структуры
- [ ] Упаковка всё равно происходит
- [ ] IComparable<T> — struct
> В отличие от вызова через переменную типа IComparable.

? Для чего static abstract члены в интерфейсах?
- [ ] Для множественного наследования классов
- [x] Для обобщённых алгоритмов со статическими операциями: T.Zero, операторы, T.Parse
- [ ] Для сериализации
- [ ] Для DI
> Основа generic math в .NET 7+.

? Как сделать дешёвый кэш значения для каждого типа T?
- [ ] ConcurrentDictionary<Type, object>
- [x] Статическое поле в generic-классе Cache<T>
- [ ] ThreadLocal
- [ ] Рефлексия при каждом вызове
> Каждый закрытый generic-тип имеет свои статические поля.

---recall
Q: Как generic-код для ссылочных типов узнаёт конкретный тип T, если машинный код общий?
A: Через скрытый параметр или словарь generic-контекста (runtime-lookup), который передаётся в общий код; для value types JIT генерирует отдельную специализацию, где тип известен статически.

---read
- [Универсальные шаблоны в .NET — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/generics/)
- [Generic math — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/generics/math)
- Книга «C# in Depth», Джон Скит — главы о generics и вариантности
- Книга «CLR via C#», Джеффри Рихтер — глава «Generics»

# @csharp-delegates

## Глубже: цена делегатов и событий
**Аллокации**: лямбда без захвата кэшируется компилятором в статическом поле — бесплатно после первого вызова. Лямбда с захватом создаёт объект-замыкание и делегат при каждом входе в метод. В горячих местах используйте `static` лямбды и перегрузки с параметром состояния: `cache.GetOrAdd(key, static (k, arg) => Create(k, arg), arg)`.

**Замыкание захватывает переменную, а не значение** — и держит весь объект-замыкание. Если в одном методе две лямбды, одна захватила маленькую переменную, а другая — огромный объект, обе держат общий display class: утечка через «соседнюю» лямбду.

**События и потоки**: вызов `Changed?.Invoke(...)` потокобезопасен в плане null-проверки (копия делегата), но подписка/отписка во время вызова может пропустить обработчик. Исключение в одном обработчике прерывает остальных — для надёжности перебирайте `GetInvocationList()` с try/catch.

**Weak events** — издатель держит слабые ссылки на подписчиков (WPF WeakEventManager). **Rx** (`IObservable<T>`) — композиция потоков событий: фильтрация, объединение, throttling.

**Func vs Expression**: `Expression<Func<>>` компилируется в дерево объектов; `Compile()` дорогой (миллисекунды) — кэшируйте результат.

---quiz
? Какая лямбда не создаёт аллокаций при каждом вызове метода?
- [x] static x => x * 2
- [ ] x => x * factor, где factor — локальная переменная
- [ ] x => this.Process(x)
- [ ] () => list.Count
> Лямбда без захвата кэшируется в статическом поле.

? Два обработчика события, первый бросает исключение. Что с вторым?
- [ ] Выполнится
- [x] Не выполнится — исключение прерывает вызов мультикаст-делегата
- [ ] Выполнится в другом потоке
- [ ] Выполнится дважды
> Для изоляции перебирают GetInvocationList вручную.

? Почему Expression.Compile() в горячем пути — плохая идея?
- [ ] Он не работает с лямбдами
- [x] Компиляция дерева выражения дорогая (генерация IL), результат нужно кэшировать
- [ ] Он всегда бросает исключение
- [ ] Он блокирует GC
> Скомпилированный делегат затем вызывается быстро.

? Что такое перегрузки «с состоянием» вроде GetOrAdd(key, factory, arg)?
- [ ] Устаревший API
- [x] Способ передать данные в static лямбду без замыкания и аллокаций
- [ ] Асинхронные версии
- [ ] Потокобезопасные обёртки
> Состояние передаётся параметром.

---recall
Q: Как в C# избежать аллокаций от лямбд в горячем коде?
A: Не захватывать переменные: static-лямбды, перегрузки с явным параметром состояния, кэширование делегатов в полях, локальные static-функции; следить, чтобы замыкание не держало большие объекты.

---read
- [Лямбда-выражения — справочник C#](https://learn.microsoft.com/ru-ru/dotnet/csharp/language-reference/operators/lambda-expressions)
- [События — руководство по C#](https://learn.microsoft.com/ru-ru/dotnet/csharp/events-overview)
- Книга «C# in Depth», Джон Скит — лямбды и деревья выражений

# @csharp-linq

## Глубже: как LINQ оптимизирован внутри
LINQ to Objects в современных .NET — не наивные итераторы. `Where(...).Select(...)` склеиваются в один итератор `WhereSelectEnumerableIterator`; для массивов и `List<T>` есть специализированные ветки; `Count()` на `ICollection<T>` не перебирает; `.Sum()`, `.Min()`, `.Max()`, `.Contains()` на массивах векторизованы через SIMD. В .NET 9 появились `CountBy`, `AggregateBy`, `Index`.

Где LINQ всё ещё дорог: аллокация итераторов и делегатов, замыкания, `OrderBy` (стабильная сортировка + ключи), `GroupBy` (словарь групп), многократные `ToList()`.

**IQueryable**: провайдер получает дерево выражения и переводит его в SQL. Ошибки трансляции (метод, который провайдер не понимает) EF Core теперь бросает явно, а не выполняет на клиенте молча. Разделяйте: «запрос» (IQueryable, строится композицией) и «материализация» (`ToListAsync`).

**Свои операторы**: метод-расширение с `yield return` — ленивый оператор; проверяйте аргументы в обёртке без yield, иначе исключение вылетит только при перечислении.

**PLINQ** (`AsParallel`) — для CPU-тяжёлых операций на больших коллекциях; для I/O не подходит.

---quiz
? Когда `list.Where(p).Count()` не перебирает весь список?
- [ ] Никогда не перебирает
- [x] Всегда перебирает — Where возвращает итератор без знания количества; без Where Count() на List берёт свойство Count
- [ ] Только в Release
- [ ] Когда список отсортирован
> Count() использует ICollection<T>.Count только если источник — коллекция.

? Почему валидацию аргументов в операторе с yield выносят в отдельный метод?
- [ ] Для скорости
- [x] Иначе исключение о неверном аргументе вылетит только при первом перечислении, а не при вызове
- [ ] yield запрещает throw
- [ ] Так требует компилятор
> Код итератора не выполняется до MoveNext.

? Для каких задач подходит PLINQ?
- [ ] Для запросов к БД
- [ ] Для HTTP-вызовов
- [x] Для тяжёлых CPU-вычислений над большими коллекциями в памяти
- [ ] Для маленьких списков
> На I/O параллелизм через потоки пула неэффективен.

? Что делает EF Core с методом в LINQ-запросе, который он не может перевести в SQL?
- [ ] Выполняет всё на клиенте молча
- [x] Бросает исключение о невозможности трансляции (кроме финального Select)
- [ ] Игнорирует метод
- [ ] Вызывает хранимую процедуру
> Клиентская оценка разрешена только в последней проекции.

---recall
Q: Какие оптимизации LINQ to Objects делает сам .NET?
A: Склеивание цепочек Where/Select в один итератор, специализации для массивов и списков, использование Count у коллекций, векторизация Sum/Min/Max/Contains, отложенная сортировка для First после OrderBy и т.п. Но аллокации итераторов и делегатов остаются.

---read
- [LINQ — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/csharp/linq/)
- [Performance Improvements in .NET — блог Стивена Тауба](https://devblogs.microsoft.com/dotnet/category/performance/)
- Книга «C# in Depth», Джон Скит — итераторы и LINQ изнутри

# @csharp-collections

## Глубже: устройство Dictionary
`Dictionary<TKey,TValue>` хранит два массива: **buckets** (индексы) и **entries** (ключ, значение, хэш, индекс следующего в цепочке). Индекс корзины = `hash % prime` (размеры — простые числа). Коллизии — цепочки через поле `next` внутри массива entries, без отдельных узлов в куче. Удалённые записи попадают в free-list и переиспользуются. При росте — новый массив примерно вдвое больше и rehash.

Следствия:
- порядок перечисления не гарантирован (хотя без удалений совпадает с порядком вставки — не полагайтесь);
- ключ-строка: `string.GetHashCode` рандомизирован между запусками (защита от hash flooding);
- пользовательский ключ — `readonly record struct` или корректные `Equals/GetHashCode`;
- `CollectionsMarshal.GetValueRefOrAddDefault` — обновление значения без двойного поиска.

**Выбор под нагрузку**: `Dictionary` с заданной ёмкостью; `FrozenDictionary` для справочников; `ConcurrentDictionary` — лок на сегмент, чтение без блокировок; `ImmutableDictionary` — дерево (AVL), O(log n), зато снимки дешёвые.

**Сортированные**: `SortedDictionary` (красно-чёрное дерево, O(log n) вставка), `SortedList` (массивы, быстрее для редких вставок).

---quiz
? Как Dictionary в .NET разрешает коллизии?
- [ ] Открытой адресацией с линейным пробированием
- [x] Цепочками через индекс next внутри массива entries
- [ ] Связными списками узлов в куче
- [ ] Деревьями
> Отдельных объектов на запись нет — меньше нагрузки на GC.

? Почему string.GetHashCode возвращает разные значения в разных запусках?
- [ ] Это баг
- [x] Хэш рандомизирован для защиты от атак hash flooding
- [ ] Из-за GC
- [ ] Из-за культуры
> Нельзя сохранять string.GetHashCode в БД или файлы.

? Как увеличить счётчик в Dictionary<string,int> за один поиск?
- [ ] dict[key] = dict[key] + 1
- [x] ref var v = ref CollectionsMarshal.GetValueRefOrAddDefault(dict, key, out _); v++;
- [ ] dict.TryGetValue, затем dict[key] = …
- [ ] dict.Remove и Add
> Получаем ссылку на значение внутри словаря.

? Какая сложность вставки в ImmutableDictionary?
- [ ] O(1)
- [x] O(log n) — внутри сбалансированное дерево
- [ ] O(n)
- [ ] O(n log n)
> Цена за дешёвые неизменяемые снимки.

---recall
Q: Почему нельзя полагаться на порядок перечисления Dictionary?
A: Порядок не гарантирован контрактом: после удалений свободные слоты переиспользуются, и новые элементы оказываются «в середине». Для порядка используйте List, SortedDictionary или OrderedDictionary (.NET 9).

---read
- [Коллекции и структуры данных — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/collections/)
- [Исходный код Dictionary в dotnet/runtime](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Collections/Generic/Dictionary.cs)
- Книга «Writing High-Performance .NET Code», Бен Уотсон — выбор коллекций

# @csharp-strings

## Глубже: строки без аллокаций
**Interpolated string handlers** (C# 10): `$"{a} {b}"` компилируется в `DefaultInterpolatedStringHandler`, который пишет в арендованный буфер, без упаковки value types. Свои обработчики позволяют логгеру не форматировать строку, если уровень выключен.

**string.Create** — выделить строку нужной длины и заполнить её через Span за одну аллокацию. **SearchValues<char>** (.NET 8) — векторизованный поиск любого из набора символов. **Split без аллокаций**: `span.Split(',')` в .NET 9 возвращает диапазоны, а не массив строк.

**UTF-8 литералы**: `"hello"u8` — `ReadOnlySpan<byte>` без перекодирования; веб-стек .NET работает в UTF-8 внутри.

**Сравнение**: `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)`; для словарей — `StringComparer.OrdinalIgnoreCase`. Культурное сравнение использует ICU — на Linux и Windows результаты совпадают (с .NET 5), но медленнее ordinal в разы.

**Regex**: `[GeneratedRegex]` генерирует код при сборке; `RegexOptions.NonBacktracking` — линейное время, защита от ReDoS; всегда таймаут для пользовательских шаблонов.

**Интернирование**: `string.Intern` для динамических строк — редко оправдано (строки живут до конца процесса).

---quiz
? Что даёт суффикс u8 у литерала "abc"u8?
- [ ] Строку в UTF-16
- [x] ReadOnlySpan<byte> с UTF-8 байтами, вычисленными при компиляции
- [ ] Массив char
- [ ] Интернированную строку
> Без перекодирования в рантайме.

? Как защититься от ReDoS для регулярного выражения на пользовательском вводе?
- [ ] Использовать RegexOptions.Compiled
- [x] Таймаут и/или RegexOptions.NonBacktracking
- [ ] Использовать Split
- [ ] Никак
> NonBacktracking гарантирует линейное время.

? Для чего string.Create?
- [ ] Для интернирования
- [x] Создать строку известной длины и заполнить её через Span без промежуточных аллокаций
- [ ] Для конкатенации двух строк
- [ ] Для форматирования дат
> Одна аллокация — сама итоговая строка.

? Какой компаратор использовать для Dictionary с ключами-идентификаторами без учёта регистра?
- [ ] StringComparer.CurrentCultureIgnoreCase
- [x] StringComparer.OrdinalIgnoreCase
- [ ] StringComparer.InvariantCulture
- [ ] По умолчанию
> Быстро и не зависит от культуры.

---recall
Q: Что такое interpolated string handler и зачем он нужен?
A: Тип, в который компилятор разворачивает интерполированную строку: части пишутся в буфер без промежуточных строк и упаковки. Свой обработчик может вообще не форматировать строку, если она не нужна (например, при выключенном уровне логирования).

---read
- [Рекомендации по использованию строк в .NET](https://learn.microsoft.com/ru-ru/dotnet/standard/base-types/best-practices-strings)
- [Регулярные выражения: рекомендации](https://learn.microsoft.com/ru-ru/dotnet/standard/base-types/best-practices-regex)
- [String Interpolation in C# 10 and .NET 6 — блог .NET](https://devblogs.microsoft.com/dotnet/string-interpolation-in-c-10-and-net-6/)

# @csharp-memory

## Глубже: GC в продакшене
**Режимы**: Server GC (по умолчанию в ASP.NET Core) создаёт кучу и поток на каждое ядро — в контейнере с лимитом 1–2 CPU это может быть лишним; **DATAS** (.NET 8+, по умолчанию с .NET 9 для Server GC) динамически подстраивает число куч под нагрузку. Настройки: `GCHeapHardLimit`, `GCHeapAffinitizeMask`, `ConserveMemory`.

**Паузы**: эфемерные сборки (Gen0/1) — единицы миллисекунд; полная блокирующая Gen2 с компактированием — десятки/сотни миллисекунд на больших кучах. Background GC делает Gen2 конкурентно, но эфемерные сборки всё равно останавливают потоки.

**Средний кризис** (mid-life crisis): объекты живут чуть дольше Gen0 (кэш на минуту, буферы запроса), продвигаются в Gen2 и умирают там — дорогие полные сборки. Решение: либо очень короткоживущие, либо долгоживущие (пулы).

**LOH и фрагментация**: большие массивы — из пула (`ArrayPool`), `GCSettings.LargeObjectHeapCompactionMode` для разового сжатия.

**Диагностика**: `dotnet-counters` (`gc-heap-size`, `gen-2-gc-count`, `% time in GC`, `alloc-rate`), `dotnet-trace --profile gc-verbose`, PerfView (GCStats), дампы для утечек.

---quiz
? Что такое «кризис среднего возраста» объектов в GC?
- [ ] Утечка памяти в LOH
- [x] Объекты живут достаточно долго, чтобы попасть в Gen2, и умирают там, вызывая дорогие полные сборки
- [ ] Переполнение стека
- [ ] Ошибка финализатора
> Кэши с TTL в минуты — типичная причина.

? Что делает DATAS в .NET?
- [ ] Отключает GC
- [x] Динамически подстраивает число куч Server GC под фактическую нагрузку
- [ ] Сжимает LOH
- [ ] Шифрует кучу
> Экономия памяти в контейнерах.

? Какая метрика dotnet-counters показывает долю времени на сборку мусора?
- [ ] cpu-usage
- [x] % Time in GC since last GC
- [ ] threadpool-queue-length
- [ ] exception-count
> Высокие значения — повод искать лишние аллокации.

? Почему Server GC в контейнере с лимитом 1 CPU может быть неэффективен?
- [ ] Он не поддерживается в Linux
- [x] Он рассчитан на много ядер: отдельные кучи и потоки GC, больше памяти
- [ ] Он всегда блокирует потоки
- [ ] Он отключает Gen0
> DATAS или Workstation GC решают проблему.

---recall
Q: Как диагностировать проблемы с GC в .NET-сервисе?
A: dotnet-counters: размер куч, частота сборок Gen0/1/2, % времени в GC, скорость аллокаций; dotnet-trace/PerfView с GC-событиями для пауз и причин; дампы и gcroot для утечек; затем уменьшать аллокации, пулы, избегать mid-life crisis.

---read
- [Основы сборки мусора — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/garbage-collection/fundamentals)
- [Параметры конфигурации GC](https://learn.microsoft.com/ru-ru/dotnet/core/runtime-config/garbage-collector)
- Книга «Pro .NET Memory Management», Конрад Кокоса — самое подробное описание GC .NET
- [Блог Maoni Stephens — архитектора GC .NET](https://devblogs.microsoft.com/dotnet/author/maoni/)

# @csharp-span

## Глубже: правила безопасности ref-типов
Компилятор отслеживает **escape scope**: может ли ссылка «сбежать» за пределы метода. `Span<T>` на `stackalloc` нельзя вернуть из метода; параметр `scoped Span<T>` обещает не сохранять его; `ref struct` может содержать `ref`-поля (C# 11) — так устроен сам Span.

С C# 13 `ref struct` могут реализовывать интерфейсы и использоваться как generic-аргументы с `allows ref struct` — это открыло Span в generic-коде.

**Memory<T> и владение**: `IMemoryOwner<T>` явно передаёт владение буфером — кто получил, тот и обязан вызвать Dispose (вернуть в пул). Путаница с владением — источник use-after-free в пуле.

**System.IO.Pipelines**: `PipeReader`/`PipeWriter` управляют буферами за вас: читаешь `ReadOnlySequence<byte>` (возможно, из нескольких сегментов), сообщаешь, сколько обработал (`AdvanceTo`), — и не копируешь данные. Kestrel построен на Pipelines.

**stackalloc** безопасен только для маленьких фиксированных размеров; шаблон: `Span<byte> buf = n <= 256 ? stackalloc byte[256] : (rented = ArrayPool<byte>.Shared.Rent(n));`.

---quiz
? Что означает модификатор scoped у параметра Span?
- [ ] Параметр только для чтения
- [x] Метод обещает не сохранять ссылку за пределы вызова
- [ ] Параметр выделяется в куче
- [ ] Параметр передаётся по значению
> Позволяет передавать stackalloc-буферы.

? Что даёт IMemoryOwner<T>?
- [ ] Потокобезопасность
- [x] Явное владение арендованным буфером: владелец обязан вызвать Dispose
- [ ] Автоматическую сборку мусора
- [ ] Шифрование памяти
> Решает вопрос «кто возвращает буфер в пул».

? Почему PipeReader возвращает ReadOnlySequence<byte>, а не массив?
- [ ] Для совместимости с LINQ
- [x] Данные могут лежать в нескольких буферах; последовательность позволяет разбирать их без склейки и копирования
- [ ] Это устаревший API
- [ ] Для шифрования
> Сегменты — буферы из пула.

? Как безопасно использовать stackalloc для буфера неизвестного размера?
- [ ] Всегда stackalloc n
- [x] stackalloc только до небольшого порога, иначе — массив из ArrayPool
- [ ] Никогда не использовать
- [ ] Через new byte[n] на стеке
> Большой stackalloc приводит к StackOverflow.

---recall
Q: Что такое escape analysis для ref-типов в C#?
A: Правила компилятора, отслеживающие, может ли ссылка (ref, Span) пережить область, где живут данные. Не даёт вернуть Span на стековую память, сохранить его в поле класса и т.п.; scoped и ref-поля уточняют эти правила.

---read
- [Рекомендации по Memory<T> и Span<T>](https://learn.microsoft.com/ru-ru/dotnet/standard/memory-and-spans/memory-t-usage-guidelines)
- [System.IO.Pipelines — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/io/pipelines)
- [Deep .NET: Span с Стивеном Таубом — YouTube](https://www.youtube.com/watch?v=5KdICNWOfEQ)

# @csharp-async

## Глубже: что внутри Task
**AsyncTaskMethodBuilder** создаёт Task и управляет машиной состояний. Машина состояний — struct, пока метод выполняется синхронно; при первой настоящей приостановке она **упаковывается** в кучу (одна аллокация на метод). Завершённые Task кэшируются (`Task.CompletedTask`, `Task.FromResult(true)`).

**Продолжения**: при `await` незавершённой задачи продолжение регистрируется в задаче; когда задача завершается, продолжение ставится в **SynchronizationContext** (если был) или **TaskScheduler**, по умолчанию — в пул потоков. `TaskCreationOptions.RunContinuationsAsynchronously` для `TaskCompletionSource` — обязательно, иначе продолжения выполнятся синхронно в потоке, вызвавшем `SetResult`, и могут устроить дедлок или переполнение стека.

**ExecutionContext** (AsyncLocal, культура, контекст трассировки) течёт через await автоматически.

**Параллелизм с ограничением**: `Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 8 }, ...)` вместо `Task.WhenAll` на 10 000 задач сразу.

**Отмена**: передавайте токен до самого дна; `CancellationTokenSource.CreateLinkedTokenSource` для объединения таймаута и внешней отмены; `WaitAsync(timeout, ct)` для ожидания с отменой.

**Анализаторы**: VSTHRD (Microsoft.VisualStudio.Threading.Analyzers) ловят `.Result`, async void, забытые await.

---quiz
? Зачем RunContinuationsAsynchronously у TaskCompletionSource?
- [ ] Чтобы задача завершалась быстрее
- [x] Чтобы продолжения не выполнялись синхронно в потоке, вызвавшем SetResult (риск дедлоков и глубоких стеков)
- [ ] Для отмены
- [ ] Для логирования
> Классический источник трудноуловимых зависаний.

? Как обработать 10 000 URL с не более чем 8 одновременными запросами?
- [ ] Task.WhenAll по всем 10 000 задачам
- [x] Parallel.ForEachAsync с MaxDegreeOfParallelism = 8
- [ ] foreach с .Result
- [ ] Thread на каждый URL
> Или SemaphoreSlim + WhenAll.

? Когда машина состояний async-метода попадает в кучу?
- [ ] Всегда при вызове
- [x] Только когда метод реально приостанавливается на незавершённой задаче
- [ ] Никогда
- [ ] Только в Debug
> Синхронно завершившийся метод не аллоцирует машину.

? Что течёт через await автоматически?
- [ ] SynchronizationContext всегда
- [x] ExecutionContext: AsyncLocal, культура, контекст трассировки
- [ ] Блокировки lock
- [ ] ThreadStatic-переменные
> ThreadStatic привязан к потоку и через await не переносится.

---recall
Q: Как ограничить степень параллелизма асинхронных операций?
A: Parallel.ForEachAsync с MaxDegreeOfParallelism; SemaphoreSlim(N) с WaitAsync/Release вокруг каждой операции; каналы (Channel) с фиксированным числом потребителей; TPL Dataflow с MaxDegreeOfParallelism.

---read
- [Асинхронное программирование — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/csharp/asynchronous-programming/)
- [How Async/Await Really Works in C# — Стивен Тауб](https://devblogs.microsoft.com/dotnet/how-async-await-really-works/)
- [ConfigureAwait FAQ — Стивен Тауб](https://devblogs.microsoft.com/dotnet/configureawait-faq/)
- Книга «Concurrency in C# Cookbook», Стивен Клири

# @csharp-threading

## Глубже: модель памяти и lock-free
**Модель памяти .NET** гарантирует: записи не переупорядочиваются друг с другом для других потоков (на x64 и ARM64 .NET вставляет нужные барьеры), `volatile`-чтение — acquire, `volatile`-запись — release. Но **чтение может «уехать» раньше записи** в другую переменную — отсюда классические ошибки ручной синхронизации.

**Interlocked**: `CompareExchange` — основа lock-free алгоритмов: прочитать, вычислить новое, записать, если никто не изменил, иначе повторить.
```csharp
int current, next;
do { current = _max; next = Math.Max(current, value); }
while (Interlocked.CompareExchange(ref _max, next, current) != current);
```
Проблема ABA и сложность верификации — lock-free писать только при доказанной необходимости.

**Lazy<T>** и `LazyInitializer` — потокобезопасная ленивая инициализация. **ThreadLocal<T>** и `[ThreadStatic]` — данные на поток (в async-коде — осторожно, используйте AsyncLocal).

**Monitor** в .NET сначала крутится в spin-wait, потом ждёт в ядре; новый `System.Threading.Lock` (.NET 9) легче. **ReaderWriterLockSlim** оправдан при долгих чтениях; для коротких — обычный lock быстрее.

**Каналы**: `Channel.CreateBounded<T>(new BoundedChannelOptions(100) { FullMode = BoundedChannelFullMode.Wait })` — producer/consumer с backpressure, асинхронно.

---quiz
? Для чего Interlocked.CompareExchange?
- [ ] Для блокировки потока
- [x] Атомарно записать новое значение, только если текущее равно ожидаемому — основа lock-free обновлений
- [ ] Для обмена сообщениями
- [ ] Для сравнения строк
> Цикл повторяет попытку при конкуренции.

? Почему [ThreadStatic] опасен в async-коде?
- [ ] Он медленный
- [x] После await продолжение может выполниться в другом потоке и увидеть чужое значение
- [ ] Он не компилируется в async
- [ ] Он вызывает утечку
> Для «контекста операции» — AsyncLocal<T>.

? Что делает BoundedChannelFullMode.Wait?
- [ ] Отбрасывает новые элементы
- [x] Заставляет производителя асинхронно ждать, пока в канале не освободится место
- [ ] Бросает исключение
- [ ] Увеличивает ёмкость
> Это и есть backpressure.

? Когда ReaderWriterLockSlim хуже обычного lock?
- [ ] Никогда
- [x] Когда критические секции короткие — его собственные накладные расходы больше выигрыша
- [ ] Когда много читателей
- [ ] Когда нет писателей
> Измеряйте.

---recall
Q: Что такое lock-free алгоритм и почему его стоит избегать без необходимости?
A: Алгоритм без блокировок на атомарных операциях (CompareExchange в цикле). Он сложен в написании и проверке (ABA, модель памяти, голодание), а выигрыш важен только при очень высокой конкуренции. Обычно достаточно lock, каналов или готовых Concurrent-коллекций.

---read
- [Потоки и управление потоками — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/standard/threading/)
- [System.Threading.Channels — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/core/extensions/channels)
- Книга «Concurrent Programming on Windows», Джо Даффи — классика по модели памяти
- [Threading in C# — Джозеф Албахари (бесплатно)](https://www.albahari.com/threading/)

# @csharp-reflection

## Глубже: пишем incremental source generator
Генератор — класс с `[Generator]`, реализующий `IIncrementalGenerator`. Он строит **конвейер**: найти синтаксические узлы (например, классы с атрибутом) → превратить их в модель (простые данные, сравнимые по значению) → сгенерировать код.
```csharp
[Generator]
public sealed class ToStringGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext ctx)
    {
        var models = ctx.SyntaxProvider.ForAttributeWithMetadataName("MyLib.AutoToStringAttribute",
            (node, _) => node is ClassDeclarationSyntax,
            (c, _) => new Model(c.TargetSymbol.Name, c.TargetSymbol.ContainingNamespace.ToDisplayString()));
        ctx.RegisterSourceOutput(models, (spc, m) => spc.AddSource($"{m.Name}.g.cs", $"namespace {m.Ns}; partial class {m.Name} {{ /* ... */ }}"));
    }
}
```
Ключ к скорости IDE — **кэшируемость**: модель должна быть record с равенством по значению, без символов Roslyn внутри.

**Интерсепторы** (C# 12, экспериментально → стабилизируются) позволяют генератору подменить конкретный вызов метода в коде — так работают AOT-совместимые Minimal API и конфигурационный биндинг.

**Рефлексия и trimming**: атрибут `[DynamicallyAccessedMembers(PublicProperties)]` на параметре `Type` говорит триммеру сохранить нужные члены; предупреждения IL2026/IL3050 показывают AOT-несовместимые места.

---quiz
? Почему модель в incremental generator должна быть сравнимой по значению?
- [ ] Для сериализации
- [x] Чтобы конвейер мог кэшировать шаги и не пересоздавать код при каждом нажатии клавиши
- [ ] Этого требует C#
- [ ] Для рефлексии
> Иначе генератор тормозит IDE.

? Что делает [DynamicallyAccessedMembers]?
- [ ] Ускоряет рефлексию
- [x] Сообщает триммеру, какие члены типа сохранить, потому что к ним обращаются через рефлексию
- [ ] Запрещает рефлексию
- [ ] Генерирует код
> Нужно для trimming и Native AOT.

? Как ASP.NET Core делает Minimal API совместимыми с AOT?
- [ ] Отключает Minimal API в AOT
- [x] Source generator создаёт код обработки запросов, а интерсепторы подменяют вызовы MapGet и т.п.
- [ ] Использует Reflection.Emit
- [ ] Через dynamic
> Request Delegate Generator.

? Что означают предупреждения IL2026/IL3050?
- [ ] Ошибки синтаксиса
- [x] Код использует возможности, несовместимые с тримминг/AOT (рефлексия, динамическая генерация)
- [ ] Устаревшие API
- [ ] Проблемы безопасности
> Их нужно устранять перед публикацией с AOT.

---recall
Q: Как устроен incremental source generator?
A: Реализует IIncrementalGenerator и в Initialize описывает конвейер: провайдеры синтаксиса/компиляции выбирают узлы (часто ForAttributeWithMetadataName), преобразуют их в кэшируемые модели с равенством по значению, а RegisterSourceOutput генерирует файлы. Инкрементальность держит IDE быстрой.

---read
- [Source Generators — документация Roslyn](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md)
- [Native AOT — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/core/deploying/native-aot/)
- [Серия статей о source generators — Андрей Лок](https://andrewlock.net/series/creating-a-source-generator/)

# @csharp-modern

## Глубже: как это компилируется
Современный синтаксис — во многом **сахар**, и полезно понимать, во что он раскрывается:
- `record` → класс с `Equals`, `GetHashCode`, `ToString`, `Deconstruct`, методом клонирования `<Clone>$` для `with`;
- **primary constructor** класса → параметры, захваченные в скрытые поля (только если используются вне инициализаторов);
- **collection expressions** `[1, 2, ..other]` → выбор оптимального способа: для `Span` — стек, для `List<T>` — `CollectionsMarshal.SetCount` + заполнение, для `ImmutableArray` — builder; тип может объявить `[CollectionBuilder]`;
- **pattern matching** компилируется в дерево решений: компилятор переупорядочивает проверки и обнаруживает недостижимые ветки и **неполные switch** (предупреждение CS8509);
- `required` → атрибуты и проверка компилятором при инициализации.

**Nullable reference types** — только анализ компилятора, в рантайме ничего не меняется. Атрибуты `[NotNullWhen(true)]`, `[MemberNotNull]` уточняют анализ для своих методов. Включайте `<Nullable>enable</Nullable>` и `TreatWarningsAsErrors` для новых проектов.

Следите за версиями языка: `LangVersion` по умолчанию привязана к целевому фреймворку (net9.0 → C# 13).

---quiz
? Что проверяют nullable reference types в рантайме?
- [ ] Бросают исключение при присвоении null
- [x] Ничего — это только статический анализ компилятора
- [ ] Автоматически инициализируют поля
- [ ] Заменяют null пустыми объектами
> Проверки аргументов на null по-прежнему нужны на границах.

? Для чего атрибут [NotNullWhen(true)]?
- [ ] Запрещает null в параметре
- [x] Сообщает анализатору, что при возврате true out-параметр не null (как в TryGetValue)
- [ ] Генерирует проверку
- [ ] Ускоряет метод
> Уточняет nullable-анализ для своих Try-методов.

? Во что компилятор разворачивает with-выражение для record?
- [ ] В рефлексию
- [x] В вызов скрытого метода клонирования и присвоение изменённых init-свойств
- [ ] В сериализацию и десериализацию
- [ ] В новый конструктор со всеми параметрами
> Копия поверхностная.

? Что сообщает предупреждение CS8509 у switch-выражения?
- [ ] Недостижимая ветка
- [x] switch не обрабатывает все возможные значения
- [ ] Лишний discard
- [ ] Упаковка
> Без обработки — SwitchExpressionException в рантайме.

---recall
Q: Что важно знать о nullable reference types?
A: Это только статический анализ: аннотации ? и предупреждения компилятора, в рантайме поведение не меняется. Их точность улучшают атрибуты NotNullWhen, MaybeNull, MemberNotNull; проверки на границах (публичные API, десериализация) всё равно нужны.

---read
- [Что нового в C# — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/csharp/whats-new/)
- [Сопоставление шаблонов — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/csharp/fundamentals/functional/pattern-matching)
- [SharpLab — посмотреть, во что компилируется код](https://sharplab.io/)

# @csharp-runtime

## Глубже: как JIT оптимизирует
**Инлайнинг**: маленькие методы (до ~16 байт IL по умолчанию, больше — с `[MethodImpl(MethodImplOptions.AggressiveInlining)]`) встраиваются в место вызова. Мешают: виртуальность, try/catch в методе, generic-разделённый код, рекурсия.

**OSR** (On-Stack Replacement): длинный цикл в методе, который вызывается один раз, переключается с Tier 0 на оптимизированный код прямо во время выполнения.

**Escape analysis** (.NET 9–10): объект, который не покидает метод, может быть размещён на стеке — меньше аллокаций без изменения кода.

**Вычисления**: JIT использует SIMD-инструкции процессора (AVX2, AVX-512, ARM NEON) через `Vector128/256/512`; многие API BCL уже векторизованы.

**ReadyToRun + Tiered PGO**: R2R-код — неоптимальный «общий» машинный код для быстрого старта, горячие методы потом всё равно перекомпилируются JIT с учётом профиля.

**Как посмотреть**: `DOTNET_JitDisasm="MethodName"` выводит ассемблер метода при запуске (.NET 7+); `DOTNET_TieredPGO=0` для экспериментов; BenchmarkDotNet `[DisassemblyDiagnoser]`.

---quiz
? Что такое OSR в .NET JIT?
- [ ] Сборка мусора на стеке
- [x] Переход долгого цикла из неоптимизированного кода в оптимизированный прямо во время выполнения метода
- [ ] Удаление неиспользуемого кода
- [ ] Компиляция на сервере
> Иначе метод с единственным долгим вызовом навсегда остался бы в Tier 0.

? Как увидеть ассемблер, который JIT сгенерировал для метода?
- [ ] ildasm
- [x] Переменная окружения DOTNET_JitDisasm с именем метода
- [ ] dotnet build -v diag
- [ ] Никак
> Или DisassemblyDiagnoser в BenchmarkDotNet.

? Что мешает JIT заинлайнить метод?
- [ ] Модификатор static
- [x] Виртуальность без девиртуализации, try/catch внутри, большой размер
- [ ] Возврат int
- [ ] Параметр string
> AggressiveInlining — подсказка, а не гарантия.

? Зачем R2R-код перекомпилируется JIT?
- [ ] R2R-код содержит ошибки
- [x] R2R — универсальный код для быстрого старта; горячие методы JIT оптимизирует под конкретный процессор и профиль
- [ ] Для отладки
- [ ] Для trimming
> Tiered compilation сочетает оба подхода.

---recall
Q: Какие оптимизации выполняет современный JIT .NET?
A: Инлайнинг, девиртуализация (включая guarded по PGO), удаление проверок границ, развёртывание и клонирование циклов, векторизация (SIMD), escape analysis со стековым размещением объектов, OSR для долгих циклов, раскладка горячего и холодного кода по профилю.

---read
- [Tiered compilation — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/core/runtime-config/compilation)
- [Performance Improvements in .NET 9 — Стивен Тауб](https://devblogs.microsoft.com/dotnet/performance-improvements-in-net-9/)
- Книга «Pro .NET Benchmarking», Андрей Акиньшин

# @csharp-benchmark

## Глубже: как не обмануть себя бенчмарком
**Типичные ловушки**:
- **мёртвый код**: результат не используется — JIT выбросит вычисление. BenchmarkDotNet возвращаемые значения «потребляет» сам — возвращайте результат;
- **константы**: входные данные известны JIT и свёртываются — берите их из `[Params]` или полей;
- **слишком маленькая операция** (наносекунды): шум измерения сравним с результатом — `[Benchmark(OperationsPerInvoke = N)]`;
- **разные условия**: сравнивайте в одном прогоне, с `Baseline = true`, на одной машине, в Release, без отладчика;
- **микробенчмарк ≠ реальная система**: кэш процессора «тёплый», данные маленькие — результат может не переноситься.

**Статистика**: смотрите медиану и доверительный интервал; бимодальное распределение — признак, что вы измеряете два разных сценария. `[MemoryDiagnoser]`, `[ThreadingDiagnoser]`, `[EventPipeProfiler]` дают больше измерений.

**Сравнение рантаймов**: `[SimpleJob(RuntimeMoniker.Net80)]` и `Net90` в одном классе — увидеть выигрыш от обновления .NET.

**Нагрузочное тестирование сервиса** (k6, NBomber, bombardier) — другой уровень: пропускная способность и перцентили латентности всей системы.

---quiz
? Почему бенчмарк `for (...) Math.Sqrt(42)` без использования результата может показать 0 нс?
- [ ] Sqrt очень быстрый
- [x] JIT удалил вычисление как мёртвый код или свернул константу
- [ ] BenchmarkDotNet не поддерживает Math
- [ ] Ошибка таймера
> Возвращайте результат и берите данные из полей.

? Что делает OperationsPerInvoke?
- [ ] Запускает бенчмарк параллельно
- [x] Делит измеренное время на число операций внутри одного вызова — для очень быстрых операций
- [ ] Ограничивает число итераций
- [ ] Включает MemoryDiagnoser
> Уменьшает влияние накладных расходов вызова.

? Что может означать бимодальное распределение результатов бенчмарка?
- [ ] Всё нормально
- [x] Измеряются два разных режима (например, попадание и промах кэша, разные ветки)
- [ ] Ошибка BenchmarkDotNet
- [ ] Слишком мало итераций
> Стоит разобраться, а не усреднять.

? Как сравнить производительность кода на .NET 8 и .NET 9 в одном запуске?
- [ ] Никак
- [x] Добавить [SimpleJob] для каждого рантайма в класс бенчмарка
- [ ] Запустить два разных проекта вручную
- [ ] Через dotnet-counters
> BenchmarkDotNet соберёт и прогонит для обоих.

---recall
Q: Назови основные ловушки микробенчмарков.
A: Удаление мёртвого кода и свёртка констант, слишком короткие операции на уровне шума, сравнение в разных условиях (Debug, отладчик, другая машина), неверная статистика (среднее без разброса), нерепрезентативные данные и тёплый кэш, из-за которых результат не переносится на реальную систему.

---read
- [BenchmarkDotNet — документация](https://benchmarkdotnet.org/articles/overview.html)
- Книга «Pro .NET Benchmarking», Андрей Акиньшин
- [Инструменты диагностики .NET — Microsoft Learn](https://learn.microsoft.com/ru-ru/dotnet/core/diagnostics/)
