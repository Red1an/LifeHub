using Payments;

public class PaymentServiceTests
{
    /// <summary>Шлюз по сценарию: каждая попытка берёт следующий шаг. null — успех.</summary>
    sealed class ScriptedGateway(params Exception?[] script) : IPaymentGateway
    {
        public List<ChargeRequest> Calls { get; } = [];
        private readonly Dictionary<string, ChargeResult> _charged = new();
        public int Charged => _charged.Count;

        public Task<ChargeResult> ChargeAsync(ChargeRequest request, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Calls.Add(request);
            var step = Calls.Count <= script.Length ? script[Calls.Count - 1] : null;
            // Как настоящий шлюз: деньги могли списаться, а ответ — потеряться по дороге.
            if (step is TimeoutException)
            {
                _charged.TryAdd(request.IdempotencyKey, new ChargeResult($"pay-{Calls.Count}", request.Amount));
                throw new TaskCanceledException("Ответ шлюза не пришёл");
            }
            if (step is not null) throw step;
            if (!_charged.TryGetValue(request.IdempotencyKey, out var r))
                _charged[request.IdempotencyKey] = r = new ChargeResult($"pay-{Calls.Count}", request.Amount);
            return Task.FromResult(r);
        }
    }

    sealed class RecordingDelay(CancellationTokenSource? cancelOnFirstWait = null) : IDelay
    {
        public List<TimeSpan> Waits { get; } = [];

        public Task Wait(TimeSpan time, CancellationToken ct)
        {
            Waits.Add(time);
            cancelOnFirstWait?.Cancel();
            ct.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }
    }

    static PaymentGatewayException Http(int code) => new(code, $"HTTP {code}");

    [Fact(DisplayName = "1. Успех с первой попытки — один запрос, без пауз")]
    public async Task FirstTry()
    {
        var gw = new ScriptedGateway();
        var delay = new RecordingDelay();
        var r = await new PaymentService(gw, delay).PayAsync("order-1", 990m);
        Assert.Equal(990m, r.Amount);
        Assert.Single(gw.Calls);
        Assert.Empty(delay.Waits);
    }

    [Fact(DisplayName = "2. Шлюз дважды ответил 503 — третья попытка успешна")]
    public async Task RetriesTransient()
    {
        var gw = new ScriptedGateway(Http(503), Http(503));
        var r = await new PaymentService(gw, new RecordingDelay()).PayAsync("order-1", 990m);
        Assert.Equal(3, gw.Calls.Count);
        Assert.Equal(990m, r.Amount);
    }

    [Fact(DisplayName = "3. Все попытки — с одним ключом идемпотентности")]
    public async Task SameKey()
    {
        var gw = new ScriptedGateway(Http(503), Http(502));
        await new PaymentService(gw, new RecordingDelay()).PayAsync("order-1", 990m);
        Assert.Single(gw.Calls.Select(c => c.IdempotencyKey).Distinct());
    }

    [Fact(DisplayName = "4. Ответ потерялся по дороге — деньги списаны один раз")]
    public async Task LostResponseChargesOnce()
    {
        var gw = new ScriptedGateway(new TimeoutException());
        await new PaymentService(gw, new RecordingDelay()).PayAsync("order-1", 990m);
        Assert.Equal(2, gw.Calls.Count);
        Assert.Equal(1, gw.Charged);
    }

    [Theory(DisplayName = "5. Отказ по существу (4xx) — без повторов")]
    [InlineData(400)]
    [InlineData(402)]
    [InlineData(409)]
    public async Task NoRetryOnClientError(int code)
    {
        var gw = new ScriptedGateway(Http(code));
        var delay = new RecordingDelay();
        var ex = await Assert.ThrowsAsync<PaymentGatewayException>(() => new PaymentService(gw, delay).PayAsync("order-1", 990m));
        Assert.Equal(code, ex.StatusCode);
        Assert.Single(gw.Calls);
        Assert.Empty(delay.Waits);
    }

    [Fact(DisplayName = "6. 429 (слишком часто) — это временно, повторяем")]
    public async Task RetryOn429()
    {
        var gw = new ScriptedGateway(Http(429));
        await new PaymentService(gw, new RecordingDelay()).PayAsync("order-1", 990m);
        Assert.Equal(2, gw.Calls.Count);
    }

    [Fact(DisplayName = "7. Не больше 4 попыток, потом — исходная ошибка")]
    public async Task GivesUp()
    {
        var gw = new ScriptedGateway(Http(503), Http(503), Http(503), Http(503), Http(503), Http(503));
        var ex = await Assert.ThrowsAsync<PaymentGatewayException>(() => new PaymentService(gw, new RecordingDelay()).PayAsync("order-1", 990m));
        Assert.Equal(503, ex.StatusCode);
        Assert.Equal(PaymentService.MaxAttempts, gw.Calls.Count);
    }

    [Fact(DisplayName = "8. Паузы растут вдвое: 200, 400, 800 мс")]
    public async Task ExponentialBackoff()
    {
        var gw = new ScriptedGateway(Http(503), Http(503), Http(503));
        var delay = new RecordingDelay();
        await new PaymentService(gw, delay).PayAsync("order-1", 990m);
        Assert.Equal([200, 400, 800], delay.Waits.Select(w => (int)w.TotalMilliseconds));
    }

    [Fact(DisplayName = "9. Отмена вызывающим — больше не пытаемся")]
    public async Task StopsOnCancel()
    {
        using var cts = new CancellationTokenSource();
        var gw = new ScriptedGateway(Http(503), Http(503));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new PaymentService(gw, new RecordingDelay(cts)).PayAsync("order-1", 990m, cts.Token));
        Assert.Single(gw.Calls);
    }
}
