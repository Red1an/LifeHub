import { db, dayKey, kv } from "@lifehub/sdk";
import { WEEKDAYS } from "./time.ts";

/*
 * Данные других модулей для планирования. Каждый модуль открывает их в своём
 * lifehub.json (exports), а здесь нужно разрешение read:<id>. Формат чужих данных
 * может меняться — читаем осторожно, всё поле за полем.
 */

export interface SourceDef {
  id: string;
  label: string;
  icon: string;
  /** Подсказка: что можно попросить с этим источником. */
  hint: string;
  load: () => Promise<string>;
}

export interface SourceState {
  available: boolean;
  text?: string;
  error?: string;
}

const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function fit(): Promise<string> {
  const p = await kv.get<Record<string, unknown> | null>("profile", null, { from: "fit" });
  if (!p || !p.onboarded) throw new Error("В «Форме» ещё не заполнен профиль");
  const goals: Record<string, string> = { strength: "сила", muscle: "мышцы", fatloss: "похудение", health: "здоровье", endurance: "выносливость" };
  const places = Array.isArray(p.places) ? p.places.map((x: any) => str(x?.name)).filter(Boolean) : [];
  return [
    `Модуль «Форма» (тренировки): цель — ${num(p.perWeek, 3)} тренировок в неделю по ~${num(p.minutes, 45)} мин.`,
    p.goal ? `Цель тренировок: ${goals[str(p.goal)] ?? str(p.goal)}.` : "",
    places.length ? `Где тренируется: ${places.join(", ")}.` : "",
    `Рабочее время: ${num(p.workFrom, 9)}:00–${num(p.workTo, 18)}:00; разминок у стола в день: ${num(p.breaksPerDay, 0)}.`,
    "Тренировки лучше ставить не два дня подряд на одни мышцы, оставлять день отдыха, не позже чем за 2 часа до сна.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function devpath(): Promise<string> {
  const goal = await kv.get<Record<string, unknown> | null>("roadmap", null, { from: "devpath" });
  const today = await db.collection<{ quests?: { title?: string; xp?: number; done?: boolean }[] }>("days", { from: "devpath" }).get(dayKey());
  const lines: string[] = [];
  if (goal?.title) lines.push(`Модуль «DevPath» (самообучение программированию): цель «${str(goal.title)}» до ${str(goal.deadline)}.`);
  else lines.push("Модуль «DevPath» (самообучение программированию): цель не выбрана.");
  const quests = today?.quests?.filter((q) => !q.done) ?? [];
  if (quests.length) lines.push(`Невыполненные задания на сегодня: ${quests.map((q) => str(q.title)).join("; ")}.`);
  lines.push("Учёбу лучше ставить блоками по 45–90 минут, регулярно, в часы, когда голова свежая.");
  return lines.join("\n");
}

async function habits(): Promise<string> {
  const list = await db.collection<{ name?: string; icon?: string; days?: number[]; archived?: boolean }>("habits", { from: "habits" }).list();
  const active = list.filter((h) => !h.archived && h.name);
  if (!active.length) throw new Error("В «Привычках» пока пусто");
  return [
    "Модуль «Привычки»: ежедневные привычки пользователя.",
    ...active.map((h) => `- ${h.icon ?? ""} ${h.name} — ${h.days?.length ? h.days.map((d) => WEEKDAYS[d]).join(", ") : "каждый день"}`),
  ].join("\n");
}

export const SOURCES: SourceDef[] = [
  { id: "fit", label: "Форма", icon: "💪", hint: "Поставь тренировки на неделю", load: fit },
  { id: "devpath", label: "DevPath", icon: "🧠", hint: "Распредели учёбу по неделе", load: devpath },
  { id: "habits", label: "Привычки", icon: "🔥", hint: "Найди время для привычек", load: habits },
];

export async function loadSource(s: SourceDef): Promise<SourceState> {
  try {
    return { available: true, text: await s.load() };
  } catch (e) {
    const msg = (e as Error).message;
    if (/не открывает|Неизвестный|404|не найден/i.test(msg)) return { available: false, error: `Обновите или установите модуль «${s.label}»` };
    return { available: false, error: msg };
  }
}
