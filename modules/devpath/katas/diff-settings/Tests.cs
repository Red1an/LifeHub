using Xunit;

public class DiffSettingsTests
{
    static Dictionary<string, string> D(params (string K, string V)[] items) => items.ToDictionary(x => x.K, x => x.V);

    [Fact(DisplayName = "Добавлено, удалено, изменено")]
    public void Basic()
    {
        var d = Kata.Compare(D(("a", "1"), ("b", "2"), ("c", "3")), D(("b", "2"), ("c", "30"), ("d", "4")));
        Assert.Equal(["d"], d.Added);
        Assert.Equal(["a"], d.Removed);
        Assert.Equal(["c"], d.Changed);
    }

    [Fact(DisplayName = "Регистр ключа не важен, написание — из новой версии")]
    public void CaseInsensitiveKeys()
    {
        var d = Kata.Compare(D(("Timeout", "30")), D(("timeout", "60")));
        Assert.Empty(d.Added);
        Assert.Empty(d.Removed);
        Assert.Equal(["timeout"], d.Changed);
    }

    [Fact(DisplayName = "Значения сравниваются точно")]
    public void ValuesExact() => Assert.Equal(["mode"], Kata.Compare(D(("mode", "Fast")), D(("mode", "fast"))).Changed);

    [Fact(DisplayName = "Списки отсортированы")]
    public void Sorted() => Assert.Equal(["a", "b", "c"], Kata.Compare(D(), D(("c", ""), ("a", ""), ("b", ""))).Added);

    [Fact(DisplayName = "Ничего не поменялось — всё пусто")]
    public void Same()
    {
        var d = Kata.Compare(D(("x", "1")), D(("x", "1")));
        Assert.Empty(d.Added);
        Assert.Empty(d.Removed);
        Assert.Empty(d.Changed);
    }
}
