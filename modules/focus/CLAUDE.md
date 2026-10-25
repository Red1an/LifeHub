@../LIFEHUB_GUIDE.md

# Фокус

Осознанный вход на YouTube, в Инстаграм и т. п. и своя лента полезных роликов.

## Как устроено

- Блокирует расширение браузера `voice/browser-extension` (общее с Джарвисом), код — `focus/`:
  `focus.js` (фон: перехват, сеансы, таймер, связь с хабом), `gate.html/js` («Зачем пришёл?» и итог),
  `clean.js` (на сайтах: без рекомендаций/Shorts/Reels, плашка с таймером).
- Сервер — `server/focus.ts`: `GET /api/focus/config`, `POST /api/focus/sessions` (только расширение, только localhost).
  Вместе с настройками `config` отдаёт `puzzles` — короткие задачки «Кругозора» (kv `quick` модуля `horizon`):
  пока идёт ожидание, `gate.js` показывает одну, каждый раз новую (`focus.js` → `nextPuzzle`).
- Телефон — Фокус встроен в приложение LifeHub (`phone/android`, классы `GuardService`, `GateActivity`, `Store`, `Sync`):
  спецвозможности видят открытое приложение, а в браузерах — адрес из адресной строки, и показывают тот же экран входа.
  Связь — `/api/app/focus/config|sessions` (server/app.ts, вход токеном устройства). Без хаба работает по последним настройкам,
  сеансы ждут в очереди. Логика сеансов повторяет `focus.js` — менять вместе.
- Ослабить настройки можно только с задержкой: `pending` + `applyAt` (`lib/store.ts` → `isLooser`), расширение
  применяет `pending` само, когда наступил `applyAt`. Пауза — `pause.requestedAt` + `pauseDelayMin`.

## Данные

- kv `config` — `FocusConfig` (`lib/types.ts`). Формат читает расширение — менять только вместе с `focus.js`.
- Коллекция `sessions` — пишет расширение через сервер, id задаёт расширение: `{ site, siteName, purpose, minutes,
  startedAt, endsAt, endedAt, endedBy: timer|self|closed|null, waited, titles[] }`.
- Коллекция `channels` — `{ channelId, title, topic, thumb? }`; kv `topics` — список тем.
- kv `feed` — кэш ленты `{ at, videos[], failed[] }` (RSS каналов, обновляется раз в час).
- Коллекция `watched` — открытые из ленты ролики `{ videoId, title, channelTitle, topic, at }`.
- В сеансе с телефона `device: "phone"`.
- kv `phone` (`{ seenAt, version }`) — когда телефон заходил; kv `extension` (`{ seenAt, version }`) и `install` (`{ extensionPath }`) пишет сервер.
