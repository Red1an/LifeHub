using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Playwright;

/*
 * Проверка терминала (папка web/) настоящим браузером.
 * Фронтенд собирает хаб перед тестами: `npm run build` с VITE_API_URL = http://127.0.0.1:15080.
 * Тест поднимает API на этом порту (Kestrel), раздаёт web/dist на 15090 и открывает его в Edge через Playwright.
 */
public static class Web
{
    public const int ApiPort = 15080;
    public const int SitePort = 15090;
    public static string ApiUrl => $"http://127.0.0.1:{ApiPort}";
    public static string SiteUrl => $"http://127.0.0.1:{SitePort}";

    /// <summary>
    /// Токен администратора, если в API есть вход (этап 7+). Терминал тестов прошлых этапов получает его заранее
    /// в localStorage["exchange.auth"], чтобы старые сценарии работали и после появления входа.
    /// </summary>
    public static string? AdminToken { get; set; }

    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static WebApplication? _site;
    private static IPlaywright? _playwright;
    private static IBrowser? _browser;

    /// <summary>Корень проекта (там, где Exchange.slnx).</summary>
    public static string Root
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Exchange.slnx"))) dir = dir.Parent;
            return dir?.FullName ?? throw new InvalidOperationException("Не нашёл Exchange.slnx выше папки тестов");
        }
    }

    /// <summary>Раздача собранного фронтенда (общая на все тесты) и браузер.</summary>
    public static async Task<IBrowser> Start()
    {
        await Gate.WaitAsync();
        try
        {
            var dist = Path.Combine(Root, "web", "dist");
            if (!File.Exists(Path.Combine(dist, "index.html")))
                throw new Xunit.Sdk.XunitException("Нет web/dist/index.html: создай терминал в папке web (Vite + React) — хаб соберёт его сам командой npm run build.");
            if (_site is null)
            {
                var b = WebApplication.CreateBuilder();
                b.WebHost.UseUrls(SiteUrl);
                b.Logging.ClearProviders();
                var site = b.Build();
                var files = new PhysicalFileProvider(dist);
                site.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
                site.UseStaticFiles(new StaticFileOptions { FileProvider = files });
                // Одностраничное приложение: любые пути — index.html, маршрутизацию делает React.
                site.MapFallback(async ctx =>
                {
                    ctx.Response.ContentType = "text/html; charset=utf-8";
                    await ctx.Response.SendFileAsync(Path.Combine(dist, "index.html"));
                });
                await site.StartAsync();
                _site = site;
            }
            _playwright ??= await Playwright.CreateAsync();
            // Браузер — установленный в системе Edge: скачивать ничего не нужно.
            _browser ??= await _playwright.Chromium.LaunchAsync(new() { Channel = "msedge", Headless = true });
            return _browser;
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>API биржи на настоящем порту (браузеру нужен HTTP, а не сервер в памяти).</summary>
    public static ExchangeApp Api(ExchangeApp app)
    {
        app.UseKestrel(ApiPort);
        app.StartServer();
        return app;
    }

    /// <summary>Новая вкладка с открытым терминалом. Ошибки JS собираются в errors. signedIn — войти администратором заранее.</summary>
    public static async Task<(IBrowserContext Context, IPage Page, List<string> Errors)> Open(string path, bool signedIn = true)
    {
        var browser = await Start();
        var context = await browser.NewContextAsync(new() { Locale = "ru-RU" });
        if (signedIn && AdminToken is not null)
            await context.AddInitScriptAsync($"if (!localStorage.getItem('exchange.auth')) localStorage.setItem('exchange.auth', JSON.stringify({{ accessToken: '{AdminToken}' }}))");
        var page = await context.NewPageAsync();
        var errors = new List<string>();
        page.PageError += (_, e) => errors.Add(e);
        page.SetDefaultTimeout(8000);
        await page.GotoAsync(SiteUrl + path);
        return (context, page, errors);
    }

    /// <summary>Число из data-value (без зависимости от форматирования на экране).</summary>
    public static async Task<decimal?> Value(this ILocator l)
    {
        var v = await l.GetAttributeAsync("data-value");
        return string.IsNullOrEmpty(v) ? null : decimal.Parse(v, System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Уровни стакана: [data-testid=bids|asks] [data-testid=level] с data-price и data-qty.</summary>
    public static async Task<List<(decimal Price, int Qty)>> Levels(this IPage page, string side)
    {
        var rows = page.GetByTestId(side).GetByTestId("level");
        var list = new List<(decimal, int)>();
        for (var i = 0; i < await rows.CountAsync(); i++)
        {
            var row = rows.Nth(i);
            list.Add((decimal.Parse((await row.GetAttributeAsync("data-price"))!, System.Globalization.CultureInfo.InvariantCulture),
                int.Parse((await row.GetAttributeAsync("data-qty"))!)));
        }
        return list;
    }

    /// <summary>Ждать, пока условие не станет верным (UI обновляется асинхронно).</summary>
    public static async Task Eventually(Func<Task<bool>> check, string what, int ms = 5000)
    {
        var until = DateTime.UtcNow.AddMilliseconds(ms);
        while (true)
        {
            try
            {
                if (await check()) return;
            }
            catch (PlaywrightException) { }
            if (DateTime.UtcNow > until) throw new Xunit.Sdk.XunitException($"За {ms} мс не дождался: {what}");
            await Task.Delay(100);
        }
    }

    /// <summary>Запросы страницы к API (fetch/XHR) — чтобы проверить, что терминал не опрашивает сервер.</summary>
    public static List<string> TrackApiCalls(IPage page)
    {
        var calls = new List<string>();
        page.Request += (_, r) =>
        {
            if (r.Url.StartsWith(ApiUrl) && r.ResourceType is "fetch" or "xhr" && r.Method != "OPTIONS")
                lock (calls) calls.Add($"{r.Method} {Regex.Replace(r.Url, "^https?://[^/]+", "")}");
        };
        return calls;
    }
}
