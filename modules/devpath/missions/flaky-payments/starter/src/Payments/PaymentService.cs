namespace Payments;

public record ChargeRequest(string OrderId, decimal Amount, string IdempotencyKey);

public record ChargeResult(string PaymentId, decimal Amount);

/// <summary>Ошибка платёжного шлюза с HTTP-кодом ответа.</summary>
public class PaymentGatewayException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public interface IPaymentGateway
{
    /// <summary>Списать деньги. Повтор с тем же IdempotencyKey шлюз не спишет второй раз, а вернёт первый результат.</summary>
    Task<ChargeResult> ChargeAsync(ChargeRequest request, CancellationToken ct);
}

/// <summary>Пауза между попытками. В тестах — без настоящего ожидания.</summary>
public interface IDelay
{
    Task Wait(TimeSpan time, CancellationToken ct);
}

public class PaymentService(IPaymentGateway gateway, IDelay delay)
{
    public const int MaxAttempts = 4;
    public static readonly TimeSpan FirstDelay = TimeSpan.FromMilliseconds(200);

    /// <summary>Оплатить заказ. Временные сбои шлюза — повторить, постоянные — сразу сообщить.</summary>
    public async Task<ChargeResult> PayAsync(string orderId, decimal amount, CancellationToken ct = default)
    {
        var request = new ChargeRequest(orderId, amount, Guid.NewGuid().ToString());
        return await gateway.ChargeAsync(request, ct);
    }
}
