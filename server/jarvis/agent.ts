import { ask } from "../ai.ts";
import { pc, pcSupported, windows } from "./pc.ts";
import { searchUrl, openThing } from "./pcskills.ts";
import type { Prefs } from "./prefs.ts";

/*
 * Свободные просьбы — через Claude. Он не вызывает инструменты сам (Claude Code запущен
 * без них), а отвечает планом: что сказать и какие действия выполнить. Действия — это
 * обычные команды Джарвиса (их разбирают правила, со всеми подтверждениями) и несколько
 * прямых: открыть, найти, напечатать.
 */

export type Action =
  | { do: "command"; text: string; speak?: boolean }
  | { do: "open"; target: string }
  | { do: "search"; where?: "google" | "youtube" | "yandex"; query: string }
  | { do: "type"; text: string; enter?: boolean };

export interface Plan {
  say: string;
  actions: Action[];
}

export interface Exchange {
  q: string;
  a: string;
}

const COMMANDS = `Команды Джарвиса (do: "command", text — фраза по-русски, как сказал бы человек):
- компьютер: «открой телеграм», «закрой дискорд», «переключись на хром», «громкость 30», «громче», «тише», «выключи звук», «пауза», «продолжи», «следующий трек», «сверни всё», «закрой вкладку», «яркость 50», «таймер на 10 минут чай», «сделай скриншот», «заблокируй компьютер», «выключи компьютер» (спросит подтверждение), «игровой режим», «сколько заряда»;
- календарь: «поставь тренировку завтра в 7 вечера на час», «напомни через 20 минут выключить плиту», «перенеси тренировку на час позже», «отмени тренировку в пятницу», «что у меня завтра», «что дальше», «когда я свободен в пятницу», «что на неделе», «мои задачи»;
- модули: «потратил 450 на такси», «получил 5000 зарплата», «сколько я потратил за неделю», «отметь воду», «какие привычки остались», «запомни: код от домофона 4512», «что я записывал про домофон», «что по devpath», «что с портфелем», «доброе утро» (сводка дня), «итоги дня».`;

function system(p: Prefs): string {
  return [
    "Ты — Джарвис, личный голосовой помощник пользователя на его компьютере с Windows, в духе Джарвиса из «Железного человека»: собранный, учтивый, с лёгкой иронией.",
    p.address ? `Обращайся к пользователю «${p.address}», но не в каждой фразе.` : "",
    "Твой ответ озвучивается, поэтому say — по-русски, 1–2 коротких предложения, без markdown, списков, ссылок, эмодзи и латиницы, если без неё можно обойтись. Числа пиши цифрами.",
    "Ответь СТРОГО одним JSON-объектом без пояснений вокруг:",
    '{"say": "что сказать", "actions": [ ... ]}',
    "Действия (выполняются по порядку, можно ни одного):",
    '- {"do": "command", "text": "<команда Джарвиса>", "speak": true|false} — speak: true, если ответ команды нужно озвучить (вопросы о данных: «что у меня завтра»), false — для действий (громкость, открыть).',
    '- {"do": "open", "target": "<https-ссылка или путь к папке/файлу>"}',
    '- {"do": "search", "where": "google"|"youtube"|"yandex", "query": "<запрос>"} — открыть поиск в браузере (музыка и видео — youtube).',
    '- {"do": "type", "text": "<текст>", "enter": false} — напечатать текст в активное окно (письмо, сообщение, ответ). enter: true — сразу отправить.',
    COMMANDS,
    "Правила:",
    "- Если просьбу можно выполнить командами — выполни, а say сделай коротким подтверждением («Сделано.», «Включаю что-нибудь для концентрации.»). Ответы команд с speak: true прозвучат после say — не дублируй их.",
    "- Если нужны данные, которых нет в контексте (траты, заметки, события дальше недели), — вызови команду-вопрос со speak: true, а say оставь пустым.",
    "- Просят текст (письмо, пост, ответ в чат) — сочини и напечатай через type, в say скажи, что напечатал.",
    "- На вопросы и болтовню отвечай сам, без действий. Чего-то не можешь — честно скажи в say.",
    "- Никогда не выключай и не перезагружай компьютер, если об этом не просили прямо.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function pcContext(): Promise<string> {
  if (!pcSupported) return "";
  try {
    const [w, v] = await Promise.all([windows(), pc<{ level: number; muted: boolean }>("volume.get")]);
    const active = w.items.find((x) => x.pid === w.active);
    const open = [...new Set(w.items.map((x) => x.desc || x.name))].slice(0, 12);
    return [
      `Компьютер: громкость ${v.level}${v.muted ? " (выключен звук)" : ""}.`,
      active ? `Активное окно: ${active.desc || active.name} — «${active.title.slice(0, 80)}».` : "",
      open.length ? `Открыты: ${open.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

export function parsePlan(raw: string): Plan {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(text.slice(start, end + 1));
      const actions = (Array.isArray(j.actions) ? j.actions : []).filter((a: any) => a && typeof a.do === "string").slice(0, 6);
      return { say: typeof j.say === "string" ? j.say : "", actions };
    } catch {}
  }
  return { say: text.replace(/[*_#`]/g, ""), actions: [] };
}

export async function makePlan(question: string, ctx: { prefs: Prefs; dayContext: string; history: Exchange[]; custom: string[] }): Promise<Plan> {
  const pcCtx = await pcContext();
  const history = ctx.history
    .slice(-6)
    .map((h) => `Пользователь: ${h.q}\nДжарвис: ${h.a}`)
    .join("\n");
  const prompt = [
    ctx.dayContext,
    pcCtx,
    ctx.custom.length ? `Свои команды пользователя (тоже можно вызывать через command): ${ctx.custom.join("; ")}.` : "",
    history ? `Недавний разговор:\n${history}` : "",
    `Пользователь: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const out = await ask({ system: system(ctx.prefs), prompt, model: ctx.prefs.brain === "smart" ? "smart" : "fast" });
  return parsePlan(out);
}

/** Прямые действия плана (команды выполняет index.ts — через общий разбор). */
export async function runDirect(a: Action, hubUrl: string): Promise<void> {
  if (a.do === "open") {
    const target = String(a.target ?? "");
    if (/^https?:\/\//i.test(target) || /^[a-z]:\\/i.test(target)) await pc("open", { target });
    else await openThing(target, hubUrl);
  } else if (a.do === "search") {
    const where = a.where === "youtube" || a.where === "yandex" ? a.where : "google";
    await pc("open", { target: searchUrl(where, String(a.query ?? "")) });
  } else if (a.do === "type") {
    await pc("type", { text: String(a.text ?? ""), enter: !!a.enter });
  }
}
