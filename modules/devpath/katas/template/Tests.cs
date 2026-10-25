using Xunit;

public class TemplateTests
{
    static Dictionary<string, object?> V(params (string K, object? V)[] items) => items.ToDictionary(x => x.K, x => x.V);

    [Fact(DisplayName = "Пример из условия")]
    public void Example() => Assert.Equal("Привет, Аня! {скидка}", Kata.Render("Привет, {name}! {{скидка}}", V(("name", "Аня"))));

    [Fact(DisplayName = "Несколько ключей и числа")]
    public void Many() => Assert.Equal("Заказ №42 на 990 ₽", Kata.Render("Заказ №{order} на {sum} ₽", V(("order", 42), ("sum", 990))));

    [Fact(DisplayName = "null — пустая строка")]
    public void Null() => Assert.Equal("[]", Kata.Render("[{x}]", V(("x", null))));

    [Fact(DisplayName = "Подставленное значение не разбирается ещё раз")]
    public void NoInjection() => Assert.Equal("{order} и 42", Kata.Render("{name} и {order}", V(("name", "{order}"), ("order", 42))));

    [Fact(DisplayName = "Нет ключа — KeyNotFoundException с именем ключа")]
    public void Missing()
    {
        var ex = Assert.Throws<KeyNotFoundException>(() => Kata.Render("Привет, {name}", V()));
        Assert.Contains("name", ex.Message);
    }

    [Theory(DisplayName = "Сломанный шаблон — FormatException")]
    [InlineData("Привет, {name")]
    [InlineData("Привет }")]
    public void Broken(string t) => Assert.Throws<FormatException>(() => Kata.Render(t, V(("name", "x"))));
}
