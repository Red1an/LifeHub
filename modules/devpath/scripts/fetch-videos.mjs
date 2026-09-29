/*
 * Подбор видео к темам: node scripts/fetch-videos.mjs [id темы…]
 * Ищет на YouTube по запросам из QUERIES (рус. и англ.), ранжирует по просмотрам,
 * длительности, позиции в выдаче и проверенным каналам, проверяет, что видео можно встроить,
 * и пишет src/data/videos.ts. Без аргументов обновляет все темы, с аргументами — только указанные.
 * Ручные правки: PINNED (всегда первые) и BANNED (никогда).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, "src", "data", "videos.ts");

/** id темы → [запрос на русском, запрос на английском] */
const QUERIES = {
  "csharp-types": ["C# value type reference type boxing", "C# value types vs reference types boxing"],
  "csharp-oop": ["C# ООП наследование интерфейсы полиморфизм", "C# OOP inheritance interfaces polymorphism"],
  "csharp-exceptions": ["C# исключения обработка ошибок try catch", "C# exceptions best practices"],
  "csharp-generics": ["C# generics обобщения ковариантность", "C# generics covariance contravariance"],
  "csharp-delegates": ["C# делегаты события лямбды замыкания", "C# delegates events closures"],
  "csharp-linq": ["C# LINQ как работает yield IQueryable", "C# LINQ deferred execution IEnumerable IQueryable"],
  "csharp-collections": ["C# коллекции Dictionary List как устроены", "C# Dictionary HashSet internals performance"],
  "csharp-strings": ["C# строки StringBuilder интернирование", "C# strings StringBuilder performance"],
  "csharp-memory": ["сборщик мусора .NET GC поколения", ".NET garbage collector explained"],
  "csharp-span": ["Span C# производительность без аллокаций", "C# Span<T> Memory<T> performance"],
  "csharp-async": ["async await C# как работает изнутри", "C# async await explained state machine"],
  "csharp-threading": ["C# многопоточность lock SemaphoreSlim Interlocked", "C# multithreading synchronization lock"],
  "csharp-reflection": ["C# рефлексия source generators", "C# source generators tutorial"],
  "csharp-modern": ["новое в C# 12 13", "new features C# 13"],
  "csharp-runtime": [".NET JIT IL tiered compilation", ".NET JIT tiered compilation PGO"],
  "csharp-benchmark": ["BenchmarkDotNet бенчмарки .NET", "BenchmarkDotNet tutorial"],
  "dotnet-host": ["ASP.NET Core конфигурация IOptions логирование", "ASP.NET Core options pattern configuration"],
  "dotnet-di": ["ASP.NET Core внедрение зависимостей Scoped Singleton Transient", "ASP.NET Core dependency injection lifetimes"],
  "dotnet-middleware": ["ASP.NET Core middleware конвейер", "ASP.NET Core middleware pipeline"],
  "dotnet-api": ["ASP.NET Core Web API minimal API", "ASP.NET Core minimal APIs tutorial"],
  "dotnet-mediatr": ["MediatR C# паттерн медиатор CQRS", "MediatR CQRS pipeline behavior"],
  "dotnet-auth": ["ASP.NET Core JWT аутентификация авторизация", "ASP.NET Core authentication JWT OAuth"],
  "dotnet-grpc": ["gRPC ASP.NET Core", "gRPC .NET tutorial"],
  "dotnet-background": ["BackgroundService ASP.NET Core фоновые задачи", "ASP.NET Core BackgroundService hosted service"],
  "dotnet-testing": ["юнит тесты C# xUnit интеграционные тесты", "ASP.NET Core integration testing WebApplicationFactory"],
  "dotnet-resilience": ["Polly HttpClientFactory ретраи", ".NET resilience Polly retry circuit breaker"],
  "dotnet-caching": ["кэширование ASP.NET Core Redis", "ASP.NET Core caching HybridCache Redis"],
  "dotnet-observability": ["OpenTelemetry .NET трассировка", "OpenTelemetry .NET tracing metrics"],
  "dotnet-aspire": [".NET Aspire", ".NET Aspire tutorial"],
  "dotnet-performance": ["производительность ASP.NET Core оптимизация", "ASP.NET Core performance optimization"],
  "dotnet-deploy": ["деплой ASP.NET Core Linux Docker", "deploy ASP.NET Core Linux Docker"],
  "data-sql": ["SQL оконные функции CTE", "SQL window functions CTE tutorial"],
  "data-indexes": ["индексы в базе данных B-tree explain", "database indexing explained B-tree"],
  "data-transactions": ["уровни изоляции транзакций MVCC", "transaction isolation levels explained"],
  "data-postgres": ["PostgreSQL MVCC vacuum JSONB", "PostgreSQL internals MVCC vacuum"],
  "data-modeling": ["нормализация базы данных нормальные формы", "database normalization explained"],
  "data-efcore": ["Entity Framework Core N+1 AsNoTracking", "EF Core performance tips"],
  "data-efcore-adv": ["EF Core продвинутый ExecuteUpdate compiled queries", "EF Core advanced features"],
  "data-nosql": ["NoSQL MongoDB Cassandra когда использовать", "SQL vs NoSQL explained"],
  "data-redis": ["Redis структуры данных устройство", "Redis explained data structures"],
  "data-scaling": ["шардирование репликация базы данных", "database sharding replication explained"],
  "data-search": ["Elasticsearch как работает инвертированный индекс", "Elasticsearch inverted index explained"],
  "arch-solid": ["SOLID принципы C#", "SOLID principles C#"],
  "arch-patterns": ["паттерны проектирования", "design patterns C#"],
  "arch-refactoring": ["рефакторинг чистый код", "refactoring code smells"],
  "arch-layers": ["чистая архитектура Clean Architecture .NET", "Clean Architecture .NET"],
  "arch-ddd": ["DDD предметно-ориентированное проектирование агрегат", "Domain-Driven Design aggregates explained"],
  "arch-testing": ["тестируемая архитектура моки стабы", "unit testing best practices mocks"],
  "arch-cqrs": ["CQRS Event Sourcing", "CQRS event sourcing explained"],
  "arch-monolith": ["модульный монолит или микросервисы", "modular monolith vs microservices"],
  "arch-microservices": ["паттерны микросервисов saga outbox", "microservices patterns saga outbox"],
  "arch-api": ["проектирование REST API версионирование", "REST API design best practices"],
  "arch-quality": ["работа архитектора ADR C4 модель", "software architecture C4 model ADR"],
  "arch-integration": ["интеграция систем паттерны очереди вебхуки", "enterprise integration patterns"],
  "distributed-basics": ["распределённые системы введение", "distributed systems explained fallacies"],
  "distributed-time": ["логические часы Лэмпорта векторные часы", "Lamport clocks vector clocks"],
  "distributed-cap": ["CAP теорема согласованность", "CAP theorem consistency models"],
  "distributed-replication": ["репликация данных лидер кворум", "database replication leader leaderless quorum"],
  "distributed-partitioning": ["консистентное хеширование", "consistent hashing explained"],
  "distributed-consensus": ["алгоритм Raft консенсус", "Raft consensus algorithm"],
  "distributed-idempotency": ["идемпотентность API повторные запросы", "idempotency API design"],
  "distributed-transactions": ["распределённые транзакции 2PC сага", "distributed transactions two phase commit saga"],
  "distributed-messaging": ["Kafka RabbitMQ отличия", "Kafka vs RabbitMQ"],
  "distributed-streaming": ["потоковая обработка данных Kafka Streams Flink", "stream processing explained"],
  "distributed-resilience": ["circuit breaker rate limiting отказоустойчивость", "circuit breaker pattern resilience"],
  "distributed-orleans": ["Microsoft Orleans акторы", "Microsoft Orleans actors"],
  "devops-linux": ["Linux для разработчика команды", "Linux command line for developers"],
  "devops-bash": ["bash скрипты основы", "bash scripting tutorial"],
  "devops-git": ["git rebase merge продвинутый", "advanced git rebase"],
  "devops-docker": ["Docker с нуля", "Docker tutorial"],
  "devops-cicd": ["CI/CD GitHub Actions", "GitHub Actions CI/CD tutorial"],
  "devops-k8s": ["Kubernetes с нуля", "Kubernetes tutorial"],
  "devops-networking": ["сети Kubernetes Service Ingress", "Kubernetes networking services ingress"],
  "devops-k8s-adv": ["Kubernetes Helm операторы", "Kubernetes Helm tutorial"],
  "devops-iac": ["Terraform с нуля", "Terraform tutorial"],
  "devops-cloud": ["облачные технологии AWS основы", "cloud computing AWS basics"],
  "devops-observability": ["Prometheus Grafana мониторинг", "Prometheus Grafana monitoring tutorial"],
  "devops-sre": ["SRE инженер по надежности SLO SLA", "SRE SLO SLI error budget"],
  "devops-security": ["DevSecOps безопасность CI/CD", "DevSecOps explained"],
  "devops-nginx": ["Nginx reverse proxy балансировка", "Nginx reverse proxy load balancing"],
  "cs-complexity": ["сложность алгоритмов O большое", "Big O notation"],
  "cs-arrays": ["два указателя скользящее окно задачи", "two pointers sliding window"],
  "cs-structures": ["структуры данных стек очередь куча", "data structures heap stack queue"],
  "cs-trees": ["графы BFS DFS алгоритмы", "graph algorithms BFS DFS"],
  "cs-dp": ["динамическое программирование", "dynamic programming"],
  "cs-search": ["бинарный поиск", "binary search"],
  "cs-os": ["операционные системы процессы потоки память", "operating system concepts processes threads explained"],
  "cs-hardware": ["кэш процессора производительность программиста", "CPU cache performance programmers"],
  "cs-patterns": ["алгоритмические задачи собеседование паттерны", "coding interview patterns"],
  "net-tcpip": ["TCP IP как работает протокол", "TCP IP explained"],
  "net-http": ["HTTP/2 HTTP/3 QUIC", "HTTP/1 vs HTTP/2 vs HTTP/3"],
  "net-dns-tls": ["как работает HTTPS TLS рукопожатие", "how HTTPS TLS works"],
  "net-owasp": ["OWASP Top 10 уязвимости веб", "OWASP Top 10 web application vulnerabilities explained"],
  "net-api-security": ["безопасность REST API авторизация токены", "API security best practices"],
  "net-crypto": ["криптография для программистов шифрование", "symmetric vs asymmetric encryption explained"],
  "net-loadbalancing": ["балансировка нагрузки CDN", "load balancing explained"],
  "ai-math": ["математика для машинного обучения", "math for machine learning"],
  "ai-python": ["Python для машинного обучения NumPy pandas", "NumPy pandas tutorial"],
  "ai-ml": ["машинное обучение введение", "machine learning explained"],
  "ai-nn": ["нейронные сети с нуля обратное распространение", "neural networks backpropagation"],
  "ai-arch": ["трансформеры attention как работает", "transformers attention explained"],
  "ai-llm": ["как работают большие языковые модели LLM", "how large language models work"],
  "ai-prompting": ["промпт инжиниринг", "prompt engineering guide"],
  "ai-embeddings": ["эмбеддинги векторные базы данных", "embeddings vector database explained"],
  "ai-rag": ["RAG нейросеть поиск по документам LLM", "RAG explained"],
  "ai-agents": ["AI агенты function calling MCP", "AI agents tool use MCP"],
  "ai-dotnet": ["нейросети в C# .NET ИИ", "Microsoft.Extensions.AI Semantic Kernel .NET"],
  "ai-evals": ["оценка LLM evals", "LLM evals evaluation"],
  "ai-mlops": ["MLOps", "MLOps explained"],
  "sec-mindset": ["моделирование угроз STRIDE безопасность приложений", "threat modeling STRIDE explained"],
  "sec-injection": ["SQL инъекция как защититься", "injection attacks explained SQL command injection"],
  "sec-xss": ["XSS атака Content Security Policy", "XSS cross site scripting explained CSP"],
  "sec-authn": ["двухфакторная аутентификация passkeys как работает", "passkeys WebAuthn explained"],
  "sec-authz": ["авторизация RBAC ABAC контроль доступа", "RBAC vs ABAC authorization explained"],
  "sec-secrets": ["хранение секретов HashiCorp Vault", "secrets management HashiCorp Vault explained"],
  "sec-data": ["шифрование данных персональные данные защита", "data encryption at rest in transit explained"],
  "sec-files": ["SSRF уязвимость", "SSRF server side request forgery explained"],
  "sec-supply": ["атака на цепочку поставок программного обеспечения", "software supply chain attacks explained"],
  "sec-logging": ["мониторинг безопасности SIEM реагирование на инциденты", "security logging and monitoring incident response"],
  "sec-aspnet": ["безопасность ASP.NET Core", "ASP.NET Core security best practices"],
  "sec-pentest": ["пентест с нуля Burp Suite", "Burp Suite tutorial web application pentesting"],
  "aidev-landscape": ["Claude Code Cursor ИИ агенты для программирования", "AI coding agents Claude Code Cursor comparison"],
  "aidev-tasking": ["как писать промпты для программирования с ИИ", "how to prompt AI coding assistants effectively"],
  "aidev-context": ["CLAUDE.md контекст Claude Code", "context engineering AI coding agents"],
  "aidev-agentic": ["Claude Code агентное программирование", "Claude Code agentic coding workflow"],
  "aidev-verify": ["TDD с нейросетью ИИ тесты", "test driven development with AI coding agents"],
  "aidev-spec": ["spec driven development ИИ", "spec driven development GitHub Spec Kit"],
  "aidev-architecture": ["архитектура программного обеспечения с помощью ИИ", "software architecture with AI LLM"],
  "aidev-review": ["код ревью кода от нейросети ошибки", "reviewing AI generated code"],
  "aidev-mcp": ["MCP Model Context Protocol что это", "Model Context Protocol MCP explained"],
  "aidev-security": ["безопасность ИИ агентов prompt injection", "AI coding agents security prompt injection"],
  "aidev-legacy": ["рефакторинг легаси кода с ИИ", "refactoring legacy code with AI"],
  "aidev-growth": ["программист и ИИ будущее профессии навыки", "software engineers AI future skills"],
  "sysdesign-method": ["system design интервью как проходить", "system design interview framework"],
  "sysdesign-shortener": ["system design сокращатель ссылок", "system design URL shortener"],
  "sysdesign-ratelimiter": ["system design rate limiter", "system design rate limiter"],
  "sysdesign-chat": ["system design мессенджер чат", "system design chat application"],
  "sysdesign-feed": ["system design лента новостей", "system design news feed"],
  "sysdesign-notifications": ["system design сервис уведомлений", "system design notification system"],
  "sysdesign-booking": ["проектирование системы бронирования highload", "system design ticket booking"],
  "sysdesign-payments": ["system design платежная система", "system design payment system"],
  "sysdesign-storage": ["system design Dropbox хранилище файлов", "system design Dropbox Google Drive"],
  "sysdesign-search": ["system design автодополнение поиск", "system design typeahead autocomplete"],
  "onec-platform": ["1С программирование с нуля объекты конфигурации", "1C Enterprise development"],
  "onec-language": ["1С встроенный язык программирования основы", "1C:Enterprise programming language"],
  "onec-queries": ["язык запросов 1С", "1C query language"],
  "onec-registers": ["регистры накопления 1С проведение", "1C accumulation registers"],
  "onec-bsp": ["1С БСП расширения конфигурации", "1C extensions configuration"],
  "onec-forms": ["управляемые формы 1С", "1C managed forms"],
  "onec-integration": ["1С HTTP сервисы интеграция", "1C HTTP services REST integration"],
  "onec-performance": ["1С производительность блокировки технологический журнал", "1C performance optimization"],
  "craft-learning": ["интервальное повторение метод Фейнмана как эффективно учиться", "how to learn programming effectively spaced repetition"],
  "craft-review": ["код ревью как делать", "code review best practices"],
  "craft-debugging": ["отладка .NET dotnet-dump", "debugging .NET memory dump"],
  "craft-estimation": ["оценка задач в разработке", "software estimation"],
  "craft-docs": ["design doc как писать техническую документацию", "how to write a design doc"],
  "craft-leadership": ["техлид staff engineer", "staff engineer tech lead"],
  "craft-career": ["собеседование C# разработчика", "software engineer career growth senior"],
};

/** Каналы, которым доверяем: небольшой бонус в ранжировании. */
const TRUSTED = [
  "Nick Chapsas", "Milan Jovanović", "IAmTimCorey", "Raw Coding", "Zoran Horvat", "dotnet", "NDC Conferences",
  "Hussein Nasser", "ByteByteGo", "TechWorld with Nana", "3Blue1Brown", "Andrej Karpathy", "Fireship",
  "Computerphile", "Martin Kleppmann", "CodeOpinion", "Amichai Mantinband", "Gavin Lon", "Hello Interview",
  "NeetCode", "Abdul Bari", "freeCodeCamp.org", "IBM Technology", "Microsoft Developer", "Stephen Cleary",
  "DotNext", "DotNetRu", "JUG Ru Group", "HighLoad Channel", "Кирилл Сачков", "Kirill Sachkov Development",
  "ITVDN", "Мерион", "Senior Software Vlogger", "Андрей Акиньшин", "Sergey Nemchinskiy", "Selectel",
  "Слёрм", "Southbridge", "Yandex for Developers", "Яндекс для разработчиков", "Тинькофф", "Т-Банк",
  "Сбер", "Avito Tech", "Ozon Tech", "Бодрый кодер", "#SimpleCode", "XpucT", "Андрей Созыкин",
  "selfedu", "Тимофей Хирьянов", "Дмитрий Бахтенков", "Chris Sainty", "Jeff Delaney", "Arpit Bhayani",
];
const BANNED_WORDS = /unity|godot|roblox|minecraft|#shorts|javascript|react|php|golang|java\b|kotlin|swift/i;
/** Англоязычные каналы: их ролики с автопереводом названия не считаем русскими. */
const EN_CHANNELS = [
  "Nick Chapsas", "Milan Jovanović", "IAmTimCorey", "Raw Coding", "Zoran Horvat", "dotnet", "NDC Conferences", "Hussein Nasser",
  "ByteByteGo", "TechWorld with Nana", "3Blue1Brown", "Andrej Karpathy", "Fireship", "Computerphile", "Martin Kleppmann",
  "CodeOpinion", "Amichai Mantinband", "Hello Interview", "NeetCode", "Abdul Bari", "freeCodeCamp", "IBM Technology",
  "Gaurav Sen", "codebasics", "ankush", "Arpit Bhayani", "Alex Hyett", "Reducible", "Diego Ongaro",
];
const PINNED = {};
// Нерелевантные ролики, которые поиск ставит высоко.
const BANNED = new Set(["XXDiW6m8Go0", "yFvl2x8_9gI", "aToq1UEKSuM", "8Slzd1G7f9Q"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseViews = (s = "") => Number(s.replace(/[^\d]/g, "")) || 0;
const parseLen = (s = "") => s.split(":").reduce((n, x) => n * 60 + Number(x), 0);

/** fetch с повторами: YouTube иногда обрывает соединение. */
async function get(url, init) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

async function search(q, lang) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=${lang}`;
  const html = await (await get(url, { headers: { "user-agent": "Mozilla/5.0", "accept-language": lang === "ru" ? "ru-RU,ru" : "en-US,en" } })).text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      out.push({
        id: v.videoId,
        t: v.title?.runs?.map((r) => r.text).join("") ?? "",
        c: v.ownerText?.runs?.[0]?.text ?? "",
        views: parseViews(v.viewCountText?.simpleText),
        len: parseLen(v.lengthText?.simpleText),
        d: v.lengthText?.simpleText ?? "",
      });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

async function embeddable(id) {
  const r = await get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
  return r.ok;
}

function rank(list, lang, exclude = new Set()) {
  const cyr = /[а-яё]/i;
  return list
    .map((v, pos) => ({ ...v, pos }))
    .filter((v) => v.id && !BANNED.has(v.id) && v.len >= 240 && v.len <= 4 * 3600 && !BANNED_WORDS.test(v.t))
    .filter((v) => (lang === "ru" ? cyr.test(v.t) && !EN_CHANNELS.some((c) => v.c.toLowerCase().includes(c.toLowerCase())) : !cyr.test(v.t)))
    .filter((v) => !exclude.has(v.id))
    // Совсем малоизвестные ролики не берём.
    .filter((v) => v.views >= (lang === "ru" ? 1500 : 5000))
    .map((v) => {
      const trusted = TRUSTED.some((c) => v.c.toLowerCase().includes(c.toLowerCase()));
      const score = Math.log10(v.views + 10) * (1 - v.pos * 0.04) + (trusted ? 1.5 : 0);
      return { ...v, score };
    })
    .sort((a, b) => b.score - a.score);
}

async function pick(q, lang, exclude) {
  const ranked = rank(await search(q, lang), lang, exclude);
  const res = [];
  for (const v of ranked) {
    if (res.length >= 3) break;
    if (await embeddable(v.id)) res.push({ id: v.id, t: v.t, c: v.c, d: v.d, v: v.views });
  }
  return res;
}

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8").replace(/^[\s\S]*?= /, "").replace(/;\s*$/, "")) : {};
const header = `/* Сгенерировано scripts/fetch-videos.mjs — видео к темам (YouTube). v — просмотры на момент подбора. */
export interface Video { id: string; t: string; c: string; d: string; v: number }
export const VIDEOS: Record<string, { ru: Video[]; en: Video[] }> = `;
/** Сохраняем после каждой темы, чтобы прерванный запуск не терял результат. */
const save = () => fs.writeFileSync(OUT, header + JSON.stringify(existing, null, 1) + ";\n");

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(QUERIES);
for (const id of ids) {
  const [ru, en] = QUERIES[id] ?? [];
  if (!ru) {
    console.warn("нет запроса для", id);
    continue;
  }
  try {
    // Сначала английские, затем русские без повторов (автоперевод названий даёт те же ролики).
    const e = await pick(en, "en");
    await sleep(1500);
    const r = await pick(ru, "ru", new Set(e.map((x) => x.id)));
    await sleep(1500);
    existing[id] = { ru: [...(PINNED[id]?.ru ?? []), ...r], en: [...(PINNED[id]?.en ?? []), ...e] };
    save();
    console.log(id, r.length, e.length);
  } catch (err) {
    console.warn(id, "ошибка", err.message);
  }
}

save();
console.log("готово:", Object.keys(existing).length, "тем");
