using Xunit;

public class WordTopTests
{
    [Fact(DisplayName = "Пример из условия")]
    public void Example() => Assert.Equal([("кот", 2), ("и", 1)], Kata.Top("Кот и пёс. Кот!", 2));

    [Fact(DisplayName = "Пунктуация и лишние пробелы — разделители")]
    public void Punctuation() => Assert.Equal([("да", 3)], Kata.Top("да,да...   ДА!!!", 5));

    [Fact(DisplayName = "При равной частоте — по алфавиту")]
    public void TieBreak() => Assert.Equal([("a", 2), ("b", 2), ("c", 1)], Kata.Top("b a c b a", 3));

    [Fact(DisplayName = "Цифры — часть слова")]
    public void Digits() => Assert.Equal([("net10", 2)], Kata.Top("NET10 и net10", 1));

    [Fact(DisplayName = "Слов меньше n — сколько есть")]
    public void FewerWords() => Assert.Single(Kata.Top("одно", 10));

    [Fact(DisplayName = "Пустой текст — пустой список")]
    public void Empty() => Assert.Empty(Kata.Top("  ...  ", 3));

    [Fact(DisplayName = "n <= 0 — ArgumentOutOfRangeException")]
    public void BadN() => Assert.Throws<ArgumentOutOfRangeException>(() => Kata.Top("a", 0));
}
