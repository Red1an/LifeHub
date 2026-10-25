var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/", () => "Биржа работает");

app.Run();

// Нужен тестам хаба: они запускают приложение в памяти через WebApplicationFactory<Program>.
public partial class Program;
