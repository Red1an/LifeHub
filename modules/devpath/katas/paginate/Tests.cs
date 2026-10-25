using Xunit;

public class PaginateTests
{
    [Fact(DisplayName = "Пример из условия")]
    public void Example()
    {
        var p = Kata.Paginate([1, 2, 3, 4, 5], 2, 2);
        Assert.Equal([3, 4], p.Items);
        Assert.Equal((2, 2, 5, 3, true), (p.Number, p.Size, p.TotalItems, p.TotalPages, p.HasNext));
    }

    [Fact(DisplayName = "Последняя неполная страница")]
    public void LastPage()
    {
        var p = Kata.Paginate([1, 2, 3, 4, 5], 3, 2);
        Assert.Equal([5], p.Items);
        Assert.False(p.HasNext);
    }

    [Fact(DisplayName = "Ровное деление — без лишней страницы")]
    public void Even() => Assert.Equal(2, Kata.Paginate([1, 2, 3, 4], 1, 2).TotalPages);

    [Fact(DisplayName = "Пустой список — 0 страниц")]
    public void Empty()
    {
        var p = Kata.Paginate(Array.Empty<string>(), 1, 10);
        Assert.Empty(p.Items);
        Assert.Equal(0, p.TotalPages);
        Assert.False(p.HasNext);
    }

    [Fact(DisplayName = "Страница за концом — пустая, не ошибка")]
    public void BeyondEnd()
    {
        var p = Kata.Paginate([1, 2, 3], 5, 2);
        Assert.Empty(p.Items);
        Assert.Equal(2, p.TotalPages);
    }

    [Theory(DisplayName = "Неверные параметры — ArgumentOutOfRangeException")]
    [InlineData(0, 10)]
    [InlineData(1, 0)]
    [InlineData(1, 101)]
    public void Bad(int page, int size) => Assert.Throws<ArgumentOutOfRangeException>(() => Kata.Paginate([1], page, size));
}
