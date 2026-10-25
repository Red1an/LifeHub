using System.Collections.Concurrent;

namespace CartApi;

/// <summary>Пользователь, который делает текущий запрос.</summary>
public class CurrentUser
{
    public string Id { get; set; } = "";
}

public interface ICartStore
{
    Task<List<string>> LoadAsync(string userId);
    Task SaveAsync(string userId, List<string> items);
}

/// <summary>Хранилище корзин. В жизни — Redis или база, здесь — память с задержкой «как по сети».</summary>
public class InMemoryCartStore : ICartStore
{
    private readonly ConcurrentDictionary<string, List<string>> _carts = new();

    public async Task<List<string>> LoadAsync(string userId)
    {
        await Task.Delay(5);
        return _carts.TryGetValue(userId, out var items) ? [.. items] : [];
    }

    public async Task SaveAsync(string userId, List<string> items)
    {
        await Task.Delay(5);
        _carts[userId] = [.. items];
    }
}

public class CartService(CurrentUser user, ICartStore store)
{
    public async Task<List<string>> AddAsync(string sku)
    {
        var items = await store.LoadAsync(user.Id);
        items.Add(sku);
        await store.SaveAsync(user.Id, items);
        return items;
    }

    public Task<List<string>> GetAsync() => store.LoadAsync(user.Id);
}
