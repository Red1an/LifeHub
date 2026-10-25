namespace Mailing;

public record User(int Id, string Email, bool Subscribed);

public interface IMailer
{
    void Send(string email, string subject);
}

public interface IUserRepository
{
    IEnumerable<User> All();
}

public class Newsletter(IMailer mailer, IUserRepository users)
{
    public int Send(string subject)
    {
        // Сначала один раз получаем список адресов (запрос к базе — один), потом отправляем.
        // Побочные эффекты (отправка) — в обычном цикле, а не внутри Select: LINQ ленивый.
        var recipients = users.All()
            .Where(u => u.Subscribed)
            .Select(u => u.Email.Trim().ToLowerInvariant())
            .Distinct()
            .ToList();

        foreach (var email in recipients)
            mailer.Send(email, subject);

        return recipients.Count;
    }
}
