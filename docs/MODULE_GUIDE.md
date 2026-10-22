# Как писать модули LifeHub

Этот файл — инструкция для Claude Code (и для людей). Он генерируется хабом и лежит в папке модулей
как `LIFEHUB_GUIDE.md`; `CLAUDE.md` каждого модуля ссылается на него.

## Что такое модуль

Модуль — папка с исходниками, которую хаб сам компилирует (esbuild) и показывает в своём интерфейсе.
Никаких `npm install`, `node_modules`, сборщиков и конфигов в модуле нет и быть не должно.

```
<id>/
  lifehub.json     — манифест
  CLAUDE.md        — заметки о модуле для нейронки (начинается с @../LIFEHUB_GUIDE.md)
  src/index.tsx    — точка входа: export default defineModule({...})
  src/...          — любые другие файлы .ts/.tsx/.css/.json, картинки
```

Хаб следит за файлами: после сохранения модуль пересобирается и обновляется в открытых браузерах
(и на компьютере, и на телефоне). `tsconfig.json` и `.gitignore` генерируются хабом — не редактируй их.

## Проверка — делай всегда после изменений

```
node "{{HUB_DIR}}/bin/lifehub.mjs" check <id>
```

Команда собирает модуль и проверяет типы (tsc). Пока она не проходит без ошибок, работа не закончена.
`--no-types` — только сборка.

## Манифест lifehub.json

```json
{
  "id": "finance",                 // = имя папки, [a-z][a-z0-9-]
  "name": "Финансы",
  "version": "0.1.0",              // повышай при заметных изменениях
  "description": "Учёт расходов и доходов",
  "icon": "💰",                    // эмодзи
  "author": "имя",
  "type": "app",                   // "app", "library" или "service"
  "sdk": "^1",
  "entry": "src/index.tsx",
  "deps": { "date-fns": "^4" },    // npm-пакеты (общий кэш хаба)
  "uses": { "audio": "^1" },       // модули-библиотеки
  "permissions": ["files"],        // files, mic, camera, notifications, ai, network, google:calendar, webhook, read:<id>
  "exports": { "collections": ["transactions"], "stores": ["budget"] },  // что могут читать другие модули
  "share": "/",                    // необязательно: сюда хаб передаёт «Поделиться» с телефона (см. ниже)
  "forkedFrom": "author/finance@0.3.0"             // заполняет хаб при форке
}
```

## Зависимости — главное правило

1. **Сначала SDK.** React и `@lifehub/sdk` уже есть — это UI-компоненты, графики, хранилище, роутинг,
   форматирование дат и денег. Не тащи библиотеку ради того, что есть в SDK или пишется в 20 строк.
2. **npm-пакет** — только если реально нужен (разбор музыкальной теории, markdown, сложные вычисления).
   Добавь его в `deps` с диапазоном версий; хаб скачает его в общий кэш **один раз для всех модулей**.
   Импорт пакета, которого нет в `deps`, — ошибка сборки с подсказкой.
   Предпочитай популярные пакеты без React (или с React в peerDependencies — он подставится общий).
3. **Общий код между своими модулями** — вынеси в модуль-библиотеку (`"type": "library"`),
   подключай через `"uses"` и `import { x } from "@modules/<id>"`.
4. Нельзя: модули Node.js (`fs`, `path`…), свои копии React, CDN-скрипты, `localStorage` для данных
   (данные должны быть на сервере, чтобы работать с телефона и компьютера).

## Точка входа

```tsx
import { defineModule, useCollection, type ModuleSummary } from "@lifehub/sdk";
import { Home } from "./pages/Home";
import { Stats } from "./pages/Stats";
import { Item } from "./pages/Item";
import { SummaryWidget } from "./widgets";

export default defineModule({
  routes: {
    "/": Home,               // обязателен
    "/stats": Stats,
    "/items/:id": Item,      // useParams() → { id }
    "*": Home,               // всё остальное (необязательно)
  },
  nav: [                     // вкладки на компьютере и нижнее меню на телефоне (до 5)
    { to: "/", label: "Главная", icon: "🏠" },
    { to: "/stats", label: "Статистика", icon: "📊" },
  ],
  widgets: {                 // карточки-виджеты (сейчас главная хаба их не показывает)
    summary: { title: "Финансы", size: "sm", component: SummaryWidget },  // size: sm | md | lg
  },
  summary: useSummary,       // необязательно: что написать на плитке модуля на главной хаба (см. ниже)
  theme: "dark",             // необязательно: своя тема модуля
});

// Хук сводки: вызывается на главной хаба (useCollection, useStore — можно; контекст из layout — нет).
function useSummary(): ModuleSummary | null {
  const expenses = useCollection<Expense>("expenses");
  if (expenses.loading) return null;
  return {
    value: "19 360 ₽",              // главная цифра на плитке
    text: "потрачено за октябрь",    // строка пояснения
  };
}
```

Главная хаба — плитки модулей для быстрого запуска. Сводка (`summary`) — то, что видно на плитке без открытия
модуля: **факты** (сколько потрачено, что сейчас по расписанию), не задания, серии и очки. Без сводки на
плитке — описание из манифеста.

Пути в `Link`, `useNavigate` — **внутри модуля** (`"/stats"` → `/m/<id>/stats`).
`"~/"` в начале — путь хаба (`"~/modules"`).

## Данные

Данные живут в SQLite хаба, отдельно от кода: правка, форк и обновление модуля их не теряют.
Изменения синхронизируются между устройствами в реальном времени.

```tsx
import { useCollection, useDoc, useStore, db, kv } from "@lifehub/sdk";

interface Expense { amount: number; category: string; date: string; note?: string }

function Expenses() {
  const expenses = useCollection<Expense>("expenses");
  // expenses.items: (Expense & { id, createdAt, updatedAt })[] — в порядке создания
  // expenses.loading, expenses.error
  // await expenses.add({ amount: 350, category: "еда", date: dayKey() })
  // await expenses.update(id, { note: "обед" })    — слияние полей
  // await expenses.put(id, fullObject)             — полная замена / создание с заданным id
  // await expenses.remove(id); await expenses.clear()
  // await expenses.batch({ add: [...], update: [{ id, patch }], remove: [id] })  — сотни изменений одним запросом (импорт)
}

const { doc, update, remove } = useDoc<Expense>("expenses", id);

// Небольшое состояние и настройки — как useState, но сохраняется и синхронизируется:
const [budget, setBudget] = useStore("budget", 30000);

// Вне React:
const all = await db.collection<Expense>("expenses").list();
await kv.set("lastExport", Date.now());
```

- Коллекция — набор JSON-документов. Храни в документе простые JSON-данные (без Date — используй
  ISO-строки, `dayKey()` или timestamp). Фильтрация и сортировка — на клиенте (`items.filter`),
  этого хватает на десятки тысяч записей.
- Имена коллекций и ключей: `[a-zA-Z0-9_-]`.
- **Не меняй формат уже сохранённых данных молча.** Если нужно — пиши код, который понимает и старый
  формат (поле может отсутствовать), или делай миграцию при загрузке.

### Чужие данные

Модуль «Отчёты» хочет читать расходы модуля `finance`:
1. в `finance/lifehub.json`: `"exports": { "collections": ["expenses"], "stores": ["budget"] }`;
2. в `reports/lifehub.json`: `"permissions": ["read:finance"]`;
3. `useCollection<Expense>("expenses", { from: "finance" })` или `db.collection("expenses", { from: "finance" }).list()`,
   а ключ `useStore` — `await kv.get("budget", 0, { from: "finance" })`. Всё только для чтения.

Формат чужих данных может поменяться в любой момент — читай их осторожно (поле может отсутствовать).
Открывая свои данные, не меняй потом их формат без нужды: на них могут опираться другие модули.

### Файлы (разрешение "files")

```tsx
import { files, useFiles } from "@lifehub/sdk";
const meta = await files.upload(blob, "запись.webm");   // { id, name, mime, size, createdAt }
<audio src={files.url(meta.id)} controls />
const { files: list } = useFiles();
await files.remove(id);
```

Храни в коллекции ссылку на файл (`fileId`), а не сам файл.

### Нейронка (разрешение "ai")

Модуль может обращаться к Claude. Запросы выполняет Claude Code пользователя на компьютере с хабом
(под его аккаунтом, без API-ключа), поэтому работает и с телефона. Claude отвечает только текстом —
доступа к файлам и инструментам у него нет. Если Claude Code не установлен или не авторизован,
запрос вернёт ошибку с понятным текстом — покажи её пользователю.

```tsx
import { ai, useAi } from "@lifehub/sdk";

// Разовый запрос:
const answer = await ai.ask("Придумай 3 скороговорки на звук Р", {
  system: "Ты логопед. Отвечай кратко, списком.",
  model: "fast",                       // "fast" — быстро и дёшево, "smart" (по умолчанию) — основная из настроек хаба,
                                       // "haiku" | "sonnet" | "opus" — конкретная, если задаче нужна сильная модель
  onDelta: (d, full) => setText(full), // поток ответа (необязательно)
});

// Ответ в JSON — опиши структуру в запросе:
const cats = await ai.json<{ category: string }[]>(
  `Разложи траты по категориям. Верни массив [{"category": "…"}] в том же порядке: ${list}`,
);

// Диалог:
const reply = await ai.chat([{ role: "user", content: "Привет" }, { role: "assistant", content: "Здравствуйте!" }, { role: "user", content: "Как дела?" }]);

// С картинками (до 5): Blob/File или id файла модуля. Большие фото хаб уменьшает сам.
const parsed = await ai.json<{ title: string; time: string }[]>("Перепиши расписание с фото в JSON […]", { images: [photoFile] });

// В компоненте — с потоковым выводом и отменой:
const { run, text, loading, error, cancel } = useAi();
<Button onClick={() => run("Разбери мой текст: " + draft, { system: "Ты редактор" })} loading={loading}>Разобрать</Button>
<div className="whitespace-pre-wrap">{text}</div>
```

- Ответ приходит за секунды, но это не мгновенно: всегда показывай загрузку и не вызывай нейронку
  на каждое нажатие клавиши.
- Результаты, которые нужны потом (разборы, категории), сохраняй в коллекцию — не запрашивай повторно.
- Не отправляй лишнего: только текст, который нужен для ответа.
- С картинками используй основную модель (`"smart"`), быстрая хуже читает фото.

### Google Календарь (разрешение "google:calendar")

Пользователь один раз подключает аккаунт Google в настройках хаба. Модуль ходит в
[Calendar API v3](https://developers.google.com/calendar/api/v3/reference) через хаб и не видит токен,
поэтому работает и с телефона.

```tsx
import { google, useGoogle, GoogleRequestError } from "@lifehub/sdk";

const { status } = useGoogle();           // { configured, connected, email } | null
if (status && !status.connected) /* покажи «Подключите Google в настройках хаба» и <Link to="~/settings"> */;

const cals = await google.calendar<{ items: any[] }>("/users/me/calendarList");
const evs = await google.calendar("/calendars/primary/events", {
  query: { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: "startTime" },
});
await google.calendar("/calendars/primary/events", { method: "POST", body: { summary: "Встреча", start: {…}, end: {…} } });
```

- Ошибки — `GoogleRequestError` (`status` 401 — аккаунт не подключён или доступ отозван). Покажи текст пользователю.
- Помечай свои события (`extendedProperties.private`), чтобы отличать их от событий пользователя, и не трогай чужие
  без явной просьбы. Перед массовыми изменениями показывай черновик.

### Интернет (разрешение "network")

Браузер не пускает модуль на чужие сайты без CORS. `net` забирает страницу через сервер хаба —
работает с любым публичным сайтом и с телефона. Локальная сеть и сам компьютер с хабом недоступны.

```tsx
import { net, NetRequestError } from "@lifehub/sdk";

const html = await net.text("https://example.com/search?q=…");   // ошибка, если статус не 2xx
const data = await net.json<{ items: any[] }>("https://api.example.com/items");
const r = await net.fetch(url, { method: "POST", body: JSON.stringify(x), headers: { "content-type": "application/json" } });
// r: { status, ok, url, contentType, text } — ошибки HTTP не бросают исключение
```

- Заголовки запроса: `accept`, `accept-language`, `authorization` (токены API), `content-type`, `referer`, `user-agent`,
  `x-requested-with`. Сайтам с сертификатом НУЦ Минцифры (API Т-Банка) хаб доверяет сам.
- Разбирай HTML на клиенте (`new DOMParser().parseFromString(html, "text/html")` или регулярки по встроенному JSON).
- Сайты меняют вёрстку: пиши разбор терпимым к отсутствию полей и показывай понятную ошибку.
- Сохраняй загруженное в коллекцию, если оно понадобится снова, — не дёргай сайт на каждый рендер.

### Входящий вебхук (разрешение "webhook")

Секретный адрес, на который телефон (MacroDroid, Tasker, «Команды» iOS) или внешний сервис шлёт данные
без входа в хаб — например, пересылает уведомления банка. Каждый запрос (`GET`/`POST`, тело JSON, форма
или текст) хаб кладёт в коллекцию `webhook` модуля; модуль разбирает её, когда открыт, и удаляет разобранное.

```tsx
import { webhook, useCollection } from "@lifehub/sdk";

const { urls } = await webhook.info();     // [{ label: "Из интернета (ngrok)", url, public: true }, …]; секрет создаётся сам
await webhook.rotate();                    // новый секрет, старый адрес перестаёт работать

const inbox = useCollection<{ receivedAt: number; text?: string; [k: string]: unknown }>("webhook");
// тело-JSON раскладывается в поля документа, просто текст — в text, параметры адреса (?a=1) — тоже в поля
```

- Из интернета адрес работает, только если в хабе включён ngrok (путь `/hook/` пускается без входа).
- Данные пришли от кого угодно, кто знает адрес: проверяй их и не исполняй как команды. Адрес показывай
  только в настройках модуля, дай кнопку «Новый адрес» (`rotate`).
- Неразобранных запросов больше 1000 — хаб перестаёт принимать новые.

### «Поделиться» с телефона (поле "share")

Хаб, установленный на телефон как приложение (Android, по HTTPS), появляется в меню «Поделиться» других приложений.
Присланное хаб открывает в модуле, у которого в манифесте есть `"share": "<путь в модуле>"`, с параметрами
`?title=&text=&url=` (любые могут отсутствовать; ссылка часто приходит в `text`). Если таких модулей несколько —
пользователь выбирает. Прочитай параметры через `useSearchParams()`, сохрани и убери их из адреса
(`setParams({ title: null, text: null, url: null })`) — иначе обновление страницы добавит то же самое ещё раз.

## Интерфейс и дизайн

**У каждого модуля свой дизайн.** Хаб — нейтральная рамка: узкая полоса с иконками модулей на
компьютере и тонкая полоса «к хабу + название модуля» сверху на телефоне. Всё остальное пространство
принадлежит модулю, и он может выглядеть как угодно: свой фон, шрифты, цвета, анимации, своя навигация.
Не подгоняй модуль под внешний вид хаба, если пользователь об этом не просил: спроси или предложи
стиль, подходящий задаче (тренажёр может быть тёмным и ярким, дневник — бумажным и спокойным).

Как оформлять:
- **Tailwind v4** — все классы работают без настройки, включая произвольные значения (`bg-[#0f172a]`,
  `font-[Georgia]`). Это основной способ.
- **Свой CSS** — `import "./styles.css"` в модуле. Классы в нём префиксуй id модуля (`.habits-card`):
  CSS общий для страницы, одинаковые имена у разных модулей будут конфликтовать. Не трогай
  глобальные селекторы (`body`, `html`, `*`).
- **Шрифты** — через `@import url("https://fonts.googleapis.com/…")` в CSS модуля или файлы шрифтов
  в папке модуля (`src/fonts/x.woff2`, подключаются через `@font-face` с `url("./fonts/x.woff2")`).
- **Своя иконка** — эмодзи в `"icon"` манифеста или путь к картинке в папке модуля: `"icon": "icon.svg"`.
- **Своя тема** — `defineModule({ theme: "dark" })` делает модуль тёмным независимо от темы хаба
  (токены и `dark:`-классы внутри модуля следуют ей). Без `theme` модуль следует теме пользователя.
- **Навигация** — либо `nav` в `defineModule` (хаб нарисует нейтральные вкладки сверху на компьютере
  и нижнее меню на телефоне), либо своя навигация внутри модуля в своём стиле. Главная страница модуля
  (`"/"`) всегда доступна по нажатию на название модуля в полосе хаба.

Растягивай корневой элемент страницы на всю высоту (`min-h-full` или `flex-1`), если у модуля свой фон.

### Готовый набор SDK (необязательный)

Если особого дизайна не нужно — есть нейтральные компоненты, которые следуют теме и акценту хаба.
Их можно смешивать со своими стилями. Токены темы (Tailwind-классы и CSS-переменные):

| Токен | Классы | Переменная |
|---|---|---|
| фон страницы / карточки / вторичный | `bg-bg`, `bg-surface`, `bg-surface-2` | `--lh-bg`, `--lh-surface`, `--lh-surface-2` |
| текст / приглушённый | `text-fg`, `text-muted` | `--lh-fg`, `--lh-muted` |
| границы | `border-line` | `--lh-line` |
| акцент пользователя | `bg-accent text-accent-fg`, `text-accent`, `bg-accent-soft` | `--lh-accent` |
| статусы | `text-success`, `text-warning`, `text-danger` (и `bg-*/15`) | `--lh-success`… |

**Компоненты:**
- `Page` — `title`, `subtitle`, `actions`, `back` (true | путь), `width` ("narrow" | "normal" | "wide" | "full").
- `Section` (`title`, `actions`), `Card` (`padding`, `interactive`), `List` + `ListItem` (`title`, `subtitle`, `left`, `right`, `onClick`)
- `Button` (`variant`: primary | secondary | ghost | danger | soft; `size`: sm | md | lg; `icon`, `loading`, `block`), `IconButton` (`label` обязателен)
- `Input`, `Textarea`, `Select` (`options`), `Field` (`label`, `hint`, `error`), `Checkbox`, `Switch` (`checked`, `onChange`, `label`)
- `Tabs` (`tabs`, `value`, `onChange`), `Modal` (`open`, `onClose`, `title`, `footer`) — на телефоне выезжает снизу
- `Badge` (`tone`), `Stat` (`label`, `value`, `hint`, `tone`), `Progress` (`value`, `max`), `EmptyState` (`icon`, `title`, `text`, `action`), `Spinner`, `Loading`
- Графики: `BarChart` (`data: {label, value, color?}[]`), `LineChart` (`labels`, `series: {name, points}[]`), `DonutChart`, `Sparkline` (`points`), `Heatmap` (`values: { "2026-09-25": 3 }`). Цвета можно передать свои.
- `toast(msg, "success" | "error")`, `await confirm("Удалить?", { danger: true })`, `await prompt("Название", "")` — диалоги хаба, работают при любом дизайне модуля.
- Роутинг: `Link` (`to`, `activeClassName`, `end`), `useNavigate()`, `useParams()`, `useLocation()`, `useSearchParams()`
- `useModule()` → `{ id, basePath, manifest }`

**Утилиты:** `formatDate(d, "short" | "long" | "time" | "datetime" | "weekday")`, `formatRelative`, `formatMoney(n, "RUB")`,
`formatNumber`, `formatDuration(sec)`, `plural(n, ["день", "дня", "дней"])`, `dayKey()`, `monthKey()`, `startOfDay`,
`startOfWeek`, `addDays`, `uid()`, `cn(...classes)`.

**Устройства:** `media.microphone()`, `media.camera()` (нужны разрешения `mic`/`camera` и HTTPS или localhost),
`media.notify(title, body)` (разрешение `notifications`).

**Интернет:** `net.text(url)`, `net.json(url)`, `net.fetch(url, opts)` (разрешение `network`, см. выше).

**Вебхук:** `webhook.info()`, `webhook.rotate()` (разрешение `webhook`, см. выше).

**События между модулями на странице:** `emitEvent("finance:added", data)`, `useEvent("finance:added", fn)`.

### Правила интерфейса

- **Сначала телефон.** Проверяй вёрстку на ширине 360px: крупные зоны нажатия (от 40px), `sm:`/`lg:` для
  компьютера. Сверху на телефоне 44px занимает полоса хаба (она не перекрывает модуль). Если модуль объявил
  `nav`, снизу 56px занимает меню разделов — отступ уже учтён. Своё нижнее меню делай только без `nav`
  и с `position: sticky`/`fixed` + `padding-bottom: env(safe-area-inset-bottom)`.
- Интерфейс на русском (если пользователь не попросил иначе).
- Не рисуй ссылку «назад в хаб» — она есть в полосе хаба.
- Виджеты на главной хаба показываются в небольшой карточке (примерно 300×150px): делай их компактными,
  фон карточки можно перекрыть своим.

## Модуль-библиотека

```json
{ "id": "audio", "type": "library", "version": "1.2.0", "entry": "src/index.ts", "deps": {} }
```

Экспортирует функции, хуки, компоненты. Её код загружается в браузер **один раз** на все модули,
которые её используют. При несовместимых изменениях API повышай мажорную версию.

## Модуль-сервис

Готовое приложение со своим сервером (Node, Python…), которое нельзя переписать на SDK: парсинг сайтов,
локальные программы. Делай обычный модуль, если можешь, — сервис не получает SDK, данные хаба, виджеты и
историю версий.

```json
{
  "id": "eda", "name": "Еда", "type": "service",
  "service": {
    "start": "npm start",            // команда запуска (в папке модуля)
    "port": 4322,                    // порт, который слушает сервер на 127.0.0.1
    "build": "{python} build.py",    // необязательно: сборка перед запуском, когда файлы изменились
    "path": "/",                     // начальная страница
    "health": "/api/health",         // необязательно: адрес проверки готовности
    "widget": "/api/widget",         // необязательно: виджет на главной хаба (JSON, формат ниже)
    "env": { "EDA_PORT": "{port}", "EDA_DATA": "{data}" }
  }
}
```

В командах и `env` подставляются `{port}`, `{dir}` (папка модуля), `{data}` (папка данных сервиса вне модуля —
храни данные там, а не в папке модуля), `{python}`, `{node}`. Есть `package.json` — хаб сам выполнит `npm install`.
Хаб запускает сервис, перезапускает при сбое и показывает его во фрейме по адресу `/s/<id>/`. Запросы к
корню (`fetch("/api/…")`) хаб переводит под этот адрес сам, но надёжнее относительные пути (`fetch("api/…")`).

Виджет сервиса — не компонент, а данные: `GET service.widget` отдаёт
`{ title, subtitle?, progress?: 0…1, note?, empty?, rows?: [{ img?, title, sub?, done?, muted?, action?: { label, post, body? } }] }`.
Хаб рисует его сам; по кнопке шлёт `POST` на `action.post` (адрес внутри сервиса) с `body` и обновляет виджет.

## История версий, форки и обновления

- **История.** После каждой удачной сборки хаб сохраняет версию модуля (отдельный git в
  `~/.lifehub/history`, папку модуля это не трогает). Пользователь может вернуть любую версию на странице
  модуля. Поэтому правь смело, но проверяй `check` — в историю попадают только собирающиеся версии.
- **Правки чужого модуля.** Модули, установленные из git, следят за автором. Если пользователь дописал
  модуль, а автор выпустил обновление, хаб сам сливает изменения автора с правками пользователя
  (трёхстороннее слияние, `lifehub.json` сливается по полям). Чтобы слияния проходили без конфликтов:
  не переформатируй чужой код без нужды, новые функции добавляй в новые файлы, не меняй чужие строки,
  если можно дописать рядом.
- **Конфликт.** Если автор и пользователь поменяли одни и те же строки, хаб кладёт версию автора в
  `<модуль>/.upstream/`. Задача нейронки — перенести изменения автора в модуль, **сохранив доработки
  пользователя**, проверить `check`, после чего пользователь нажимает «Готово, объединено».
  Сам `.upstream` не редактируй и не импортируй из него.
- **Своя версия (форк)** — копия с новым id и `forkedFrom`; если оригинал из git, копия тоже получает
  обновления автора.
- **Публикация своего модуля.** Модуль — это git-репозиторий с `lifehub.json` в корне (или в подпапке,
  тогда адрес `…/repo#папка`). Каждый `git push` с новой `version` — обновление для всех, кто поставил модуль.
  В сообщениях коммитов пиши по-человечески: пользователи видят их как список изменений.

## Чек-лист перед тем как сказать «готово»

1. `node "{{HUB_DIR}}/bin/lifehub.mjs" check <id>` проходит.
2. Новые npm-пакеты — в `deps`, новые разрешения — в `permissions`.
3. Старые данные пользователя по-прежнему читаются.
4. Вёрстка работает на телефоне, у модуля осмысленный собственный стиль.
5. Важные решения записаны в `CLAUDE.md` модуля (раздел «Заметки по модулю»).
