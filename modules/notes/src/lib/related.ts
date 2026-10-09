import { noteText, terms } from "./text.ts";
import type { NoteDoc } from "./types.ts";

/**
 * Похожие заметки по пересечению значимых слов и тегов — без эмбеддингов.
 * Используется для кандидатов в связи при разборе и для подсказок «может быть связано».
 */
export function similar(text: string, tags: string[], pool: NoteDoc[], limit = 20, exclude: Set<string> = new Set()) {
  const a = terms(text);
  const t = new Set(tags.map((x) => x.toLowerCase()));
  const scored: { note: NoteDoc; score: number }[] = [];
  for (const n of pool) {
    if (exclude.has(n.id)) continue;
    const b = terms(noteText(n));
    let common = 0;
    for (const w of a) if (b.has(w)) common++;
    const tagHits = (n.tags ?? []).filter((x) => t.has(x.toLowerCase())).length;
    const score = common / Math.sqrt(Math.max(1, a.size) * Math.max(1, b.size)) + tagHits * 0.3;
    if (score > 0.08) scored.push({ note: n, score });
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** Патчи related для обеих сторон связи (без дублей). */
export function linkPatches(notes: Map<string, NoteDoc>, pairs: [string, string][]) {
  const next = new Map<string, Set<string>>();
  const get = (id: string) => {
    let s = next.get(id);
    if (!s) next.set(id, (s = new Set(notes.get(id)?.related ?? [])));
    return s;
  };
  for (const [a, b] of pairs) {
    if (a === b || !notes.has(a) || !notes.has(b)) continue;
    get(a).add(b);
    get(b).add(a);
  }
  const out: { id: string; related: string[] }[] = [];
  for (const [id, set] of next) {
    const before = notes.get(id)?.related ?? [];
    if (set.size !== before.length) out.push({ id, related: [...set] });
  }
  return out;
}
