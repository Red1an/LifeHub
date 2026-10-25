namespace Shop;

/// <summary>Товар из каталога. Каждый запрос загружает свежий объект из базы.</summary>
public class Product
{
    public required string Sku { get; init; }
    public required string Name { get; set; }
    public decimal Price { get; set; }
}

public class Cart
{
    private readonly Dictionary<Product, int> _items = new();

    public void Add(Product product, int quantity = 1)
    {
        if (_items.ContainsKey(product))
            _items[product] += quantity;
        else
            _items[product] = quantity;
    }

    /// <summary>Убрать товар из корзины целиком.</summary>
    public void Remove(Product product) => _items.Remove(product);

    public int Quantity(Product product) => _items.TryGetValue(product, out var q) ? q : 0;

    /// <summary>Сколько разных товаров в корзине.</summary>
    public int Lines => _items.Count;

    /// <summary>Сумма по цене, с которой товар впервые положили в корзину.</summary>
    public decimal Total => _items.Sum(x => x.Key.Price * x.Value);
}
