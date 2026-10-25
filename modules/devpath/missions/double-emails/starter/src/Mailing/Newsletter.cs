namespace Mailing;

public record User(int Id, string Email, bool Subscribed);

public interface IMailer
{
    void Send(string email, string subject);
}

public interface IUserRepository
{
    /// <summary>Пользователи читаются из базы порциями по мере перебора (как IQueryable/DataReader).</summary>
    IEnumerable<User> All();
}

public class Newsletter(IMailer mailer, IUserRepository users)
{
    /// <summary>Разослать письмо подписчикам. Возвращает, сколько писем ушло.</summary>
    public int Send(string subject)
    {
        var sent = users.All()
            .Where(u => u.Subscribed)
            .Select(u =>
            {
                mailer.Send(u.Email, subject);
                return u.Email;
            });

        if (!sent.Any())
            return 0;

        return sent.Count();
    }
}
