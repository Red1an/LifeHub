using Mailing;

public class NewsletterTests
{
    sealed class FakeMailer : IMailer
    {
        public List<string> Sent { get; } = [];
        public void Send(string email, string subject) => Sent.Add(email);
    }

    /// <summary>Как настоящая база: каждый перебор — новый запрос.</summary>
    sealed class FakeRepo(params User[] users) : IUserRepository
    {
        public int Queries { get; private set; }

        public IEnumerable<User> All()
        {
            Queries++;
            foreach (var u in users)
                yield return u;
        }
    }

    static readonly User[] People =
    [
        new(1, "anna@mail.ru", true),
        new(2, "boris@mail.ru", false),
        new(3, "vera@mail.ru", true),
        new(4, "gosha@mail.ru", true),
    ];

    [Fact(DisplayName = "1. Каждому подписчику — ровно одно письмо")]
    public void OneEmailEach()
    {
        var mailer = new FakeMailer();
        var n = new Newsletter(mailer, new FakeRepo(People)).Send("Скидки");
        Assert.Equal(["anna@mail.ru", "vera@mail.ru", "gosha@mail.ru"], mailer.Sent);
        Assert.Equal(3, n);
    }

    [Fact(DisplayName = "2. Пользователи читаются из базы один раз")]
    public void SingleQuery()
    {
        var repo = new FakeRepo(People);
        new Newsletter(new FakeMailer(), repo).Send("Скидки");
        Assert.Equal(1, repo.Queries);
    }

    [Fact(DisplayName = "3. Нет подписчиков — 0 писем")]
    public void NoSubscribers()
    {
        var mailer = new FakeMailer();
        var n = new Newsletter(mailer, new FakeRepo(new User(1, "a@b.ru", false))).Send("Скидки");
        Assert.Empty(mailer.Sent);
        Assert.Equal(0, n);
    }

    [Fact(DisplayName = "4. Один адрес дважды (в разном регистре) — одно письмо")]
    public void DuplicateEmails()
    {
        var mailer = new FakeMailer();
        var n = new Newsletter(mailer, new FakeRepo(
            new User(1, "Anna@Mail.ru", true),
            new User(2, "anna@mail.ru", true),
            new User(3, " vera@mail.ru ", true),
            new User(4, "vera@mail.ru", true))).Send("Скидки");
        Assert.Equal(2, mailer.Sent.Count);
        Assert.Equal(2, n);
    }
}
