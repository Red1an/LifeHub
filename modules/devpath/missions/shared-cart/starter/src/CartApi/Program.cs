using CartApi;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<CurrentUser>();
builder.Services.AddSingleton<CartService>();
builder.Services.AddSingleton<ICartStore, InMemoryCartStore>();

var app = builder.Build();

// Кто делает запрос — из заголовка X-User (в настоящем приложении — из токена входа).
app.Use(async (ctx, next) =>
{
    ctx.RequestServices.GetRequiredService<CurrentUser>().Id = ctx.Request.Headers["X-User"].ToString();
    await next();
});

app.MapPost("/cart/{sku}", async (string sku, CartService cart) => Results.Ok(await cart.AddAsync(sku)));
app.MapGet("/cart", async (CartService cart) => Results.Ok(await cart.GetAsync()));

app.Run();

public partial class Program;
