using Xunit;

public class ParseDurationTests
{
    [Theory(DisplayName = "Верные строки")]
    [InlineData("1h30m", 0, 1, 30, 0, 0)]
    [InlineData("45s", 0, 0, 0, 45, 0)]
    [InlineData("2h 5m 10s", 0, 2, 5, 10, 0)]
    [InlineData("1H 1S", 0, 1, 0, 1, 0)]
    [InlineData("500ms", 0, 0, 0, 0, 500)]
    [InlineData("1m 500ms", 0, 0, 1, 0, 500)]
    [InlineData(" 36h ", 1, 12, 0, 0, 0)]
    [InlineData("90m", 0, 1, 30, 0, 0)]
    public void Valid(string text, int d, int h, int m, int s, int ms)
    {
        Assert.True(Kata.TryParse(text, out var t), text);
        Assert.Equal(new TimeSpan(d, h, m, s, ms), t);
    }

    [Theory(DisplayName = "Неверные строки — false")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("10")]
    [InlineData("5x")]
    [InlineData("1m1h")]
    [InlineData("1h1h")]
    [InlineData("-5s")]
    [InlineData("h")]
    [InlineData("1.5h")]
    [InlineData("99999999999999999999h")]
    public void Invalid(string text) => Assert.False(Kata.TryParse(text, out _), text);
}
