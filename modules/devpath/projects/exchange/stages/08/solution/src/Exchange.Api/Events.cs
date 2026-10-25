using System.Text.Json;
using Confluent.Kafka;
using Microsoft.EntityFrameworkCore;

namespace Exchange.Api;

public sealed record KafkaOptions(string Bootstrap, string TradesTopic, string CandlesGroup)
{
    public static KafkaOptions From(IConfiguration c) => new(
        c.GetConnectionString("Kafka") ?? "localhost:19092",
        c["Kafka:TradesTopic"] ?? "exchange.trades",
        c["Kafka:CandlesGroup"] ?? "exchange.candles");
}

/// <summary>Событие «сделка» в Kafka. Ключ сообщения — тикер: все сделки инструмента в одной партиции, по порядку.</summary>
public record TradeEvent(Guid TradeId, string Ticker, decimal Price, int Qty, Guid BuyOrderId, Guid SellOrderId, DateTime At);

public static class Outbox
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Записать событие в outbox — в текущей транзакции, вместе со сделкой. Либо есть оба, либо ни одного.</summary>
    public static void Trade(ExchangeDb db, KafkaOptions k, Trade t) =>
        db.Outbox.Add(new OutboxMessage
        {
            Topic = k.TradesTopic,
            Key = t.Ticker,
            Payload = JsonSerializer.Serialize(new TradeEvent(t.Id, t.Ticker, t.Price, t.Qty, t.BuyOrderId, t.SellOrderId, t.At), Json),
        });
}

/// <summary>
/// Публикатор outbox: забирает неотправленные события по порядку и отправляет в Kafka.
/// Активен один экземпляр на всю систему (advisory lock): иначе два публикатора перемешают порядок сделок.
/// Отправка — at-least-once: упали после отправки, но до отметки — событие уйдёт ещё раз, потребитель это переживёт.
/// </summary>
public sealed class OutboxPublisher(IServiceScopeFactory scopes, KafkaOptions k, ILogger<OutboxPublisher> log) : BackgroundService
{
    private const long LeaderLock = 7001;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var producer = new ProducerBuilder<string, string>(new ProducerConfig
        {
            BootstrapServers = k.Bootstrap,
            EnableIdempotence = true, // повторы внутри продюсера не дают дублей и не меняют порядок
            Acks = Acks.All,
            MessageTimeoutMs = 5000,
        }).Build();

        while (!stop.IsCancellationRequested)
        {
            var sent = 0;
            try
            {
                sent = await PublishBatch(producer, stop);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning("Outbox: Kafka недоступна ({Reason}), повторю позже", e.Message);
                await Delay(2000, stop);
            }
            if (sent == 0) await Delay(200, stop);
        }
    }

    private async Task<int> PublishBatch(IProducer<string, string> producer, CancellationToken stop)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ExchangeDb>();
        await using var tx = await db.Database.BeginTransactionAsync(stop);
        var leader = (await db.Database.SqlQuery<bool>($"SELECT pg_try_advisory_xact_lock({LeaderLock}) AS \"Value\"").ToListAsync(stop))[0];
        if (!leader) return 0;
        var batch = await db.Outbox.Where(m => m.SentAt == null).OrderBy(m => m.Id).Take(100).ToListAsync(stop);
        foreach (var m in batch)
        {
            // Ждём подтверждения каждого: порядок важнее скорости. Ошибка — откат транзакции, отметки не будет.
            await producer.ProduceAsync(m.Topic, new Message<string, string> { Key = m.Key, Value = m.Payload }, stop);
            m.SentAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(stop);
        await tx.CommitAsync(stop);
        return batch.Count;
    }

    private static Task Delay(int ms, CancellationToken stop) => Task.Delay(ms, stop).ContinueWith(_ => { });
}

/// <summary>
/// Потребитель сделок: минутные свечи. Группа потребителей — партиции делятся между экземплярами API.
/// Идемпотентность: id учтённой сделки и свеча меняются в одной транзакции; оффсет коммитится после неё.
/// </summary>
public sealed class CandleConsumer(IServiceScopeFactory scopes, KafkaOptions k, ILogger<CandleConsumer> log) : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    protected override Task ExecuteAsync(CancellationToken stop) => Task.Run(() => Run(stop), stop);

    private async Task Run(CancellationToken stop)
    {
        using var consumer = new ConsumerBuilder<string, string>(new ConsumerConfig
        {
            BootstrapServers = k.Bootstrap,
            GroupId = k.CandlesGroup,
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,
            AllowAutoCreateTopics = true,
        }).Build();
        consumer.Subscribe(k.TradesTopic);
        try
        {
            while (!stop.IsCancellationRequested)
            {
                ConsumeResult<string, string>? r;
                try
                {
                    r = consumer.Consume(TimeSpan.FromMilliseconds(500));
                }
                catch (ConsumeException e)
                {
                    if (!e.Error.IsFatal) { await Task.Delay(500, stop); continue; }
                    throw;
                }
                if (r?.Message is null) continue;
                try
                {
                    await Apply(JsonSerializer.Deserialize<TradeEvent>(r.Message.Value, Json)!, stop);
                    consumer.Commit(r); // только после записи в базу: упали раньше — сообщение придёт снова
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    log.LogError(e, "Свечи: не удалось учесть сделку, повторю");
                    consumer.Seek(r.TopicPartitionOffset);
                    await Task.Delay(1000, stop);
                }
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            consumer.Close();
        }
    }

    private async Task Apply(TradeEvent t, CancellationToken stop)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ExchangeDb>();
        await using var tx = await db.Database.BeginTransactionAsync(stop);
        // Повтор события: строка уже есть — ничего не делаем.
        var fresh = await db.Database.ExecuteSqlAsync($"INSERT INTO \"ProcessedTrades\" (\"TradeId\") VALUES ({t.TradeId}) ON CONFLICT DO NOTHING", stop);
        if (fresh == 0) return;
        var start = new DateTime(t.At.Ticks - t.At.Ticks % TimeSpan.TicksPerMinute, DateTimeKind.Utc);
        var c = await db.Candles.FirstOrDefaultAsync(x => x.Ticker == t.Ticker && x.Start == start, stop);
        if (c is null) db.Candles.Add(new Candle { Ticker = t.Ticker, Start = start, Open = t.Price, High = t.Price, Low = t.Price, Close = t.Price, Volume = t.Qty });
        else
        {
            c.High = Math.Max(c.High, t.Price);
            c.Low = Math.Min(c.Low, t.Price);
            c.Close = t.Price; // события инструмента приходят по порядку — последнее и есть закрытие
            c.Volume += t.Qty;
        }
        await db.SaveChangesAsync(stop);
        await tx.CommitAsync(stop);
    }
}
