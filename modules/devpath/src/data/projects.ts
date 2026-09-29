/*
 * Проекты: большие задания по этапам, как в Hyperskill/JetBrains Academy.
 * Каждый этап — законченный шаг с критериями готовности. id проекта менять нельзя: к нему привязан прогресс.
 */

export interface ProjectStage {
  title: string;
  md: string;
  check: string[];
  /** Темы, которые стоит знать для этапа. */
  topics?: string[];
}

export interface Project {
  id: string;
  title: string;
  icon: string;
  level: 1 | 2 | 3;
  tracks: string[];
  summary: string;
  stages: ProjectStage[];
}

export const PROJECTS: Project[] = [
  {
    id: "shortener",
    title: "Сокращатель ссылок",
    icon: "🔗",
    level: 1,
    tracks: ["dotnet", "data", "devops"],
    summary: "Первый законченный сервис: API, БД, кэш, контейнер, CI. Классика собеседований, которую ты сделаешь руками.",
    stages: [
      {
        title: "Minimal API и хранение в памяти",
        md: "Создай ASP.NET Core Minimal API: `POST /links` принимает длинный URL и возвращает короткий код, `GET /{code}` делает редирект (302). Пока храни в `ConcurrentDictionary`. Код — 7 символов base62.",
        check: ["POST возвращает 201 и короткую ссылку", "GET делает 302 на исходный URL, неизвестный код — 404", "Невалидный URL — 400 с ProblemDetails", "Есть хотя бы 3 теста через WebApplicationFactory"],
        topics: ["dotnet-api", "dotnet-testing"],
      },
      {
        title: "PostgreSQL + EF Core",
        md: "Перенеси хранение в PostgreSQL (EF Core + миграции). Уникальный индекс по коду. Подумай, как генерировать код без коллизий: счётчик + base62, случайный код с повтором или хэш.",
        check: ["Миграции применяются при старте или отдельной командой", "Уникальный индекс по коду", "Коллизия кода обрабатывается (повтор генерации)", "Интеграционный тест с Testcontainers"],
        topics: ["data-efcore", "data-indexes", "data-postgres"],
      },
      {
        title: "Кэш и статистика переходов",
        md: "Горячие ссылки отдавай из Redis (cache-aside, TTL). Считай переходы: не пиши в БД на каждый клик — копи в памяти/Redis и сбрасывай батчами фоновым сервисом.",
        check: ["Redis-кэш с TTL, промах идёт в БД", "Счётчик переходов обновляется батчами из BackgroundService", "GET /links/{code}/stats возвращает число переходов", "Замерил RPS до и после кэша (k6 или NBomber)"],
        topics: ["dotnet-caching", "data-redis", "dotnet-background"],
      },
      {
        title: "Docker и CI",
        md: "Multi-stage Dockerfile, `docker compose` с API, Postgres и Redis. GitHub Actions: сборка, тесты, публикация образа в GHCR.",
        check: ["Образ собирается multi-stage, запускается не от root", "docker compose up поднимает всё одной командой", "CI гоняет тесты на каждый PR", "Образ публикуется при пуше в main"],
        topics: ["devops-docker", "devops-cicd"],
      },
      {
        title: "Наблюдаемость и лимиты",
        md: "Добавь OpenTelemetry (трейсы и метрики), health checks, rate limiting на создание ссылок (например, 10 в минуту с IP).",
        check: ["/health/ready проверяет БД и Redis", "Трейсы видны в Aspire Dashboard или Jaeger", "Rate limiter отвечает 429", "README с архитектурной схемой"],
        topics: ["dotnet-observability", "dotnet-performance", "sysdesign-shortener"],
      },
    ],
  },
  {
    id: "task-tracker",
    title: "Трекер задач с чистой архитектурой",
    icon: "🗂️",
    level: 2,
    tracks: ["arch", "dotnet", "data"],
    summary: "Модульный монолит с DDD: агрегаты, доменные события, CQRS, авторизация. Проект, который не стыдно показать на собеседовании middle+.",
    stages: [
      {
        title: "Домен",
        md: "Спроектируй агрегаты `Project` и `Task` (статусы, исполнитель, дедлайн). Инварианты — внутри агрегата: нельзя закрыть задачу с незакрытыми подзадачами, нельзя назначить исполнителя не из проекта. Никакого EF в домене.",
        check: ["Агрегаты с приватными сеттерами и методами-поведением", "Value objects (TaskTitle, Deadline) с валидацией", "Юнит-тесты инвариантов без БД", "Доменные события (TaskCompleted)"],
        topics: ["arch-ddd", "arch-solid", "csharp-types"],
      },
      {
        title: "Слои и CQRS",
        md: "Раздели на Domain / Application / Infrastructure / Api (или vertical slices). Команды и запросы через MediatR, валидация в pipeline behavior. Запросы на чтение — проекциями, без загрузки агрегатов.",
        check: ["Зависимости направлены внутрь (проверено NetArchTest)", "Валидация через FluentValidation в pipeline", "Чтение через проекции / Dapper", "Unit of Work: одна транзакция на команду"],
        topics: ["arch-layers", "dotnet-mediatr", "arch-cqrs", "arch-testing"],
      },
      {
        title: "Аутентификация и права",
        md: "JWT-аутентификация (или Keycloak). Политики: только участник проекта видит задачи, только владелец удаляет проект.",
        check: ["Эндпоинты защищены [Authorize] / RequireAuthorization", "Проверка прав через политики/handlers, а не if в контроллерах", "Тест: чужой пользователь получает 403/404"],
        topics: ["dotnet-auth", "net-owasp"],
      },
      {
        title: "Outbox и уведомления",
        md: "При `TaskCompleted` отправляй уведомление через брокер (RabbitMQ + MassTransit) с transactional outbox. Отдельный воркер-потребитель — идемпотентный.",
        check: ["Сообщение пишется в outbox в той же транзакции", "Воркер обрабатывает повтор сообщения без дублей", "Падение брокера не теряет события"],
        topics: ["arch-microservices", "distributed-messaging", "distributed-idempotency"],
      },
      {
        title: "ADR и документация",
        md: "Напиши 3 ADR (выбор архитектуры, БД, способ интеграции) и C4-диаграммы уровня Context и Container.",
        check: ["3 ADR в репозитории", "C4 Context + Container", "README: как запустить и как устроено"],
        topics: ["arch-quality", "craft-docs"],
      },
    ],
  },
  {
    id: "k8s-deploy",
    title: "Свой сервис в Kubernetes",
    icon: "☸️",
    level: 2,
    tracks: ["devops"],
    summary: "Разверни .NET-сервис в локальном кластере по-взрослому: Helm, probes, автомасштабирование, мониторинг, GitOps.",
    stages: [
      {
        title: "Локальный кластер",
        md: "Подними kind или k3d. Задеплой свой сервис манифестами: Deployment (2 реплики), Service, Ingress, ConfigMap, Secret.",
        check: ["Сервис доступен через Ingress", "Конфигурация из ConfigMap, пароль БД из Secret", "requests/limits заданы"],
        topics: ["devops-k8s", "devops-networking"],
      },
      {
        title: "Probes и graceful shutdown",
        md: "Настрой readiness/liveness/startup probes на health checks .NET. Проверь, что при rolling update нет ошибок 5xx (k6 во время деплоя).",
        check: ["Три вида probes настроены осознанно", "Rolling update без ошибок под нагрузкой", "Обработка SIGTERM: сервис дорабатывает запросы"],
        topics: ["devops-k8s", "dotnet-deploy"],
      },
      {
        title: "Helm и HPA",
        md: "Упакуй в Helm-чарт с values для dev/prod. Добавь HorizontalPodAutoscaler по CPU и проверь масштабирование нагрузкой.",
        check: ["helm install с разными values", "HPA масштабирует от 2 до 6 подов", "Описано, почему выбраны такие requests"],
        topics: ["devops-k8s-adv"],
      },
      {
        title: "Мониторинг",
        md: "kube-prometheus-stack: метрики сервиса (OpenTelemetry → Prometheus), дашборд Grafana с RED-метриками, алерт на рост ошибок.",
        check: ["Дашборд: RPS, ошибки, p95 латентность", "Алерт срабатывает при искусственных ошибках", "Определены SLI и SLO"],
        topics: ["devops-observability", "devops-sre"],
      },
      {
        title: "GitOps",
        md: "Argo CD следит за репозиторием с манифестами. Деплой новой версии = коммит тега образа.",
        check: ["Argo CD синхронизирует приложение", "Откат — git revert", "Секреты не лежат в git открытым текстом (Sealed Secrets / SOPS)"],
        topics: ["devops-iac", "devops-security"],
      },
    ],
  },
  {
    id: "rag-assistant",
    title: "RAG-ассистент по документации",
    icon: "🤖",
    level: 2,
    tracks: ["ai", "dotnet"],
    summary: "ИИ-помощник, который отвечает по твоим документам со ссылками на источники. Всё на .NET: эмбеддинги, векторный поиск, LLM, оценка качества.",
    stages: [
      {
        title: "Загрузка и нарезка",
        md: "Консольная утилита загружает Markdown/PDF, режет на чанки (по заголовкам, с перекрытием), считает эмбеддинги через `IEmbeddingGenerator` (Ollama локально или облачный API).",
        check: ["Чанки с метаданными (файл, заголовок)", "Эмбеддинги сохраняются в pgvector или Qdrant", "Повторная загрузка не дублирует данные"],
        topics: ["ai-embeddings", "ai-dotnet"],
      },
      {
        title: "Поиск и ответ",
        md: "API: вопрос → поиск top-k чанков → промпт с контекстом → ответ LLM через `IChatClient` со ссылками на источники. Стриминг ответа.",
        check: ["Ответ содержит ссылки на использованные чанки", "Если ответа нет в документах — модель так и говорит", "Стриминг через SSE"],
        topics: ["ai-rag", "ai-prompting", "dotnet-grpc"],
      },
      {
        title: "Качество",
        md: "Составь набор из 20 вопросов с эталонными ответами. Прогоняй evals после каждого изменения: гибридный поиск, reranking, другой размер чанков.",
        check: ["Набор evals в репозитории", "Метрики: доля верных ответов, faithfulness", "Сравнение минимум двух конфигураций"],
        topics: ["ai-evals"],
      },
      {
        title: "Агент с инструментами",
        md: "Добавь инструменты (function calling): поиск по документам, текущая дата, создание задачи. Ограничь агента по числу шагов.",
        check: ["Модель сама выбирает инструмент", "Есть лимит шагов и таймаут", "Защита от prompt injection из документов описана"],
        topics: ["ai-agents"],
      },
    ],
  },
  {
    id: "event-shop",
    title: "Магазин на событиях",
    icon: "🛒",
    level: 3,
    tracks: ["distributed", "arch", "devops"],
    summary: "Три микросервиса (заказы, склад, оплата) и сага оформления заказа. Идемпотентность, outbox, ретраи, трассировка — вся боль распределённых систем в одном проекте.",
    stages: [
      {
        title: "Сервисы и контракты",
        md: "Три сервиса, у каждого своя БД. Контракты событий в отдельной сборке с версионированием. Kafka или RabbitMQ.",
        check: ["Database per service", "Контракты событий версионируются", "docker compose поднимает всё"],
        topics: ["arch-microservices", "distributed-messaging"],
      },
      {
        title: "Сага заказа",
        md: "Оформление: резерв товара → оплата → подтверждение. При отказе оплаты — компенсация (снять резерв). Оркестрация (MassTransit state machine) или хореография — обоснуй выбор.",
        check: ["Успешный сценарий проходит", "Отказ оплаты откатывает резерв", "ADR с выбором оркестрации/хореографии"],
        topics: ["distributed-transactions", "arch-cqrs"],
      },
      {
        title: "Надёжность",
        md: "Outbox + inbox во всех сервисах. Ретраи с backoff, DLQ. Chaos-тест: убиваем сервис посреди саги — заказ всё равно доходит до финального состояния.",
        check: ["Дубли сообщений не ломают данные", "Сообщения после N неудач уходят в DLQ", "Chaos-тест описан и проходит"],
        topics: ["distributed-idempotency", "distributed-resilience"],
      },
      {
        title: "Наблюдаемость",
        md: "Сквозная трассировка через брокер (trace context в заголовках сообщений), единый дашборд, поиск заказа по trace id.",
        check: ["Один trace от HTTP-запроса до последнего потребителя", "Логи коррелированы с trace id", "Дашборд состояния саг"],
        topics: ["dotnet-observability", "devops-observability"],
      },
    ],
  },
  {
    id: "mini-redis",
    title: "Свой мини-Redis",
    icon: "🧱",
    level: 3,
    tracks: ["csharp", "cs", "distributed"],
    summary: "In-memory хранилище ключ-значение с сетевым протоколом, TTL и репликацией. Прокачивает низкоуровневый C#, производительность и распределёнку.",
    stages: [
      {
        title: "TCP-сервер и протокол",
        md: "TCP-сервер на `System.IO.Pipelines`, понимающий подмножество протокола RESP: `GET`, `SET`, `DEL`, `PING`. Проверь через настоящий `redis-cli`.",
        check: ["redis-cli подключается и выполняет команды", "Парсинг без лишних аллокаций (Span, Pipelines)", "Много клиентов одновременно"],
        topics: ["csharp-span", "net-tcpip", "csharp-async"],
      },
      {
        title: "TTL и память",
        md: "`SET key value EX 10`, ленивое и фоновое удаление просроченных. Ограничение памяти и вытеснение LRU.",
        check: ["TTL работает", "LRU-вытеснение при лимите", "Бенчмарк: операций в секунду"],
        topics: ["cs-structures", "csharp-benchmark", "csharp-memory"],
      },
      {
        title: "Персистентность",
        md: "Append-only лог команд с fsync раз в секунду, восстановление при старте, компактизация лога.",
        check: ["Данные переживают рестарт", "Компактизация уменьшает лог", "Описан компромисс надёжности и скорости"],
        topics: ["data-redis", "cs-os"],
      },
      {
        title: "Репликация",
        md: "Лидер отправляет поток команд репликам, реплики обслуживают чтение. Что будет при падении лидера?",
        check: ["Реплика догоняет лидера после отключения", "Замерен лаг репликации", "Описаны гарантии согласованности"],
        topics: ["distributed-replication", "distributed-cap"],
      },
    ],
  },
  {
    id: "onec-bridge",
    title: "Мост 1С ↔ .NET",
    icon: "🌉",
    level: 2,
    tracks: ["onec", "dotnet"],
    summary: "Интеграция учётной системы с современным сервисом: HTTP-сервис в 1С, .NET-клиент, обмен через очередь.",
    stages: [
      {
        title: "HTTP-сервис в 1С",
        md: "В учебной конфигурации создай HTTP-сервис, отдающий номенклатуру и остатки в JSON.",
        check: ["GET возвращает JSON с остатками", "Запрос остатков — один запрос к виртуальной таблице, без запросов в цикле"],
        topics: ["onec-integration", "onec-queries"],
      },
      {
        title: ".NET-клиент",
        md: "ASP.NET Core сервис периодически забирает остатки из 1С, кэширует и отдаёт своим клиентам. Устойчивость к недоступности 1С.",
        check: ["Typed HttpClient + Polly (retry, timeout)", "Кэш на время недоступности 1С", "Логирование и метрики обмена"],
        topics: ["dotnet-resilience", "dotnet-caching"],
      },
      {
        title: "Обратный поток",
        md: "Заказы из .NET создаются в 1С как документы: через HTTP POST или через очередь. Идемпотентность по внешнему номеру заказа.",
        check: ["Повторная отправка не создаёт дубль документа", "Ошибки 1С возвращаются понятным сообщением"],
        topics: ["distributed-idempotency", "onec-registers"],
      },
    ],
  },
  {
    id: "interview-kit",
    title: "Подготовка к собеседованию senior",
    icon: "🎯",
    level: 3,
    tracks: ["craft", "sysdesign", "cs"],
    summary: "Системная подготовка за 6–8 недель: алгоритмы по паттернам, system design, истории по STAR, пробные собеседования.",
    stages: [
      {
        title: "Алгоритмы по паттернам",
        md: "Реши по 5 задач на каждый паттерн: два указателя, скользящее окно, BFS/DFS, бинарный поиск, куча, DP. Решай на C# с объяснением вслух.",
        check: ["30+ задач на LeetCode/NeetCode", "Для каждой — сложность по времени и памяти", "Пробное алгоритмическое интервью в Арене DevPath"],
        topics: ["cs-patterns", "cs-dp", "cs-trees"],
      },
      {
        title: "System design",
        md: "Разбери 6 классических систем по методике: требования → оценки → API → схема → узкие места.",
        check: ["6 разборов со схемами", "Для каждого — оценка нагрузки", "Одна система разобрана вслух с таймером на 45 минут"],
        topics: ["sysdesign-method", "sysdesign-feed", "sysdesign-chat"],
      },
      {
        title: "Истории и опыт",
        md: "Подготовь 8 историй по STAR: сложный баг, конфликт, провал, лидерство, архитектурное решение, оптимизация, менторство, дедлайн.",
        check: ["8 историй записаны", "Каждая — с измеримым результатом", "Резюме обновлено под целевую позицию"],
        topics: ["craft-career"],
      },
      {
        title: "Пробные собеседования",
        md: "Пройди 5 пробных собеседований у наставника DevPath (разные треки) и хотя бы одно с живым человеком.",
        check: ["5 собеседований с оценкой ≥ 7/10", "Список пробелов и план их закрытия"],
        topics: ["craft-career"],
      },
    ],
  },
];

export const projectById = (id: string) => PROJECTS.find((p) => p.id === id);
