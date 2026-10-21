import * as db from "../db.ts";

/*
 * Настройки Джарвиса живут в модуле «Джарвис» (modules/jarvis): useStore("config").
 * Сервер читает их отсюда; без модуля действуют значения по умолчанию.
 * Формат — как в modules/jarvis/src/lib/types.ts, менять только вместе.
 */

export const MODULE = "jarvis";

export type MorningPart = "events" | "deadlines" | "habits" | "devpath" | "portfolio";
export type EveningPart = "habits" | "spending" | "devpath" | "tomorrow" | "deadlines";

export interface CustomCommand {
  id: string;
  /** Фразы-триггеры, любая из них. */
  phrases: string[];
  /** Что сказать (может быть пусто). */
  say: string;
  /** Какие команды Джарвиса выполнить следом: «что дальше», «привычки»… */
  run: string[];
}

/** Голосовой помощник на компьютере (voice/ — процесс на Python, его запускает хаб). */
export interface VoicePrefs {
  /** Слушать микрофон. */
  enabled: boolean;
  /** Слова активации (есть в словаре Vosk), первое — основное. */
  wakeWords: string[];
  /** Распознавание: GigaAM (процессор, лучше для русского) или Whisper (видеокарта). */
  asr: "gigaam" | "whisper";
  /** Синтез: Piper (лёгкий) или Silero (естественнее, +~600 МБ памяти). */
  ttsEngine: "piper" | "silero";
  /** Голос: Piper — dmitri, ruslan, denis, irina; Silero — aidar, eugene, baya, kseniya, xenia. */
  speaker: string;
  /** Говорить ответы вслух. */
  tts: boolean;
  /** Скорость речи, 0.7–1.5. */
  rate: number;
  /** Громкость голоса относительно системной, 0.2–1. */
  loudness: number;
  /** Микрофон: имя устройства или "" — по умолчанию. */
  mic: string;
  /** Модель Whisper (только для asr = "whisper"). */
  model: string;
  /** Где распознавать: видеокарта, процессор, само выберет. */
  device: "auto" | "cuda" | "cpu";
  /** Игровой режим: видеокарта свободна, распознавание — на процессоре. */
  game: boolean;
  /** Звук, когда Джарвис услышал своё имя. */
  chime: boolean;
  /** После вопроса Джарвиса слушать ответ без слова активации, секунд (0 — нет). */
  followUp: number;
  /** Проверять Whisper'ом, что имя действительно прозвучало (меньше ложных срабатываний). */
  verifyWake: boolean;
  /** Предупреждать о событиях календаря за N минут (0 — нет). */
  announce: number;
  /** Озвучивать напоминания «Расписания» в их время. */
  reminders: boolean;
  /** Поздороваться при запуске. */
  greet: boolean;
  /** Орб на экране: на время разговора, всегда, никогда. */
  overlay: "talk" | "always" | "never";
  /** Где орб: снизу справа, снизу слева, сверху по центру. */
  overlayPos: "br" | "bl" | "tc";
}

export interface Prefs {
  /** Принимать запросы от Алисы. */
  enabled: boolean;
  address: string;
  ai: boolean;
  aiLimit: number;
  morning: Record<MorningPart, boolean>;
  evening: Record<EveningPart, boolean>;
  commands: CustomCommand[];
  /** Сохранять разговоры в историю модуля. */
  history: boolean;
  /** Модель для свободных просьб: fast — быстрее, smart — умнее. */
  brain: "fast" | "smart";
  voice: VoicePrefs;
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

const SILERO_SPEAKERS = ["aidar", "eugene", "baya", "kseniya", "xenia"];

/** Голос выбран до появления Piper (тогда был только Silero) — оставляем Silero. */
function legacyEngine(v: Partial<VoicePrefs> | undefined): Partial<VoicePrefs> {
  return v && !v.ttsEngine && v.speaker && SILERO_SPEAKERS.includes(v.speaker) ? { ttsEngine: "silero" } : {};
}

export function prefs(): Prefs {
  const raw = (db.getKv(MODULE, "config") as Partial<Prefs> | undefined) ?? {};
  return {
    ...DEFAULT_PREFS,
    ...raw,
    morning: { ...DEFAULT_PREFS.morning, ...raw.morning },
    evening: { ...DEFAULT_PREFS.evening, ...raw.evening },
    commands: Array.isArray(raw.commands) ? raw.commands : [],
    voice: { ...DEFAULT_VOICE, ...raw.voice, ...legacyEngine(raw.voice) },
  };
}
