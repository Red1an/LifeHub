namespace Payments;

public record ChargeRequest(string OrderId, decimal Amount, string IdempotencyKey);

public record ChargeResult(string PaymentId, decimal Amount);

public class PaymentGatewayException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public interface IPaymentGateway
{
    Task<ChargeResult> ChargeAsync(ChargeRequest request, CancellationToken ct);
}

public interface IDelay
{
    Task Wait(TimeSpan time, CancellationToken ct);
}

public class PaymentService(IPaymentGateway gateway, IDelay delay)
{
    public const int MaxAttempts = 4;
    public static readonly TimeSpan FirstDelay = TimeSpan.FromMilliseconds(200);

    public async Task<ChargeResult> PayAsync(string orderId, decimal amount, CancellationToken ct = default)
    {
        // Ключ создаётся один раз на операцию «оплатить заказ», а не на каждую попытку:
        // только так шлюз поймёт, что повтор — это та же оплата.
        var request = new ChargeRequest(orderId, amount, Guid.NewGuid().ToString());
        var pause = FirstDelay;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await gateway.ChargeAsync(request, ct);
            }
            catch (Exception e) when (attempt < MaxAttempts && IsTransient(e, ct))
            {
                await delay.Wait(pause, ct);
                pause *= 2;
            }
        }
    }

    /// <summary>Повторять имеет смысл, только если следующая попытка может пройти.</summary>
    private static bool IsTransient(Exception e, CancellationToken ct) => e switch
    {
        PaymentGatewayException { StatusCode: 429 or >= 500 } => true,
        // Таймаут HTTP-клиента — тоже TaskCanceledException; отличаем его от отмены вызывающим.
        OperationCanceledException => !ct.IsCancellationRequested,
        HttpRequestException => true,
        _ => false,
    };
}
