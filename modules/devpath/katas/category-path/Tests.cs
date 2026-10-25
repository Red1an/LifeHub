using System.Diagnostics;
using Xunit;

public class CategoryPathTests
{
    [Fact(DisplayName = "Пути строятся от корня")]
    public void Basic()
    {
        var p = Kata.Paths([new(3, 2, "Смартфоны"), new(1, null, "Электроника"), new(2, 1, "Телефоны"), new(4, null, "Книги")]);
        Assert.Equal("Электроника > Телефоны > Смартфоны", p[3]);
        Assert.Equal("Электроника > Телефоны", p[2]);
        Assert.Equal("Книги", p[4]);
        Assert.Equal(4, p.Count);
    }

    [Fact(DisplayName = "Несуществующий родитель — InvalidOperationException")]
    public void MissingParent() => Assert.Throws<InvalidOperationException>(() => Kata.Paths([new(1, 99, "Сирота")]));

    [Fact(DisplayName = "Цикл — InvalidOperationException")]
    public void Cycle() => Assert.Throws<InvalidOperationException>(() => Kata.Paths([new(1, 2, "A"), new(2, 3, "B"), new(3, 1, "C")]));

    [Fact(DisplayName = "Категория — сама себе родитель — тоже цикл")]
    public void SelfCycle() => Assert.Throws<InvalidOperationException>(() => Kata.Paths([new(1, 1, "A")]));

    [Fact(DisplayName = "50 000 категорий глубиной 20 — быстрее 300 мс")]
    public void Fast()
    {
        var list = new List<Category>();
        for (var i = 1; i <= 50_000; i++)
            list.Add(new Category(i, i % 20 == 1 ? null : i - 1, $"К{i}"));
        list.Reverse();
        Kata.Paths([new(1, null, "x")]);
        var sw = Stopwatch.StartNew();
        var p = Kata.Paths(list);
        Assert.True(sw.ElapsedMilliseconds < 300, $"Заняло {sw.ElapsedMilliseconds} мс");
        Assert.Equal(20, p[20].Split(" > ").Length);
    }
}
