# @dotnet-host

## Как стартует приложение
`WebApplication.CreateBuilder(args)` создаёт **Generic Host** — общий каркас для веб-приложений, воркеров и консольных сервисов. Он даёт три вещи: **конфигурацию**, **логирование** и **DI-контейнер**, а также управляет жизненным циклом (`IHostedService`, graceful shutdown).

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOptions<SmtpOptions>()
    .Bind(builder.Configuration.GetSection("Smtp"))
    .ValidateDataAnnotations()
    .ValidateOnStart();
var app = builder.Build();
app.MapGet("/", () => "ok");
app.Run();
```

## Конфигурация
Источники читаются по порядку, **последний побеждает**: `appsettings.json` → `appsettings.{Environment}.json` → user secrets (только Development) → переменные окружения → аргументы командной строки.

Вложенные ключи в переменных окружения пишутся через двойное подчёркивание: `Smtp__Host=mail.local`. Так конфигурацию подменяют в Docker и Kubernetes без правки файлов.

Секреты не кладут в `appsettings.json`: локально — `dotnet user-secrets`, в проде — переменные окружения, Key Vault, Vault.

## Options pattern
Настройки привязывают к классам и внедряют через интерфейсы:
- `IOptions<T>` — singleton, значение читается один раз;
- `IOptionsSnapshot<T>` — scoped, пересчитывается на каждый запрос (подхватывает изменения файла);
- `IOptionsMonitor<T>` — singleton с `CurrentValue` и событием `OnChange`, для фоновых сервисов.

`ValidateOnStart()` роняет приложение при старте, если конфигурация невалидна, — это лучше, чем падение в 3 часа ночи на первом письме.

## Логирование
`ILogger<T>` — абстракция; провайдеры (консоль, Serilog, OpenTelemetry) подключаются отдельно. Главное правило — **структурное логирование**: шаблон с именованными параметрами, а не интерполяция.

```csharp
log.LogInformation("Заказ {OrderId} оплачен на {Amount}", order.Id, amount);   // хорошо
log.LogInformation($"Заказ {order.Id} оплачен");                            // плохо
```
Параметры становятся полями, по которым можно искать в Seq/Elastic/Loki. Для горячих путей — `[LoggerMessage]` source generator без аллокаций.

---quiz
? Значение `Smtp:Host` задано в appsettings.json, appsettings.Production.json и в переменной окружения `Smtp__Host`. Что получит приложение в Production?
- [ ] Из appsettings.json
- [ ] Из appsettings.Production.json
- [x] Из переменной окружения
- [ ] Ошибку конфликта
> Источники накладываются по порядку, переменные окружения добавлены позже файлов — они и побеждают.

? Какой интерфейс подойдёт для BackgroundService, которому нужно видеть изменения конфигурации без перезапуска?
- [ ] IOptions<T>
- [ ] IOptionsSnapshot<T>
- [x] IOptionsMonitor<T>
- [ ] IConfiguration, прочитанный один раз в конструкторе
> Snapshot — scoped и не внедряется в singleton. Monitor — singleton с CurrentValue и OnChange.

? Почему `LogInformation($"User {id}")` хуже, чем `LogInformation("User {Id}", id)`?
- [ ] Первый не компилируется
- [x] Теряется структура: Id не станет отдельным полем, и строка собирается даже при выключенном уровне
- [ ] Второй вариант медленнее
- [ ] Разницы нет
> Шаблон сообщения — ключ группировки, параметры — поля для поиска. Интерполяция ломает и то, и другое.

---recall
Q: В каком порядке читаются источники конфигурации ASP.NET Core по умолчанию?
A: appsettings.json → appsettings.{Environment}.json → user secrets (в Development) → переменные окружения → аргументы командной строки. Каждый следующий перекрывает предыдущие.

Q: Чем отличаются IOptions, IOptionsSnapshot и IOptionsMonitor?
A: IOptions — singleton, значение фиксируется один раз. Snapshot — scoped, пересчитывается на каждый запрос. Monitor — singleton, всегда актуальное CurrentValue и уведомление OnChange.

# @dotnet-di

## Зачем DI
Внедрение зависимостей — класс не создаёт свои зависимости сам, а получает их через конструктор. Итог: слабая связанность, подмена реализаций (тесты, декораторы), единое место сборки приложения — **composition root** (`Program.cs`).

## Времена жизни
| Время жизни | Экземпляр | Типичный пример |
|---|---|---|
| `Singleton` | один на приложение | кэш, конфигурация, клиенты-обёртки |
| `Scoped` | один на запрос (scope) | `DbContext`, unit of work, текущий пользователь |
| `Transient` | новый при каждом запросе | лёгкие stateless-сервисы |

Singleton обязан быть **потокобезопасным** — его используют все запросы одновременно.

## Captive dependency
Если Singleton зависит от Scoped, scoped-сервис «захватывается» и живёт вечно: один `DbContext` на все запросы → гонки, утечки, устаревшие данные. В Development контейнер проверяет это (`ValidateScopes`) и бросает исключение.

В фоновых сервисах scope создают вручную:
```csharp
public sealed class Cleaner(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Sessions.Where(s => s.Expired).ExecuteDeleteAsync(ct);
            await Task.Delay(TimeSpan.FromMinutes(5), ct);
        }
    }
}
```

## Продвинутые приёмы
- **Keyed services** (.NET 8): несколько реализаций одного интерфейса по ключу — `[FromKeyedServices("sms")] INotifier n`.
- **Фабрики**: `services.AddScoped<IRepo>(sp => new Repo(sp.GetRequiredService<Db>(), "x"))`.
- **Декораторы**: встроенный контейнер их не умеет, помогает библиотека Scrutor (`services.Decorate<IRepo, CachedRepo>()`).
- **Антипаттерн Service Locator**: вытаскивать зависимости из `IServiceProvider` внутри бизнес-кода — зависимости становятся невидимыми, тесты хрупкими.

---quiz
? Singleton-сервис принимает в конструкторе `AppDbContext` (Scoped). Что произойдёт?
- [ ] Всё нормально, контейнер создаст новый DbContext на каждый вызов
- [x] Captive dependency: один DbContext на всё приложение; в Development — исключение валидации
- [ ] Ошибка компиляции
- [ ] DbContext станет Transient
> Singleton создаётся один раз и держит зависимость навсегда. DbContext не потокобезопасен.

? Как правильно использовать DbContext в BackgroundService?
- [ ] Внедрить в конструктор
- [ ] Создать через new без настроек
- [x] Внедрить IServiceScopeFactory и создавать scope на каждую итерацию
- [ ] Зарегистрировать DbContext как Singleton
> Scope на единицу работы — как запрос в веб-приложении.

? Какой lifetime выбрать для сервиса, хранящего данные текущего пользователя запроса?
- [ ] Singleton
- [x] Scoped
- [ ] Transient
- [ ] Любой
> Данные относятся к одному запросу — Scoped. Singleton смешает пользователей.

---recall
Q: Что такое captive dependency и как её обнаружить?
A: Сервис с долгим временем жизни держит сервис с более коротким (Singleton → Scoped), и тот фактически живёт дольше положенного. Обнаруживается ValidateScopes / ValidateOnBuild (включены в Development), лечится правильными lifetimes или IServiceScopeFactory.

Q: Почему Service Locator считается антипаттерном?
A: Зависимости класса не видны в конструкторе, их сложно подменить в тестах, ошибки регистрации обнаруживаются только в рантайме, класс завязан на контейнер.

# @dotnet-middleware

## Конвейер запроса
Приложение ASP.NET Core — это **конвейер middleware**. Каждый компонент получает `HttpContext`, может что-то сделать, вызвать следующий (`await next(context)`) и что-то сделать после. Запрос идёт сверху вниз, ответ — снизу вверх, как матрёшка.

```csharp
app.Use(async (ctx, next) =>
{
    var sw = Stopwatch.StartNew();
    await next(ctx);
    ctx.RequestServices.GetRequiredService<ILogger<Program>>()
       .LogInformation("{Path} {Ms} мс", ctx.Request.Path, sw.ElapsedMilliseconds);
});
```

## Порядок важен
Рекомендуемый порядок:
1. `UseExceptionHandler` — первым, чтобы ловить ошибки всех остальных;
2. `UseHsts`, `UseHttpsRedirection`;
3. `UseStaticFiles` — статику отдаём рано и дёшево;
4. `UseRouting`;
5. `UseCors`;
6. `UseAuthentication` → `UseAuthorization` (сначала узнаём, кто ты, потом проверяем права);
7. `UseRateLimiter`, `UseOutputCache`;
8. эндпоинты (`MapControllers`, `MapGet`).

Middleware, который не вызывает `next`, **замыкает** конвейер (short-circuit): так работают статические файлы и ответы 401.

## Свой middleware
Класс с методом `InvokeAsync(HttpContext ctx)` и конструктором, принимающим `RequestDelegate next`. Такой класс — **singleton**, поэтому scoped-зависимости берут параметрами `InvokeAsync`, а не через конструктор. Альтернатива — `IMiddleware` (создаётся из DI на каждый запрос).

## Фильтры vs middleware
Middleware видит любой запрос, но ничего не знает о контроллере и модели. **Фильтры** (MVC) и **endpoint filters** (Minimal API) работают внутри эндпоинта: знают аргументы, результат, атрибуты. Сквозная HTTP-логика (логирование, заголовки, корреляция) — middleware; логика про конкретные действия (валидация модели, аудит операций) — фильтры.

Ошибки отдавайте в стандарте **ProblemDetails** (RFC 9457): `builder.Services.AddProblemDetails()`.

---quiz
? Расставь middleware в правильном порядке
1. UseExceptionHandler
2. UseRouting
3. UseAuthentication
4. UseAuthorization
5. MapControllers
> Обработчик ошибок — снаружи всех. Аутентификация до авторизации, эндпоинты — в конце.

? Почему в конструктор класса-middleware нельзя внедрять DbContext?
- [ ] DbContext нельзя внедрять вообще
- [x] Middleware создаётся один раз (как singleton), и scoped-сервис станет общим для всех запросов
- [ ] Конструктор middleware не поддерживает параметры
- [ ] Это замедлит запуск
> Scoped-зависимости принимайте параметрами InvokeAsync — они резолвятся на каждый запрос.

? Что будет, если middleware не вызовет `next`?
- [ ] Исключение
- [x] Конвейер замкнётся, последующие компоненты не выполнятся
- [ ] Запрос повторится
- [ ] ASP.NET Core вызовет next автоматически
> Это нормальный приём: так отдаётся статика или 401.

---recall
Q: Чем middleware отличается от фильтров MVC?
A: Middleware работает на уровне HTTP-конвейера для всех запросов и не знает о контроллерах и модели. Фильтры выполняются внутри MVC/эндпоинта, имеют доступ к аргументам действия, результату и метаданным (атрибутам).

# @dotnet-api

## Minimal API или контроллеры
- **Minimal API** — эндпоинты лямбдами, минимум церемоний, быстрее старт (особенно с AOT). Группы (`MapGroup`), endpoint filters, `TypedResults`.
- **Контроллеры** — классы с атрибутами, привычная структура для больших команд.

Оба варианта одинаково «взрослые»; выбирают по стилю команды.

```csharp
var orders = app.MapGroup("/orders").RequireAuthorization().WithTags("Orders");

orders.MapGet("/{id:int}", async Task<Results<Ok<OrderDto>, NotFound>> (int id, AppDb db, CancellationToken ct) =>
    await db.Orders.Where(o => o.Id == id).Select(o => new OrderDto(o.Id, o.Total)).FirstOrDefaultAsync(ct)
        is { } dto ? TypedResults.Ok(dto) : TypedResults.NotFound());
```

## Правила хорошего REST
- Ресурсы — существительные во множественном числе: `/orders/42/items`.
- Методы: `GET` читает, `POST` создаёт (201 + `Location`), `PUT` заменяет, `PATCH` частично меняет, `DELETE` удаляет (204).
- Коды: 400 — ошибка клиента (валидация), 401 — не аутентифицирован, 403 — нет прав, 404 — не найдено, 409 — конфликт, 422 — не проходит бизнес-правила, 429 — лимит, 5xx — ошибка сервера.
- Никогда не отдавайте сущности EF наружу — только DTO. Иначе утечки полей, циклы сериализации и связанность API со схемой БД.

## Валидация
Популярно — **FluentValidation** + endpoint filter (в .NET 10 у Minimal API появилась встроенная валидация DataAnnotations). Ошибки — `ValidationProblem` (400 с деталями по полям).

## Коллекции и версии
- **Пагинация**: offset (`?page=3&size=20`) проста, но медленна на больших смещениях; **keyset/cursor** (`?after=1234`) — стабильна и быстра.
- **Версионирование**: в URL (`/v2/orders`), заголовке или query; библиотека Asp.Versioning. Правило: не ломайте клиентов — добавляйте поля, а не меняйте смысл старых.
- **OpenAPI**: `builder.Services.AddOpenApi()` (.NET 9+) + Scalar или Swagger UI.

---quiz
? Какой код ответа вернуть на успешный POST, создавший ресурс?
- [ ] 200 OK
- [x] 201 Created с заголовком Location
- [ ] 204 No Content
- [ ] 202 Accepted
> 201 + Location на новый ресурс. 202 — если обработка асинхронная и ещё не завершена.

? Почему нельзя возвращать сущности EF Core из API напрямую?
- [ ] Их нельзя сериализовать
- [x] Контракт API связывается со схемой БД, утекают лишние поля, возможны циклы навигаций
- [ ] Это медленнее DTO в 10 раз
- [ ] EF запрещает это
> DTO — стабильный контракт; схему БД можно менять, не ломая клиентов.

? Почему пагинация через OFFSET медленная на больших страницах?
- [ ] OFFSET не использует сортировку
- [x] БД всё равно читает и отбрасывает все пропущенные строки
- [ ] OFFSET блокирует таблицу
- [ ] OFFSET не поддерживается PostgreSQL
> `OFFSET 100000` — прочитать 100 000 строк и выбросить. Keyset: `WHERE id > @last ORDER BY id LIMIT 20` идёт по индексу.

---recall
Q: Чем 401 отличается от 403?
A: 401 Unauthorized — клиент не аутентифицирован (нет или неверный токен). 403 Forbidden — клиент известен, но у него нет прав на действие.

Q: Какие методы HTTP идемпотентны и что это значит?
A: GET, HEAD, PUT, DELETE, OPTIONS: повтор запроса даёт то же состояние сервера. POST и PATCH в общем случае нет — для безопасных повторов нужен Idempotency-Key.

---task CRUD-сервис заметок
Сделай Minimal API для заметок: `GET /notes` (с keyset-пагинацией), `GET /notes/{id}`, `POST`, `PUT`, `DELETE`. Хранение — EF Core + SQLite. Валидация: заголовок 1–200 символов.
- [ ] Используются MapGroup и TypedResults
- [ ] POST возвращает 201 с Location
- [ ] Наружу отдаются DTO, а не сущности
- [ ] Ошибки валидации — ValidationProblem (400)
- [ ] Пагинация через курсор ?after=
- [ ] OpenAPI-документация доступна

# @dotnet-mediatr

## Команды и запросы в приложении
**CQRS на уровне кода** — разделение операций на:
- **команды** — меняют состояние, возвращают минимум (id, результат);
- **запросы** — только читают, могут идти в обход доменной модели (проекции, Dapper).

MediatR — популярная реализация «посредника»: контроллер отправляет объект-сообщение, библиотека находит обработчик.
```csharp
public sealed record CreateOrder(Guid CustomerId, List<Line> Lines) : IRequest<Guid>;

public sealed class CreateOrderHandler(AppDb db) : IRequestHandler<CreateOrder, Guid>
{
    public async Task<Guid> Handle(CreateOrder cmd, CancellationToken ct)
    {
        var order = Order.Create(cmd.CustomerId, cmd.Lines);
        db.Orders.Add(order);
        await db.SaveChangesAsync(ct);
        return order.Id;
    }
}
```

## Pipeline behaviors
Главная сила — **конвейер поведений** вокруг каждого обработчика (как middleware, но для команд): валидация, логирование, транзакции, метрики, повторы.
```csharp
public sealed class ValidationBehavior<TReq, TRes>(IEnumerable<IValidator<TReq>> validators)
    : IPipelineBehavior<TReq, TRes> where TReq : notnull
{
    public async Task<TRes> Handle(TReq req, RequestHandlerDelegate<TRes> next, CancellationToken ct)
    {
        var failures = validators.Select(v => v.Validate(req)).SelectMany(r => r.Errors).ToList();
        if (failures.Count > 0) throw new ValidationException(failures);
        return await next();
    }
}
```

## Когда это лишнее
MediatR добавляет косвенность: из контроллера не видно, какой код выполнится, «Go to definition» не помогает. Для небольшого сервиса проще внедрить обработчик напрямую. Используйте, когда нужен единый конвейер сквозной логики и много однотипных операций. Учтите: новые версии MediatR распространяются по коммерческой лицензии — есть бесплатные альтернативы (Mediator на source generators, Wolverine, свои 50 строк).

---quiz
? Что такое pipeline behavior в MediatR?
- [ ] Обработчик уведомлений
- [x] Обёртка вокруг каждого обработчика для сквозной логики (валидация, логирование, транзакции)
- [ ] Middleware ASP.NET Core
- [ ] Способ регистрации обработчиков
> Behavior вызывается до и после обработчика, как middleware для команд.

? Главный минус MediatR в небольшом проекте?
- [ ] Он медленный
- [x] Лишняя косвенность: труднее проследить, какой код выполняется
- [ ] Он не поддерживает async
- [ ] Он запрещает DI
> Накладные расходы по скорости малы; проблема — навигация и понятность кода.

---recall
Q: Что даёт разделение на команды и запросы внутри приложения?
A: Команды проходят через доменную модель и инварианты, запросы оптимизируются отдельно (проекции, без трекинга, Dapper). Код проще тестировать и развивать, сквозная логика навешивается конвейером.

# @dotnet-auth

## Аутентификация и авторизация
**Аутентификация** — кто ты (проверка токена/куки → `ClaimsPrincipal`). **Авторизация** — что тебе можно (политики, роли, ресурсы).

Схемы:
- **Cookie** — для веб-приложений с сервером (MVC, Razor, Blazor Server); защищать от CSRF.
- **JWT Bearer** — для API и SPA/мобильных клиентов; токен в заголовке `Authorization: Bearer …`.

## JWT
JWT — это `header.payload.signature` в Base64Url. Payload **не зашифрован** — только подписан. Сервер проверяет: подпись (ключ издателя), `iss`, `aud`, `exp`, `nbf`.

```csharp
builder.Services.AddAuthentication().AddJwtBearer(o =>
{
    o.Authority = "https://auth.example.com";   // ключи берутся из OIDC discovery
    o.Audience = "orders-api";
});
```
Access token живёт коротко (5–15 минут), **refresh token** — долго, хранится безопасно и ротируется. Отозвать выданный JWT нельзя — поэтому короткий срок жизни.

## OAuth 2.0 и OpenID Connect
- **OAuth 2.0** — протокол делегирования доступа (выдать приложению доступ к API).
- **OIDC** — слой поверх OAuth для аутентификации (id_token, userinfo).

Потоки: **Authorization Code + PKCE** — для любых пользовательских клиентов (веб, SPA, мобильные); **Client Credentials** — сервис-сервис без пользователя. Implicit и Password flow устарели.

Готовые провайдеры: Keycloak, Duende IdentityServer, Entra ID, Auth0. Писать свой сервер авторизации — почти всегда плохая идея.

## Политики
```csharp
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("CanRefund", p => p.RequireClaim("scope", "payments.refund").RequireRole("Support"));

app.MapPost("/refunds", Refund).RequireAuthorization("CanRefund");
```
Для проверок на уровне ресурса («это мой заказ?») — `IAuthorizationService.AuthorizeAsync(user, order, "Owner")` с собственным `AuthorizationHandler`. Такие проверки нельзя забывать — иначе IDOR.

---quiz
? Что верно про payload JWT?
- [ ] Он зашифрован ключом сервера
- [x] Он только подписан: прочитать его может любой, подделать — нет
- [ ] Он хранится на сервере
- [ ] Его можно отозвать в любой момент
> Не кладите в JWT секреты. Подпись защищает от изменения, но не от чтения.

? Какой поток OAuth использовать для SPA?
- [ ] Implicit
- [ ] Resource Owner Password
- [x] Authorization Code + PKCE
- [ ] Client Credentials
> Implicit устарел, Password передаёт пароль приложению, Client Credentials — без пользователя.

? Найди уязвимость
```csharp bug=4
app.MapGet("/orders/{id:int}", async (int id, AppDb db) =>
{
    // авторизация включена на группе
    var order = await db.Orders.FindAsync(id);
    return order is null ? Results.NotFound() : Results.Ok(order);
});
```
```fix
var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == id && o.UserId == currentUserId);
```
> Аутентификация есть, а проверки владельца нет: любой пользователь прочитает чужой заказ, перебирая id (IDOR — Broken Access Control).

---recall
Q: Зачем нужен refresh token, если есть access token?
A: Access token короткоживущий (минуты), его нельзя отозвать, поэтому держим срок малым. Refresh token долгоживущий, хранится надёжно, по нему выдают новые access-токены; его можно отозвать и ротировать.

Q: Чем OAuth 2.0 отличается от OpenID Connect?
A: OAuth 2.0 — делегирование доступа к ресурсам (access token для API). OIDC — надстройка для аутентификации: id_token с информацией о пользователе, стандартные эндпоинты discovery и userinfo.

# @dotnet-grpc

## gRPC
gRPC — RPC-фреймворк поверх HTTP/2 с контрактом в `.proto` и бинарной сериализацией Protobuf. Из `.proto` генерируется типизированный клиент и сервер.
```protobuf
service Prices {
  rpc Get (PriceRequest) returns (PriceReply);
  rpc Subscribe (PriceRequest) returns (stream PriceReply); // серверный стриминг
}
```
Плюсы: компактно и быстро, строгий контракт, стриминг в обе стороны, **дедлайны** и отмена из коробки. Минусы: браузеры не умеют напрямую (нужен gRPC-Web), сложнее отлаживать, чем JSON.

Где уместен: внутренняя связь микросервисов, высоконагруженные внутренние API, стриминг. Публичное API для внешних клиентов — чаще REST.

## Реальное время: SignalR, WebSockets, SSE
- **WebSockets** — двусторонний постоянный канал.
- **Server-Sent Events** — односторонний поток сервер → клиент поверх обычного HTTP, простой и надёжный (идеален для уведомлений и стриминга ответов LLM).
- **SignalR** — абстракция над WebSockets/SSE/long polling: хабы, группы, автоматическое переподключение, вызов методов клиента с сервера.

## Масштабирование SignalR
Соединение живёт на конкретном сервере. Чтобы отправить сообщение пользователю, подключённому к другому экземпляру, нужен **backplane** (Redis) или Azure SignalR Service. За балансировщиком — sticky sessions (если используется не только WebSocket-транспорт).

---quiz
? Какой механизм проще всего подходит для потоковой отдачи ответа нейросети в браузер?
- [ ] gRPC
- [x] Server-Sent Events
- [ ] Long polling
- [ ] SOAP
> SSE — односторонний поток по обычному HTTP, поддерживается браузерами нативно.

? Зачем SignalR нужен backplane при нескольких экземплярах?
- [ ] Для хранения истории сообщений
- [x] Чтобы сообщение дошло до клиента, подключённого к другому серверу
- [ ] Для балансировки нагрузки
- [ ] Для шифрования
> Каждый сервер знает только свои соединения; backplane рассылает сообщения между серверами.

---recall
Q: Когда выбрать gRPC, а когда REST?
A: gRPC — внутренние сервис-сервис вызовы, высокая нагрузка, строгий контракт, стриминг, дедлайны. REST/JSON — публичные API, браузерные клиенты, простота отладки и широкая совместимость.

# @dotnet-background

## BackgroundService
Фоновая работа в процессе приложения — через `IHostedService` или удобный базовый класс `BackgroundService` с методом `ExecuteAsync(CancellationToken)`. Токен отменяется при остановке приложения.

Важные детали:
- исключение в `ExecuteAsync` по умолчанию **останавливает хост** (.NET 6+) — ловите и логируйте ошибки итерации;
- scoped-сервисы — только через `IServiceScopeFactory`;
- для регулярных задач используйте `PeriodicTimer` вместо `Task.Delay` в цикле.

```csharp
protected override async Task ExecuteAsync(CancellationToken ct)
{
    using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
    while (await timer.WaitForNextTickAsync(ct))
    {
        try { await DoWork(ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Итерация упала"); }
    }
}
```

## Внутренняя очередь на Channels
Чтобы не выполнять долгую работу в запросе, запрос кладёт задание в `Channel<T>`, а фоновый сервис его разбирает. Ограниченный канал (`Channel.CreateBounded`) даёт backpressure. Минус — задания в памяти пропадут при падении процесса.

## Надёжные планировщики
Если задания нельзя терять, нужны ретраи, расписание и история — **Hangfire** (хранит задания в БД, дашборд) или **Quartz.NET** (cron-расписания, кластеризация). В распределённой системе — очередь сообщений (RabbitMQ, Kafka).

## Graceful shutdown
При остановке (SIGTERM в Kubernetes) хост отменяет токены и ждёт `HostOptions.ShutdownTimeout` (по умолчанию 30 с). Фоновые задачи должны уважать отмену и доделывать или откладывать текущую работу.

---quiz
? Что произойдёт по умолчанию в .NET 8, если в ExecuteAsync вылетит необработанное исключение?
- [ ] Сервис перезапустится
- [x] Хост остановит приложение
- [ ] Ничего, исключение проглотится
- [ ] Исключение уйдёт в ответ HTTP
> Поведение задаётся `BackgroundServiceExceptionBehavior` — по умолчанию StopHost.

? Когда взять Hangfire вместо Channel + BackgroundService?
- [ ] Всегда
- [x] Когда задания нельзя терять при падении процесса и нужны ретраи и расписание
- [ ] Когда нужна максимальная скорость
- [ ] Когда нет базы данных
> Hangfire хранит задания в хранилище, Channel — в памяти процесса.

---recall
Q: Как правильно писать периодическую фоновую задачу в .NET?
A: BackgroundService + PeriodicTimer, уважать CancellationToken, оборачивать каждую итерацию в try/catch с логированием, scoped-зависимости брать через IServiceScopeFactory, продумать graceful shutdown.

# @dotnet-testing

## Пирамида тестов
- **Юнит-тесты** — быстрые, изолированные, проверяют логику (домен, алгоритмы).
- **Интеграционные** — проверяют связку с реальной инфраструктурой: БД, HTTP, брокер.
- **E2E** — сценарии через UI/API целиком, медленные и хрупкие, их мало.

Для веб-сервисов популярен «трофей»: больше всего интеграционных тестов через HTTP — они ловят реальные ошибки конфигурации и маппинга.

## xUnit
```csharp
public class PriceTests
{
    [Theory]
    [InlineData(100, 0.1, 90)]
    [InlineData(100, 0, 100)]
    public void ApplyDiscount_ReturnsExpected(decimal price, decimal d, decimal expected)
        => Assert.Equal(expected, Price.ApplyDiscount(price, d));
}
```
Структура **Arrange–Act–Assert**, имя теста описывает поведение.

## Интеграционные тесты
`WebApplicationFactory<Program>` поднимает приложение в памяти, даёт `HttpClient`, позволяет подменить сервисы:
```csharp
public class OrdersApiTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Create_Returns201()
    {
        var res = await f.CreateClient().PostAsJsonAsync("/orders", new { customerId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }
}
```
Для БД — **Testcontainers**: настоящий PostgreSQL в Docker на время тестов. In-memory провайдер EF не заменяет реальную БД (нет транзакций, ограничений, SQL-особенностей).

## Моки — с умом
Моки (Moq, NSubstitute) подменяют внешние зависимости: платёжный шлюз, почту, время (`TimeProvider`). Не мокайте то, что можно проверить реально (свою БД через Testcontainers), и не мокайте свои же классы на каждом шаге — тесты начинают проверять реализацию, а не поведение, и ломаются при любом рефакторинге.

Качество тестов проверяет **мутационное тестирование** (Stryker.NET): оно меняет код и смотрит, упадут ли тесты.

---quiz
? Почему EF Core InMemory-провайдер — плохая замена реальной БД в тестах?
- [ ] Он медленный
- [x] Он не поддерживает транзакции, ограничения и особенности SQL — тесты проходят, а в проде ошибка
- [ ] Он требует Docker
- [ ] Его нельзя использовать с xUnit
> Используйте Testcontainers или хотя бы SQLite in-memory.

? Что делает мутационное тестирование?
- [ ] Генерирует тесты автоматически
- [x] Вносит небольшие изменения в код и проверяет, что тесты их ловят
- [ ] Меняет порядок тестов
- [ ] Проверяет покрытие строк
> Выжившие мутанты показывают места, где тесты ничего не проверяют.

? Как тестировать код, зависящий от текущего времени?
- [ ] Использовать DateTime.Now и Thread.Sleep
- [x] Внедрить TimeProvider и подменить его FakeTimeProvider в тестах
- [ ] Не тестировать такой код
- [ ] Менять системное время
> TimeProvider (.NET 8) — стандартная абстракция времени и таймеров.

---recall
Q: Что даёт WebApplicationFactory?
A: Поднимает приложение в памяти с TestServer, выдаёт HttpClient для запросов через весь конвейер (маршрутизация, middleware, сериализация) и позволяет подменять сервисы и конфигурацию для тестов.

# @dotnet-resilience

## HttpClient правильно
`new HttpClient()` на каждый запрос — классическая ошибка: после Dispose сокеты висят в TIME_WAIT, под нагрузкой кончаются порты. А статический HttpClient на всё приложение не видит смены DNS.

Решение — **IHttpClientFactory**: он переиспользует обработчики (пул соединений) и периодически их пересоздаёт.
```csharp
builder.Services.AddHttpClient<PaymentsClient>(c => c.BaseAddress = new("https://pay.example.com"))
    .AddStandardResilienceHandler();   // retry + timeout + circuit breaker
```

## Стратегии устойчивости
- **Timeout** — не ждать вечно; общий и на одну попытку.
- **Retry** с экспоненциальной задержкой и **jitter** — только для временных ошибок (сетевые сбои, 5xx, 429) и только для **идемпотентных** операций.
- **Circuit breaker** — после серии ошибок перестать дёргать упавший сервис, дать ему восстановиться.
- **Hedging** — параллельный запрос к другой реплике, если первый долго не отвечает.
- **Fallback** — запасной ответ (кэш, значение по умолчанию).

## Polly и Microsoft.Extensions.Resilience
Polly v8 — библиотека стратегий, `Microsoft.Extensions.Http.Resilience` — готовая интеграция с HttpClientFactory. `AddStandardResilienceHandler` включает разумный набор по умолчанию.

Порядок важен: общий таймаут снаружи, ретраи, внутри — circuit breaker и таймаут попытки.

## Ретраи опасны
Ретраи без ограничений превращают небольшой сбой в **шторм запросов** (retry storm): каждый уровень системы повторяет, нагрузка умножается. Правила: ограниченное число попыток, backoff + jitter, ретраи только на одном уровне, retry budget, уважать `Retry-After`.

---quiz
? Какую операцию можно безопасно повторять автоматически?
- [x] GET /orders/42
- [ ] POST /payments без ключа идемпотентности
- [ ] POST /emails/send
- [ ] PATCH /balance/increment
> Повтор неидемпотентной операции может списать деньги дважды.

? Зачем добавлять jitter к экспоненциальной задержке?
- [ ] Чтобы запросы шли быстрее
- [x] Чтобы клиенты не повторяли запросы синхронными волнами
- [ ] Чтобы обойти rate limit
- [ ] Для шифрования
> Без случайности тысячи клиентов ударят по сервису одновременно.

? Расставь стратегии от внешней к внутренней (типичный конвейер)
1. Общий таймаут запроса
2. Retry
3. Circuit breaker
4. Таймаут одной попытки
> Retry должен видеть срабатывания breaker и таймаута попытки; общий таймаут ограничивает всё.

---recall
Q: Какие проблемы решает IHttpClientFactory?
A: Исчерпание сокетов при создании HttpClient на каждый запрос (пул обработчиков переиспользуется) и устаревший DNS у долгоживущего статического клиента (обработчики пересоздаются). Плюс централизованная настройка и resilience-конвейер.

# @dotnet-caching

## Уровни кэша
- **In-memory** (`IMemoryCache`) — самый быстрый, но свой у каждого экземпляра, пропадает при рестарте.
- **Распределённый** (`IDistributedCache` → Redis) — общий для всех экземпляров, но сетевой вызов и сериализация.
- **HybridCache** (.NET 9) — L1 в памяти + L2 распределённый, защита от stampede, теги для инвалидации.
- **Output caching** — кэширование HTTP-ответов целиком.

```csharp
public async Task<Product?> Get(int id, CancellationToken ct) =>
    await cache.GetOrCreateAsync($"product:{id}",
        async token => await db.Products.FindAsync([id], token),
        new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(5) },
        tags: ["products"], cancellationToken: ct);
```

## Стратегии
- **Cache-aside** — приложение читает кэш, при промахе идёт в БД и кладёт результат. Самая распространённая.
- **Write-through** — запись идёт в кэш и БД одновременно.
- **Write-behind** — запись в кэш, в БД — асинхронно (быстро, но риск потери).

## Инвалидация
«Две сложные вещи в программировании: инвалидация кэша и именование». Подходы: TTL (просто, но данные устаревают), явное удаление при изменении, теги, версия в ключе, события об изменениях.

## Cache stampede
Популярный ключ истёк → сотни запросов одновременно идут в БД пересчитывать его. Защита: блокировка на пересчёт (HybridCache делает это сам), ранний фоновый пересчёт, случайный разброс TTL.

Ещё проблемы: **cache penetration** (запросы несуществующих ключей — кэшируйте «пусто»), **горячие ключи**, раздувание памяти (задавайте `SizeLimit`).

---quiz
? Что такое cache stampede?
- [ ] Переполнение кэша
- [x] Одновременный пересчёт истёкшего популярного ключа множеством запросов
- [ ] Рассинхронизация кэшей экземпляров
- [ ] Удаление всех ключей Redis
> Решения: одна загрузка на ключ (lock/HybridCache), ранний пересчёт, jitter TTL.

? Почему IMemoryCache может отдавать разные данные на разных серверах?
- [ ] Из-за ошибки .NET
- [x] Кэш свой у каждого экземпляра, инвалидация на одном не видна другим
- [ ] Из-за сериализации
- [ ] IMemoryCache общий для всех серверов
> Для согласованности — распределённый кэш или рассылка событий инвалидации.

---recall
Q: Опиши стратегию cache-aside.
A: Приложение сначала ищет данные в кэше; при промахе читает из БД, кладёт в кэш с TTL и возвращает. При изменении данных запись идёт в БД, а ключ кэша удаляется (или обновляется).

# @dotnet-observability

## Три сигнала
- **Логи** — события с контекстом (что случилось).
- **Метрики** — числа во времени (сколько, как быстро): RPS, ошибки, латентность, память.
- **Трейсы** — путь одного запроса через все сервисы (где тормозит).

Связывает их **trace id**: по нему из алерта метрики переходят к трейсу, а из трейса — к логам.

## OpenTelemetry в .NET
В .NET трейсинг встроен через `System.Diagnostics.Activity`, метрики — через `System.Diagnostics.Metrics.Meter`. OpenTelemetry SDK собирает их и экспортирует (OTLP) в Jaeger, Tempo, Prometheus, Aspire Dashboard, облачные сервисы.

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter())
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddRuntimeInstrumentation().AddOtlpExporter());
```

## Свои спаны и метрики
```csharp
static readonly ActivitySource Source = new("Orders");
static readonly Counter<long> Paid = new Meter("Orders").CreateCounter<long>("orders.paid");

using var activity = Source.StartActivity("ProcessPayment");
activity?.SetTag("order.id", orderId);
Paid.Add(1);
```
Контекст трассировки передаётся между сервисами в заголовке W3C `traceparent` — HttpClient и ASP.NET Core делают это автоматически, для брокеров сообщений — вручную или через инструментацию библиотеки.

## Health checks
`/health/live` — процесс жив (для liveness), `/health/ready` — готов принимать трафик: доступны БД, кэш (для readiness). Не делайте liveness зависимым от БД — иначе упавшая БД приведёт к перезапуску всех подов.

---quiz
? Как в .NET называется примитив, из которого строятся спаны трейсинга?
- [ ] Span<T>
- [x] Activity
- [ ] Trace
- [ ] EventSource
> ActivitySource.StartActivity создаёт спан, OpenTelemetry его экспортирует.

? Почему liveness-проба не должна проверять базу данных?
- [ ] Это медленно
- [x] При падении БД Kubernetes перезапустит все поды, хотя они ни в чём не виноваты
- [ ] БД нельзя проверять из приложения
- [ ] Liveness вообще не нужна
> Зависимости проверяет readiness: под просто уберут из балансировки.

---recall
Q: Чем различаются логи, метрики и трейсы?
A: Логи — отдельные события с деталями. Метрики — агрегированные числовые ряды для алертов и дашбордов, дешёвые в хранении. Трейсы — дерево спанов одного запроса через сервисы, показывают, где тратится время. Связываются через trace id.

# @dotnet-aspire

## Что такое .NET Aspire
Aspire — набор инструментов для разработки распределённых приложений на .NET:
- **AppHost** — проект на C#, описывающий, из чего состоит система: сервисы, БД, кэши, брокеры;
- **интеграции** — готовые пакеты для Postgres, Redis, RabbitMQ, Kafka и др. с health checks и телеметрией;
- **Dashboard** — логи, трейсы и метрики всех сервисов в одном окне;
- **service defaults** — общие настройки OpenTelemetry, health checks, resilience.

```csharp
var builder = DistributedApplication.CreateBuilder(args);
var db = builder.AddPostgres("pg").AddDatabase("orders");
var cache = builder.AddRedis("cache");
builder.AddProject<Projects.Orders_Api>("api").WithReference(db).WithReference(cache);
builder.Build().Run();
```
Один запуск — и поднимаются контейнеры Postgres и Redis, API получает строки подключения, всё видно в дашборде.

## Service discovery
Сервисы обращаются друг к другу по имени (`http://catalog`), а Aspire подставляет реальные адреса локально и при деплое.

## Деплой
Aspire не заменяет Kubernetes: из описания AppHost инструменты (Aspire CLI, azd) создают Docker Compose, Kubernetes-манифесты или облачные ресурсы. Главная ценность — **локальная разработка** распределённой системы без ручного docker-compose и настройки телеметрии.

---quiz
? Что описывает проект AppHost в .NET Aspire?
- [ ] Бизнес-логику
- [x] Состав распределённого приложения: сервисы, базы, кэши и связи между ними
- [ ] Kubernetes-кластер
- [ ] Только конфигурацию логирования
> AppHost — оркестратор для локального запуска и источник описания для деплоя.

---recall
Q: Какие задачи решает .NET Aspire?
A: Локальный запуск распределённой системы одной командой (контейнеры зависимостей, строки подключения), единая телеметрия и дашборд, service discovery, стандартные настройки (OpenTelemetry, health checks, resilience), генерация артефактов для деплоя.

# @dotnet-performance

## С чего начинать
Производительность сервиса = латентность (p50/p95/p99) + пропускная способность + ресурсы. Сначала **нагрузочный тест** (k6, NBomber, Bombardier) и профилирование, потом оптимизация. Чаще всего тормозит не C#, а: запросы к БД (N+1, нет индексов), синхронные вызовы других сервисов, блокировки потоков, чрезмерные аллокации.

## Встроенные инструменты ASP.NET Core
- **Response compression** — gzip/brotli для текстовых ответов (часто лучше делать на reverse proxy).
- **Output caching** — кэш ответов с тегами и инвалидацией.
- **Rate limiting middleware** — fixed window, sliding window, token bucket, concurrency limiter.
```csharp
builder.Services.AddRateLimiter(o => o.AddTokenBucketLimiter("api", l =>
{
    l.TokenLimit = 100; l.TokensPerPeriod = 50; l.ReplenishmentPeriod = TimeSpan.FromSeconds(1);
}));
app.UseRateLimiter();
app.MapGet("/search", Search).RequireRateLimiting("api");
```

## Меньше аллокаций на запрос
- System.Text.Json с source generation;
- `ArrayPool`, `ObjectPool<T>` для дорогих временных объектов;
- стриминг ответа (`IAsyncEnumerable`) вместо сборки огромного списка;
- избегать `.ToList()` без нужды, больших строк и LOH-аллокаций.

## Пул потоков
Под нагрузкой главный враг — **thread pool starvation**: синхронные блокировки (`.Result`, синхронный I/O) занимают потоки, новые добавляются медленно, латентность растёт лавинообразно. Симптом в `dotnet-counters`: растёт `ThreadPool Queue Length` при низком CPU.

---quiz
? Сервис под нагрузкой: CPU 15%, латентность выросла в 10 раз, очередь пула потоков растёт. Вероятная причина?
- [ ] Не хватает CPU
- [x] Thread pool starvation из-за синхронных блокировок
- [ ] Медленный JSON
- [ ] Утечка памяти
> Потоки ждут, а не работают. Ищите .Result/.Wait(), синхронный I/O, lock на долгих операциях.

? Какой алгоритм rate limiting позволяет короткие всплески, ограничивая среднюю скорость?
- [ ] Fixed window
- [x] Token bucket
- [ ] Concurrency limiter
- [ ] Round robin
> Корзина накапливает токены до лимита — всплеск тратит накопленное.

---recall
Q: Как подойти к оптимизации производительности API?
A: Определить цели (p95, RPS), воспроизвести нагрузочным тестом, профилировать (dotnet-counters/trace, трейсы, медленные запросы БД), устранить главное узкое место, повторить замер. Типичные причины — БД, внешние вызовы, блокировки потоков, аллокации.

# @dotnet-deploy

## Варианты публикации
- **Framework-dependent** — нужен установленный .NET runtime, маленький размер.
- **Self-contained** — runtime внутри, запускается где угодно той же ОС/архитектуры.
- **Single-file** — всё в одном исполняемом файле.
- **Native AOT** — нативный бинарник, быстрый старт, ограничения рефлексии.
- **Контейнер** без Dockerfile: `dotnet publish /t:PublishContainer` собирает образ сам.

## Где живёт приложение
- **Kestrel** — встроенный веб-сервер, достаточно быстрый для прямой работы, но обычно стоит за **reverse proxy** (Nginx, YARP, облачный балансировщик), который делает TLS, сжатие, лимиты.
- За прокси обязательно `UseForwardedHeaders`, иначе приложение увидит IP прокси и схему http.
- **Linux**: systemd-сервис (`Type=notify`, `UseSystemd()`), логи в journald.
- **Windows**: IIS (in-process hosting через ASP.NET Core Module) или Windows Service (`UseWindowsService()`).
- **Контейнеры/Kubernetes** — основной путь в современных командах.

## Безопасный деплой
- health checks для readiness/liveness;
- **graceful shutdown**: по SIGTERM перестать принимать новые запросы, доработать текущие (`ShutdownTimeout`);
- миграции БД — отдельным шагом до выкладки, **обратно совместимые** (expand → migrate → contract), чтобы старая и новая версии работали одновременно при rolling update;
- конфигурация — через переменные окружения, секреты — из хранилища секретов.

---quiz
? Приложение за Nginx видит все запросы с IP 127.0.0.1 и схемой http. Что забыли?
- [ ] UseHttpsRedirection
- [x] UseForwardedHeaders с доверенными прокси
- [ ] UseCors
- [ ] Перезапустить Nginx
> Прокси передаёт реальные данные в X-Forwarded-For/Proto, приложение должно их принять.

? Почему миграция «переименовать колонку» опасна при rolling update?
- [ ] Rolling update не поддерживает миграции
- [x] Какое-то время работают старая и новая версии приложения, и одна из них не найдёт колонку
- [ ] Переименование колонок запрещено в PostgreSQL
- [ ] Миграции всегда выполняются после деплоя
> Делайте в несколько шагов: добавить новую колонку, писать в обе, перенести данные, удалить старую.

---recall
Q: Что такое схема миграций expand/contract?
A: Изменение схемы в несколько обратно совместимых шагов: сначала расширить (добавить новое, не ломая старое), выкатить код, работающий с обоими вариантами, перенести данные, и только потом удалить старое. Позволяет деплоить без простоя.
