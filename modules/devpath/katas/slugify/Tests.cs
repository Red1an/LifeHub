using Xunit;

public class SlugifyTests
{
    [Fact(DisplayName = "Пример из условия")]
    public void Example() => Assert.Equal("privet-mir-c-10", Kata.Slugify("Привет, Мир! C# 10"));

    [Fact(DisplayName = "Многобуквенные замены")]
    public void Multi() => Assert.Equal("shchuka-i-zhuk-yuliya", Kata.Slugify("Щука и жук: Юлия"));

    [Fact(DisplayName = "Твёрдый и мягкий знак пропадают")]
    public void Signs() => Assert.Equal("obekt-sem", Kata.Slugify("Объект Семь"));

    [Fact(DisplayName = "Подряд идущие разделители — один дефис, по краям — ни одного")]
    public void Separators() => Assert.Equal("a-b", Kata.Slugify("  --a!!!  ...b?? "));

    [Fact(DisplayName = "Эмодзи и прочее — разделители")]
    public void Emoji() => Assert.Equal("kofe-v-zernakh", Kata.Slugify("☕ Кофе 🫘 в зёрнах"));

    [Fact(DisplayName = "Обрезка не оставляет дефис в конце")]
    public void Cut() => Assert.Equal("abc", Kata.Slugify("abc def", 4));

    [Fact(DisplayName = "Только знаки — пустая строка")]
    public void OnlySymbols() => Assert.Equal("", Kata.Slugify("!!! ???"));
}
