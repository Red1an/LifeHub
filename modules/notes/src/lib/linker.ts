import { ai } from "@lifehub/sdk";
import { kindOf } from "./kinds.ts";
import { localKey, preview, titleOf } from "./text.ts";
import type { NoteDoc, Prefs, TopicDoc } from "./types.ts";

/*
 * «Найти связи» для уже разобранных заметок: при разборе связи ищутся только для новых записей,
 * а старые между собой так и остаются несвязанными. Нейронка смотрит на всё сразу и предлагает пары —
 * пользователь отмечает, какие сохранить.
 */

export interface LinkProposal {
  a: string;
  b: string;
  why: string;
}

const SYSTEM = `Ты ищешь реальные связи между личными заметками пользователя, чтобы построить граф его мыслей.
Связь — это та же вещь, человек, проект или место; продолжение или развитие мысли; причина и следствие;
«посоветовал X» и заметка про X. Просто одна тема («обе про кино») — не связь.
Не предлагай пары, которые уже связаны. Лучше 5 точных связей, чем 30 натянутых. Не больше 30.
why — коротко, до 8 слов, почему связаны.`;

/** Сколько заметок отправлять за раз: больше — нейронка начинает пропускать. */
const LIMIT = 160;

export async function findLinks(notes: NoteDoc[], topics: TopicDoc[], prefs: Prefs): Promise<LinkProposal[]> {
  const pool = notes
    .filter((n) => n.status !== "inbox")
    .sort((a, b) => (b.capturedAt ?? b.createdAt) - (a.capturedAt ?? a.createdAt))
    .slice(0, LIMIT);
  const ids = new Set(pool.map((n) => n.id));
  const tn = new Map(topics.map((t) => [t.id, t.name]));
  const existing = new Set<string>();
  for (const n of pool) for (const r of n.related ?? []) existing.add([n.id, r].sort().join("|"));

  const list = pool
    .map((n) => {
      const rel = (n.related ?? []).filter((r) => ids.has(r));
      return `- id=${n.id} ${localKey(new Date(n.capturedAt ?? n.createdAt))} [${kindOf(n).name}${n.topicId ? `, тема ${tn.get(n.topicId) ?? "?"}` : ""}] ${titleOf(n)} — ${preview(n.body, 140)}${rel.length ? ` (уже связана с: ${rel.join(", ")})` : ""}`;
    })
    .join("\n");

  const raw = await ai.json<{ links?: { a?: unknown; b?: unknown; why?: unknown }[] }>(
    `Заметки:\n${list}\n\nВерни JSON: {"links":[{"a":"id","b":"id","why":"почему связаны"}]}`,
    { system: SYSTEM, model: prefs.model },
  );
  const seen = new Set<string>();
  const out: LinkProposal[] = [];
  for (const l of Array.isArray(raw?.links) ? raw.links : []) {
    const a = String(l.a ?? "");
    const b = String(l.b ?? "");
    const k = [a, b].sort().join("|");
    if (a === b || !ids.has(a) || !ids.has(b) || existing.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ a, b, why: String(l.why ?? "").trim() });
  }
  return out.slice(0, 30);
}
