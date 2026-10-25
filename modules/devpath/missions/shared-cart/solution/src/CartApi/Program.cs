using CartApi;

var builder = WebApplication.CreateBuilder(args);

// Данные конкретного запроса — Scoped: свой экземпляр на каждый запрос.
builder.Services.AddScoped<CurrentUser>();
// Сервис зависит от Scoped, значит, сам не может жить дольше запроса.
builder.Services.AddScoped<CartService>();
// Хранилище общее для всех — Singleton (оно потокобезопасное).
builder.Services.AddSingleton<ICartStore, InMemoryCartStore>();

var app = builder.Build();

app.Use(async (ctx, next) =>
{
    var id = ctx.Request.Headers["X-User"].ToString();
    if (string.IsNullOrWhiteSpace(id))
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    ctx.RequestServices.GetRequiredService<CurrentUser>().Id = id;
    await next();
});

app.MapPost("/cart/{sku}", async (string sku, CartService cart) => Results.Ok(await cart.AddAsync(sku)));
app.MapGet("/cart", async (CartService cart) => Results.Ok(await cart.GetAsync()));

app.Run();

public partial class Program;
