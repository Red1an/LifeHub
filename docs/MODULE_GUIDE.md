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
  "type": "app",                   // "app" или "library"
  "sdk": "^1",
  "entry": "src/index.tsx",
  "deps": { "date-fns": "^4" },    // npm-пакеты (общий кэш хаба)
  "uses": { "audio": "^1" },       // модули-библиотеки
  "permissions": ["files"],        // files, mic, camera, notifications, ai, network, read:<id>
  "exports": { "collections": ["transactions"] },  // что могут читать другие модули
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
import { defineModule } from "@lifehub/sdk";
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
  widgets: {                 // карточки на главной хаба
    summary: { title: "Финансы", size: "sm", component: SummaryWidget },  // size: sm | md | lg
  },
  theme: "dark",             // необязательно: своя тема модуля
});
```

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
1. в `finance/lifehub.json`: `"exports": { "collections": ["expenses"] }`;
2. в `reports/lifehub.json`: `"permissions": ["read:finance"]`;
3. `useCollection<Expense>("expenses", { from: "finance" })` — только чтение.

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
  model: "fast",                       // "fast" — быстро и дёшево, "smart" (по умолчанию) — умнее
  onDelta: (d, full) => setText(full), // поток ответа (необязательно)
});

// Ответ в JSON — опиши структуру в запросе:
const cats = await ai.json<{ category: string }[]>(
  `Разложи траты по категориям. Верни массив [{"category": "…"}] в том же порядке: ${list}`,
);

// Диалог:
const reply = await ai.chat([{ role: "user", content: "Привет" }, { role: "assistant", content: "Здравствуйте!" }, { role: "user", content: "Как дела?" }]);

// В компоненте — с потоковым выводом и отменой:
const { run, text, loading, error, cancel } = useAi();
<Button onClick={() => run("Разбери мой текст: " + draft, { system: "Ты редактор" })} loading={loading}>Разобрать</Button>
<div className="whitespace-pre-wrap">{text}</div>
```

- Ответ приходит за секунды, но это не мгновенно: всегда показывай загрузку и не вызывай нейронку
  на каждое нажатие клавиши.
- Результаты, которые нужны потом (разборы, категории), сохраняй в коллекцию — не запрашивай повторно.
- Не отправляй лишнего: только текст, который нужен для ответа.

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
