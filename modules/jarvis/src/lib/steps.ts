import type { CustomCommand, Step, StepType } from "./types.ts";

/** Шаги конструктора: как называются, как выглядят в списке и с чего начинаются. */
export const STEPS: Record<StepType, { label: string; icon: string; hint: string; make: () => Step }> = {
  open: { label: "Открыть", icon: "🚀", hint: "Программу, игру, сайт, папку или файл", make: () => ({ type: "open", target: { kind: "lib", value: "" } }) },
  say: { label: "Сказать", icon: "💬", hint: "Джарвис произнесёт фразу", make: () => ({ type: "say", text: "" }) },
  command: { label: "Команда", icon: "⚡", hint: "Любая фраза Джарвису: «что дальше», «громче»…", make: () => ({ type: "command", text: "" }) },
  volume: { label: "Громкость", icon: "🔊", hint: "Поставить уровень звука", make: () => ({ type: "volume", level: 30 }) },
  media: { label: "Музыка", icon: "⏯️", hint: "Пауза, следующий, предыдущий трек", make: () => ({ type: "media", key: "play" }) },
  search: { label: "Поиск", icon: "🔎", hint: "Google, YouTube или Яндекс", make: () => ({ type: "search", where: "youtube", query: "" }) },
  keys: { label: "Клавиши", icon: "⌨️", hint: "Сочетание: ctrl+shift+t, win+d, f11", make: () => ({ type: "keys", combo: "" }) },
  type: { label: "Напечатать", icon: "✍️", hint: "Ввести текст в активное окно", make: () => ({ type: "type", text: "", enter: false }) },
  close: { label: "Закрыть", icon: "✖️", hint: "Закрыть программу по названию", make: () => ({ type: "close", name: "" }) },
  wait: { label: "Пауза", icon: "⏱️", hint: "Подождать, пока что-то загрузится", make: () => ({ type: "wait", seconds: 2 }) },
};

export const STEP_ORDER: StepType[] = ["open", "say", "command", "volume", "media", "search", "keys", "type", "close", "wait"];

const MEDIA = { play: "пауза / играть", next: "следующий трек", prev: "предыдущий трек" };
const WHERE = { google: "Google", youtube: "YouTube", yandex: "Яндекс" };

/** Шаг одной строкой: «Громкость 30», «Открыть Telegram». */
export function summary(s: Step): string {
  switch (s.type) {
    case "say":
      return s.text ? `«${s.text}»` : "сказать…";
    case "command":
      return s.text ? `«${s.text}»` : "команда…";
    case "open":
      return s.target.value ? s.target.label || s.target.value : "что открыть?";
    case "search":
      return `${WHERE[s.where]}: ${s.query || "…"}`;
    case "keys":
      return s.combo || "сочетание…";
    case "type":
      return s.text ? `«${s.text}»${s.enter ? " + Enter" : ""}` : "текст…";
    case "volume":
      return `${s.level}%`;
    case "media":
      return MEDIA[s.key];
    case "close":
      return s.name || "что закрыть?";
    case "wait":
      return `${s.seconds} с`;
  }
}

/** Старые команды (фраза → ответ + цепочка фраз) — в шаги конструктора. */
export function stepsOf(c: CustomCommand): Step[] {
  if (c.steps) return c.steps;
  return [...(c.say.trim() ? [{ type: "say", text: c.say.trim() } as Step] : []), ...c.run.filter((r) => r.trim()).map((text) => ({ type: "command", text }) as Step)];
}

/** Заготовки — только старт, дальше правится под себя. */
export const PRESETS: { title: string; hint: string; cmd: Omit<CustomCommand, "id"> }[] = [
  {
    title: "Режим работы",
    hint: "Тише звук, редактор, почта",
    cmd: {
      phrases: ["режим работы", "работаем"],
      say: "",
      run: [],
      steps: [
        { type: "say", text: "Режим работы. Сосредоточимся." },
        { type: "volume", level: 20 },
        { type: "open", target: { kind: "lib", value: "", label: "" } },
        { type: "open", target: { kind: "url", value: "https://mail.google.com", label: "Почта" } },
      ],
    },
  },
  {
    title: "Режим кино",
    hint: "Громкость повыше и Кинопоиск",
    cmd: {
      phrases: ["режим кино", "кино"],
      say: "",
      run: [],
      steps: [
        { type: "say", text: "Приятного просмотра." },
        { type: "volume", level: 60 },
        { type: "open", target: { kind: "url", value: "https://www.kinopoisk.ru", label: "Кинопоиск" } },
      ],
    },
  },
  {
    title: "Режим учёбы",
    hint: "Тише, задания DevPath, музыка для фокуса",
    cmd: {
      phrases: ["режим учебы", "учимся"],
      say: "",
      run: [],
      steps: [
        { type: "volume", level: 25 },
        { type: "command", text: "что по devpath" },
        { type: "search", where: "youtube", query: "lofi для учёбы" },
      ],
    },
  },
  {
    title: "Я ушёл",
    hint: "Свернуть всё, пауза, что дальше по плану",
    cmd: {
      phrases: ["я ушел", "я ухожу"],
      say: "",
      run: [],
      steps: [
        { type: "media", key: "play" },
        { type: "keys", combo: "win+d" },
        { type: "say", text: "Хорошего пути." },
        { type: "command", text: "что дальше" },
      ],
    },
  },
  {
    title: "Игры",
    hint: "Закрыть лишнее, открыть игру",
    cmd: {
      phrases: ["время игр", "поиграем"],
      say: "",
      run: [],
      steps: [
        { type: "close", name: "браузер" },
        { type: "volume", level: 50 },
        { type: "open", target: { kind: "lib", value: "", label: "" } },
        { type: "say", text: "Удачной игры." },
      ],
    },
  },
];

export const KEY_CHIPS = ["win+d", "alt+tab", "ctrl+shift+t", "ctrl+w", "f11", "win+shift+s", "ctrl+c", "ctrl+v", "alt+f4"];
