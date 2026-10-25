using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

public class CartApiTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    HttpClient As(string user)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User", user);
        return client;
    }

    [Fact(DisplayName = "1. Добавленный товар виден в корзине")]
    public async Task AddAndGet()
    {
        var anna = As("anna-" + Guid.NewGuid());
        (await anna.PostAsync("/cart/coffee", null)).EnsureSuccessStatusCode();
        (await anna.PostAsync("/cart/tea", null)).EnsureSuccessStatusCode();
        Assert.Equal(["coffee", "tea"], await anna.GetFromJsonAsync<List<string>>("/cart"));
    }

    [Fact(DisplayName = "2. Корзина сохраняется между запросами")]
    public async Task Persists()
    {
        var id = "boris-" + Guid.NewGuid();
        (await As(id).PostAsync("/cart/milk", null)).EnsureSuccessStatusCode();
        Assert.Equal(["milk"], await As(id).GetFromJsonAsync<List<string>>("/cart"));
    }

    [Fact(DisplayName = "3. 20 покупателей одновременно — каждый видит только своё")]
    public async Task NoMixing()
    {
        var users = Enumerable.Range(1, 20).Select(i => $"user{i}-{Guid.NewGuid()}").ToArray();
        await Task.WhenAll(users.Select(async u =>
        {
            var client = As(u);
            for (var k = 0; k < 10; k++)
                (await client.PostAsync($"/cart/{u}-item{k}", null)).EnsureSuccessStatusCode();
        }));

        foreach (var u in users)
        {
            var items = await As(u).GetFromJsonAsync<List<string>>("/cart");
            Assert.Equal(Enumerable.Range(0, 10).Select(k => $"{u}-item{k}"), items);
        }
    }

    [Fact(DisplayName = "4. Без X-User — 401, корзина «пустого» пользователя не создаётся")]
    public async Task NoUser()
    {
        var anon = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync("/cart/coffee", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/cart")).StatusCode);
    }
}
