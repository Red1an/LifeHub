using Xunit;

public class TopCategoryTests
{
    [Fact(DisplayName = "Пример из условия")]
    public void Example()
    {
        var r = Kata.TopCategory([new("anna", "Книги", 500), new("anna", "Кофе", 300), new("anna", "Кофе", 400)]);
        Assert.Equal(new Dictionary<string, string> { ["anna"] = "Кофе" }, r);
    }

    [Fact(DisplayName = "Несколько клиентов — у каждого своё")]
    public void Many()
    {
        var r = Kata.TopCategory([new("a", "X", 1), new("b", "Y", 5), new("b", "X", 4), new("a", "Z", 2)]);
        Assert.Equal("Z", r["a"]);
        Assert.Equal("Y", r["b"]);
    }

    [Fact(DisplayName = "Равные суммы — по алфавиту")]
    public void Tie() => Assert.Equal("Аудио", Kata.TopCategory([new("a", "Книги", 100), new("a", "Аудио", 100)])["a"]);

    [Fact(DisplayName = "Возвраты уменьшают сумму")]
    public void Refunds() => Assert.Equal("Книги", Kata.TopCategory([new("a", "Кофе", 900), new("a", "Кофе", -800), new("a", "Книги", 200)])["a"]);

    [Fact(DisplayName = "Всё вернул — клиента нет в результате")]
    public void AllRefunded() => Assert.False(Kata.TopCategory([new("a", "Кофе", 100), new("a", "Кофе", -100)]).ContainsKey("a"));

    [Fact(DisplayName = "Нет продаж — пустой результат")]
    public void Empty() => Assert.Empty(Kata.TopCategory([]));
}
