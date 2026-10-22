import { ask } from "../ai.ts";
import { pc, pcSupported } from "./pc.ts";
import { prefs } from "./prefs.ts";
import type { Reply } from "./skills.ts";

/*
 * Выделенный текст: «переведи выделенное», «объясни это», «перескажи», «исправь ошибки и вставь».
 * Джарвис копирует выделение (буфер обмена пользователя возвращается на место) и отдаёт его Claude.
 */

type Kind = "translate" | "explain" | "summary" | "fix";

const RE =
  /^(переведи|перевод|объясни|поясни|что значит|перескажи|кратко|сократи|исправь( ошибки)?|поправь)( мне)?( пожалуйста)?\s*(выделенное|выделенный текст|выделение|это|этот текст|текст|в выделенном)?(\s+и\s+(вставь|замени|скопируй))?$/;

export function selectionKind(text: string): { kind: Kind; paste: boolean; copy: boolean } | null {
  const m = text.match(RE);
  if (!m) return null;
  // «Переведи» без «выделенное/это» — тоже про выделение, «объясни» без объекта — нет (это вопрос к нейронке).
  if (!m[5] && !/^(переведи|перевод|перескажи|исправь|сократи)/.test(m[1])) return null;
  const v = m[1];
  const kind: Kind = /^(переведи|перевод)/.test(v) ? "translate" : /^(перескажи|кратко|сократи)/.test(v) ? "summary" : /^(исправь|поправь)/.test(v) ? "fix" : "explain";
  return { kind, paste: /вставь|замени/.test(m[7] ?? "") || kind === "fix", copy: /скопируй/.test(m[7] ?? "") };
}

const TASK: Record<Kind, string> = {
  translate:
    "Переведи текст. Если он на русском — на английский, иначе — на русский. Ответь только переводом, без пояснений и кавычек, сохрани абзацы.",
  explain: "Объясни простыми словами, что значит этот текст (или код): 2–4 предложения, по-русски, без markdown.",
  summary: "Перескажи суть текста по-русски в 2–3 предложениях, без markdown.",
  fix: "Исправь орфографию, пунктуацию и явные опечатки. Смысл, стиль и язык не меняй. Ответь только исправленным текстом, без пояснений.",
};

const reply = (text: string, tts = text, quiet = false): Reply => ({ say: { text, tts }, quiet });

export async function handleSelection(spec: { kind: Kind; paste: boolean; copy: boolean }): Promise<Reply> {
  if (!pcSupported) return reply("Это работает только на компьютере.");
  if (!prefs().ai) return reply("Для этого нужна нейронка — включите её в настройках Джарвиса.");
  const sel = await pc<{ text: string; title: string }>("selection.get", {}, 10_000);
  const text = (sel?.text ?? "").trim();
  if (!text) return reply("Ничего не выделено. Выделите текст и повторите.");
  const out = (await ask({ system: TASK[spec.kind], prompt: text.slice(0, 12_000), model: "fast" })).trim();
  if (!out) return reply("Нейронка ничего не ответила.");

  if (spec.paste) {
    await pc("type", { text: out });
    return reply(spec.kind === "fix" ? "Исправил." : "Вставил.", undefined, false);
  }
  if (spec.kind === "translate" || spec.copy) await pc("clipboard.set", { text: out });
  // Длинное — на экран и в буфер, голосом — только начало.
  const short = out.length > 280 ? `${out.slice(0, 260).replace(/\s+\S*$/, "")}… Полностью — в буфере обмена.` : out;
  if (out.length > 280 && spec.kind !== "translate") await pc("clipboard.set", { text: out });
  return { say: { text: out, tts: short } };
}
