namespace Shop;

public class Product
{
    public required string Sku { get; init; }
    public required string Name { get; set; }
    public decimal Price { get; set; }
}

public class Cart
{
    // Ключ — артикул: товар в корзине определяется им, а не тем, какой это объект в памяти.
    // Значение хранит цену на момент добавления: объект товара может поменяться в каталоге.
    private readonly Dictionary<string, Line> _items = new();

    private sealed record Line(decimal Price, int Quantity);

    public void Add(Product product, int quantity = 1)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(quantity);
        _items[product.Sku] = _items.TryGetValue(product.Sku, out var line)
            ? line with { Quantity = line.Quantity + quantity }
            : new Line(product.Price, quantity);
    }

    public void Remove(Product product) => _items.Remove(product.Sku);

    public int Quantity(Product product) => _items.TryGetValue(product.Sku, out var line) ? line.Quantity : 0;

    public int Lines => _items.Count;

    public decimal Total => _items.Values.Sum(l => l.Price * l.Quantity);
}
