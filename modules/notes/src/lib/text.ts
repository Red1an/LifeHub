import type { Note } from "./types.ts";

/** Текст без markdown для превью. */
export function preview(body: string, len = 140) {
  return body
    .replace(/https?:\/\/\S+/g, (u) => hostOf(u))
    .replace(/[#>*_`~\-\[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, len);
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Название заметки или первая строка текста. */
export function titleOf(n: Pick<Note, "title" | "body">) {
  return n.title?.trim() || preview(n.body ?? "", 60) || "Без названия";
}

export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, "")))];
}

const STOP = new Set(
  "и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это https http www com ru".split(" "),
);

/** Значимые слова для поиска похожего (грубая основа: первые 5 букв). */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.slice(0, 5));
  }
  return out;
}

export function noteText(n: Pick<Note, "title" | "body" | "tags">) {
  return `${n.title ?? ""} ${n.body ?? ""} ${(n.tags ?? []).join(" ")}`;
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «пт 10 окт, 19:00» */
export function eventWhen(e: { date: string; start?: string; end?: string }) {
  const [y, m, d] = e.date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return e.date;
  const day = `${WEEKDAYS[dt.getDay()]} ${d} ${MONTHS[m - 1]}`;
  return e.start ? `${day}, ${e.start}${e.end ? `–${e.end}` : ""}` : day;
}

/** «12 окт» */
export function shortDate(ymd: string) {
  const [, m, d] = ymd.split("-").map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : ymd;
}

export const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const DAY = 86_400_000;
