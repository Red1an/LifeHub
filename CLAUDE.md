# LifeHub — разработка самого хаба

Архитектура и команды описаны в README.md. Руководство для **модулей** — docs/MODULE_GUIDE.md
(копируется пользователю в `~/.lifehub/modules/LIFEHUB_GUIDE.md`).

## Устройство

- `server/` — Node 22.18+ запускает TypeScript напрямую (type stripping). Разрешён только стираемый синтаксис:
  без enum, namespace и parameter properties. Импорты с расширением `.ts`.
  - `registry.ts` — модули: сканирование, сборка, отслеживание файлов, установка/форк/обновление.
  - `compiler.ts` — esbuild для модулей и платформы; `shared.ts` — подмена React/SDK на общие экземпляры.
  - `libs.ts` — общий кэш npm-пакетов и сборка их в ESM.
  - `css.ts` — Tailwind v4 по исходникам платформы и всех модулей.
  - `app.ts` — HTTP (Hono); `auth.ts` — доступ с других устройств; `db.ts` — SQLite (`node:sqlite`).
  - `jarvis/` — Джарвис, голосовой помощник. `index.ts` — разбор фразы (`converse` для голоса и текста, `respond` для Алисы):
    свои команды → компьютер (`pcskills.ts`, через PowerShell-процесс `pc.ts`/`pc.ps1`) → хаб (`skills.ts`, данные модулей —
    `data.ts`) → Claude с планом действий (`agent.ts`). `voice.ts` ставит, запускает и перезапускает голосовой процесс
    (`voice/`, Python: Vosk → GigaAM/Whisper → Piper/Silero), связь с ним — `/api/jarvis/voice/*` (только localhost, токен процесса).
    `browser.ts` — вкладки через расширение `voice/browser-extension`; `selection.ts` — выделенный текст; `library.ts` — программы для «открой …» («Пуск», Steam, Epic, рабочий стол, свои названия); сценарии из конструктора — `runSteps`.
    Навык Алисы — вебхук `/alice/<секрет>` (ngrok пропускает его без входа Google), ответ < 3 с.
    Интерфейс — модуль `modules/jarvis`; связь с ним через его данные (kv `config`/`status`/`voice`/`action`, коллекция `chat`).
  - `focus.ts` — «Фокус» (модуль `modules/focus`): настройки и журнал сеансов для того же расширения
    (`voice/browser-extension/focus/` — «Зачем пришёл?», таймер, YouTube без рекомендаций).
  - `devpath/` — проверка практики DevPath (модуль `modules/devpath`): большие проекты по этапам (тесты хаба + Docker-инфраструктура),
    миссии и каты — всё в `~/DevPath/<id>` через `dotnet test` (`runner.ts`, разбор TRX и ошибок сборки), запросы — через
    коллекцию `runs` модуля (`index.ts`). `node server/devpath/verify.ts` — проверка самих этапов, миссий и кат.
- `voice/` — голос Джарвиса на Python (`.venv` ставит хаб): `main.py` — цикл, `stt.py` GigaAM/Whisper, `tts.py` Piper/Silero,
  `speaker.py` — голос владельца (WeSpeaker), `echo.py` — не просыпаться от своих колонок,
  `ui.py` + `ui/orb.html` — орб, панель и трей (pywebview). Модели — в `~/.lifehub/voice/models`.
- `platform/` — браузерный код, собирается сервером в `platform.js`.
  - `sdk/` — `@lifehub/sdk`. Всё, что зависит от модуля (данные, файлы, роутинг), создаётся в `bind.ts`:
    каждый модуль получает свою привязанную копию через `sdkFor(id)`.
  - `shell/` — интерфейс хаба.
- `modules/` — встроенные модули, `templates/` — шаблоны.

## Правила

- Изменение публичного API SDK — это изменение контракта со всеми модулями. Добавлять можно,
  менять или удалять только с повышением `SDK_VERSION` (server/compiler.ts) и обновлением MODULE_GUIDE.md.
- Проверка: `npx tsc -p tsconfig.json` (хаб) и `npm run check -- all` (встроенные модули).
- Интерфейс на русском. Сначала верстаем под телефон.
