using Shop;

public class CartTests
{
    // Как в настоящем приложении: каждый запрос получает новый объект товара из базы.
    static Product Load(string sku, decimal price = 100m) => new() { Sku = sku, Name = $"Товар {sku}", Price = price };

    [Fact(DisplayName = "1. Один и тот же товар из двух запросов — одна строка")]
    public void SameSkuIsOneLine()
    {
        var cart = new Cart();
        cart.Add(Load("A-1"));
        cart.Add(Load("A-1"));
        Assert.Equal(1, cart.Lines);
        Assert.Equal(2, cart.Quantity(Load("A-1")));
    }

    [Fact(DisplayName = "2. Разные товары — разные строки")]
    public void DifferentSku()
    {
        var cart = new Cart();
        cart.Add(Load("A-1"), 2);
        cart.Add(Load("B-2"));
        Assert.Equal(2, cart.Lines);
        Assert.Equal(300m, cart.Total);
    }

    [Fact(DisplayName = "3. Удаление работает с объектом из другого запроса")]
    public void RemoveBySku()
    {
        var cart = new Cart();
        cart.Add(Load("A-1"));
        cart.Remove(Load("A-1"));
        Assert.Equal(0, cart.Lines);
    }

    [Fact(DisplayName = "4. Переименование товара в каталоге не теряет его в корзине")]
    public void RenameKeepsItem()
    {
        var cart = new Cart();
        var p = Load("A-1");
        cart.Add(p);
        p.Name = "Новое название";
        p.Price = 999m;
        cart.Add(Load("A-1"));
        Assert.Equal(1, cart.Lines);
        Assert.Equal(2, cart.Quantity(Load("A-1")));
    }

    [Fact(DisplayName = "5. Цена фиксируется в момент первого добавления")]
    public void PriceIsFixed()
    {
        var cart = new Cart();
        var p = Load("A-1", 100m);
        cart.Add(p);
        p.Price = 150m;
        cart.Add(Load("A-1", 150m));
        Assert.Equal(200m, cart.Total);
    }

    [Fact(DisplayName = "6. Количество должно быть больше нуля")]
    public void QuantityMustBePositive()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new Cart().Add(Load("A-1"), 0));
    }
}
