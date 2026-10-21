/*
 * Данные модуля. Хаб (server/jarvis) читает и пишет их же — форматы менять только вместе
 * с server/jarvis/prefs.ts и server/jarvis/index.ts.
 *
 *  kv "config" — настройки (пишет модуль, читает хаб; игровой режим голосом переключает хаб);
 *  kv "status" — состояние навыка Алисы (пишет хаб);
 *  kv "voice" — состояние голоса на компьютере (пишет хаб);
 *  kv "action" — разовое действие для хаба: { kind: ActionKind };
 *  коллекция "chat" — разговор: модуль добавляет { q, source: "hub" }, хаб дописывает a.
 *  Сказанное голосом и колонке хаб пишет сам (source: "voice" | "alice").
 */

export type MorningPart = "events" | "deadlines" | "habits" | "devpath" | "portfolio";
export type EveningPart = "habits" | "spending" | "devpath" | "tomorrow" | "deadlines";

export interface CustomCommand {
  id: string;
  phrases: string[];
  say: string;
  run: string[];
}

export interface VoicePrefs {
  enabled: boolean;
  wakeWords: string[];
  asr: "gigaam" | "whisper";
  ttsEngine: "piper" | "silero";
  speaker: string;
  tts: boolean;
  rate: number;
  loudness: number;
  mic: string;
  model: string;
  device: "auto" | "cuda" | "cpu";
  game: boolean;
  chime: boolean;
  followUp: number;
  verifyWake: boolean;
  announce: number;
  reminders: boolean;
  greet: boolean;
  overlay: "talk" | "always" | "never";
  overlayPos: "br" | "bl" | "tc";
}

export const DEFAULT_VOICE: VoicePrefs = {
  enabled: true,
  wakeWords: ["джарвис"],
  asr: "gigaam",
  ttsEngine: "piper",
  speaker: "dmitri",
  tts: true,
  rate: 1,
  loudness: 0.9,
  mic: "",
  model: "large-v3-turbo",
  device: "auto",
  game: false,
  chime: true,
  followUp: 6,
  verifyWake: true,
  announce: 10,
  reminders: true,
  greet: true,
  overlay: "talk",
  overlayPos: "br",
};

export interface Prefs {
  /** Принимать запросы от Алисы. */
  enabled: boolean;
  address: string;
  ai: boolean;
  aiLimit: number;
  morning: Record<MorningPart, boolean>;
  evening: Record<EveningPart, boolean>;
  commands: CustomCommand[];
  history: boolean;
  brain: "fast" | "smart";
  voice: VoicePrefs;
}

export const DEFAULT_PREFS: Prefs = {
  enabled: false,
  address: "сэр",
  ai: true,
  aiLimit: 100,
  morning: { events: true, deadlines: true, habits: true, devpath: true, portfolio: true },
  evening: { habits: true, spending: true, devpath: true, tomorrow: true, deadlines: true },
  commands: [],
  history: true,
  brain: "fast",
  voice: DEFAULT_VOICE,
};

export type ActionKind = "rotate" | "unlink" | "voice.install" | "voice.restart" | "voice.test" | "voice.mute" | "voice.unmute";

export type VoiceProcess = "off" | "missing" | "installing" | "starting" | "running" | "crashed";
export type VoiceState = "loading" | "listening" | "hearing" | "thinking" | "speaking" | "sleeping" | "muted" | "error";

export interface VoiceStatus {
  process: VoiceProcess;
  state?: VoiceState;
  detail?: string;
  error?: string;
  gpu?: boolean;
  model?: string;
  mics?: string[];
  mic?: string;
  heard?: string;
  heardAt?: number;
  connected: boolean;
  log: string[];
  installLog: string[];
  updatedAt: number;
}

export const SPEAKERS: Record<VoicePrefs["ttsEngine"], { id: string; label: string }[]> = {
  piper: [
    { id: "dmitri", label: "Дмитрий — мужской, ровный" },
    { id: "ruslan", label: "Руслан — мужской, низкий" },
    { id: "denis", label: "Денис — мужской" },
    { id: "irina", label: "Ирина — женский" },
  ],
  silero: [
    { id: "aidar", label: "Айдар — мужской, спокойный" },
    { id: "eugene", label: "Евгений — мужской, мягкий" },
    { id: "baya", label: "Бая — женский" },
    { id: "kseniya", label: "Ксения — женский" },
    { id: "xenia", label: "Ксения 2 — женский, звонкий" },
  ],
};

export interface Status {
  enabled: boolean;
  url: string | null;
  ngrok: { enabled: boolean; running: boolean; domain: string; error?: string };
  hasPassword: boolean;
  linked: boolean;
  lastAt: number | null;
  aiUsedToday: number;
  checkedAt: number;
}

export interface ChatMsg {
  q: string;
  /** Ответ; нет — хаб ещё думает. */
  a?: string;
  /** hub — написано здесь, voice — сказано компьютеру, alice — колонке. */
  source: "hub" | "voice" | "alice";
  /** Джарвис заговорил сам (таймер, напоминание) — вопроса нет. */
  push?: boolean;
  ai?: boolean;
  at?: number;
  buttons?: string[];
  ms?: number;
}

export const MORNING_PARTS: { id: MorningPart; label: string; hint: string }[] = [
  { id: "events", label: "События дня", hint: "из Google Календаря, включая пары" },
  { id: "deadlines", label: "Дедлайны", hint: "задачи «Расписания» на 3 дня вперёд" },
  { id: "habits", label: "Привычки", hint: "что сделать сегодня и серии" },
  { id: "devpath", label: "DevPath", hint: "задания дня" },
  { id: "portfolio", label: "Портфель", hint: "стоимость и изменение за день" },
];

export const EVENING_PARTS: { id: EveningPart; label: string; hint: string }[] = [
  { id: "habits", label: "Привычки", hint: "сколько отмечено, что осталось" },
  { id: "spending", label: "Траты", hint: "сколько ушло сегодня" },
  { id: "devpath", label: "DevPath", hint: "задания и опыт за день" },
  { id: "tomorrow", label: "Завтра", hint: "сколько событий и первое из них" },
  { id: "deadlines", label: "Дедлайны", hint: "что сдавать завтра" },
];

/** Встроенные команды — подсказки и шаги для своих команд. */
export const BUILTIN: { group: string; items: string[] }[] = [
  { group: "Компьютер", items: ["Открой телеграм", "Найди на ютубе лофи", "Громкость 30", "Пауза", "Следующий трек", "Переключись на браузер", "Сверни всё", "Закрой окно"] },
  { group: "Ещё на компьютере", items: ["Таймер на 10 минут чай", "Напечатай привет и отправь", "Сделай скриншот", "Яркость 60", "Заблокируй компьютер", "Сколько заряда?", "Игровой режим", "Не слушай"] },
  { group: "День", items: ["Доброе утро", "Итоги дня", "Что дальше?", "Что у меня завтра?", "Когда я свободен?", "Что на неделе?", "Мои задачи"] },
  { group: "Календарь", items: ["Поставь тренировку завтра в 7 вечера на час", "Напомни через 20 минут выключить плиту", "Перенеси пару на час позже", "Отмени тренировку в пятницу"] },
  { group: "Модули", items: ["Отметь воду", "Какие привычки остались?", "Потратил 450 на такси", "Сколько я потратил за неделю?", "Запомни: код от домофона 4512", "Что я записывал про домофон?"] },
  { group: "Учёба и прочее", items: ["Что по DevPath?", "Задай вопрос по DevPath", "Сколько тренировок?", "Как там гитара?", "Что с портфелем?"] },
];

/** Команды, которые удобно запускать из своих команд. */
export const RUNNABLE = ["открой телеграм", "открой браузер", "громкость 30", "пауза", "продолжи", "сверни все", "игровой режим", "что дальше", "что у меня сегодня", "что у меня завтра", "когда я свободен", "доброе утро", "итоги дня", "привычки", "мои задачи", "что по devpath", "что с портфелем", "сколько я потратил"];
