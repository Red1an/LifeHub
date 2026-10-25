using Xunit;

public class CsvLineTests
{
    [Fact(DisplayName = "Пример из условия")]
    public void Example() => Assert.Equal(["2026-10-01", "Иванов, ИП", "1500.00"], Kata.Parse("2026-10-01,\"Иванов, ИП\",1500.00"));

    [Fact(DisplayName = "Кавычки внутри поля")]
    public void EscapedQuotes() => Assert.Equal(["ООО \"Ромашка\"", "1"], Kata.Parse("\"ООО \"\"Ромашка\"\"\",1"));

    [Fact(DisplayName = "Пустые поля, в том числе в конце")]
    public void EmptyFields() => Assert.Equal(["a", "", "b", ""], Kata.Parse("a,,b,"));

    [Fact(DisplayName = "Пустая строка — одно пустое поле")]
    public void EmptyLine() => Assert.Equal([""], Kata.Parse(""));

    [Fact(DisplayName = "Пробелы не обрезаются")]
    public void Spaces() => Assert.Equal([" a ", "b"], Kata.Parse(" a ,b"));

    [Fact(DisplayName = "Пустое поле в кавычках")]
    public void EmptyQuoted() => Assert.Equal(["", "x"], Kata.Parse("\"\",x"));

    [Fact(DisplayName = "Незакрытая кавычка — FormatException")]
    public void Unclosed() => Assert.Throws<FormatException>(() => Kata.Parse("a,\"b,c"));
}
