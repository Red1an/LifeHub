using Xunit;

public class MergeSlotsTests
{
    [Fact(DisplayName = "Пример из условия")]
    public void Example() => Assert.Equal([(60, 150), (200, 230)], Kata.Merge([(90, 150), (60, 120), (200, 230)]));

    [Fact(DisplayName = "Встречи встык склеиваются")]
    public void Touching() => Assert.Equal([(60, 180)], Kata.Merge([(60, 120), (120, 180)]));

    [Fact(DisplayName = "Вложенная бронь не обрезает внешнюю")]
    public void Nested() => Assert.Equal([(60, 300)], Kata.Merge([(60, 300), (90, 120)]));

    [Fact(DisplayName = "Цепочка склеивается целиком")]
    public void Chain() => Assert.Equal([(0, 50)], Kata.Merge([(30, 50), (0, 10), (5, 35)]));

    [Fact(DisplayName = "Без пересечений — как есть, по порядку")]
    public void Disjoint() => Assert.Equal([(1, 2), (3, 4), (5, 6)], Kata.Merge([(5, 6), (1, 2), (3, 4)]));

    [Fact(DisplayName = "Пусто — пусто")]
    public void Empty() => Assert.Empty(Kata.Merge([]));

    [Fact(DisplayName = "Конец раньше начала — ArgumentException")]
    public void Bad() => Assert.Throws<ArgumentException>(() => Kata.Merge([(10, 10)]));
}
