---
title: Ограничитель частоты
level: 2
topics: dotnet-resilience, arch-api
minutes: 25
---
API отправки СМС: не больше `capacity` сообщений подряд, дальше — по `refillPerSecond` в секунду. Это «ведро с жетонами» (token bucket).

- В начале ведро полное: `capacity` жетонов.
- Каждую секунду добавляется `refillPerSecond` жетонов (дробно: 0,5 в секунду — один жетон раз в 2 секунды), но не больше `capacity`.
- `TryAcquire()` забирает жетон и возвращает `true`, если он есть; иначе `false`.
- Время берётся **только** из переданного `TimeProvider` (в тестах время управляемое).

---starter
```csharp
public class RateLimiter
{
    public RateLimiter(int capacity, double refillPerSecond, TimeProvider time)
    {
        throw new NotImplementedException();
    }

    public bool TryAcquire()
    {
        throw new NotImplementedException();
    }
}
```

---why
**Идея — «ленивое» пополнение.** Не нужен таймер, который каждую секунду добавляет жетоны. При каждом вызове считаем,
сколько прошло с прошлого раза, и добавляем `прошло × скорость`. Таймер тратил бы ресурсы и потоки даже без запросов.

**Почему `double` для жетонов.** Скорость дробная: при 0,5 в секунду через секунду накоплено полжетона. Если хранить целые,
полжетона потеряется при каждом вызове, и реальная скорость станет меньше заявленной.

**Почему `TimeProvider`.** С `DateTime.UtcNow` тест «через 2 секунды появится жетон» пришлось бы делать с настоящим ожиданием —
медленно и нестабильно. `TimeProvider` (.NET 8+) — стандартная абстракция над временем, в тестах — `FakeTimeProvider`.
И `GetTimestamp()` монотонный: он не прыгает назад, когда на сервере синхронизируют часы.

**Альтернативы:** фиксированное окно («100 в минуту» со сбросом в :00 — простое, но даёт всплеск 200 запросов на границе окон),
скользящее окно (точнее, но хранит время каждого запроса). Token bucket разрешает короткие всплески до `capacity` и держит
среднюю скорость — поэтому его любят. В ASP.NET Core готовый — `AddRateLimiter` с `TokenBucketRateLimiter`.

**Многопоточность** здесь не требуется, но в реальном коде `TryAcquire` вызывают из многих запросов сразу — нужен `lock`.

---solution
```csharp
public class RateLimiter
{
    private readonly int _capacity;
    private readonly double _refillPerSecond;
    private readonly TimeProvider _time;
    private double _tokens;
    private long _last;

    public RateLimiter(int capacity, double refillPerSecond, TimeProvider time)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);
        ArgumentOutOfRangeException.ThrowIfNegative(refillPerSecond);
        _capacity = capacity;
        _refillPerSecond = refillPerSecond;
        _time = time;
        _tokens = capacity;
        _last = time.GetTimestamp();
    }

    public bool TryAcquire()
    {
        var now = _time.GetTimestamp();
        var elapsed = _time.GetElapsedTime(_last, now).TotalSeconds;
        _last = now;
        _tokens = Math.Min(_capacity, _tokens + elapsed * _refillPerSecond);
        if (_tokens < 1) return false;
        _tokens -= 1;
        return true;
    }
}
```
