import { titleOf } from "./text.ts";
import type { NoteDoc } from "./types.ts";

/*
 * Ссылки [[Название]] между заметками (как в Obsidian/Logseq) и обратные ссылки.
 * Ссылка ищет заметку по названию без учёта регистра и «ё»; не нашлась — при нажатии создаётся новая.
 */

export const WIKI_RE = /\[\[([^[\]\n]{1,120})\]\]/g;

export const normName = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

export function titleIndex(notes: NoteDoc[]) {
  const m = new Map<string, NoteDoc>();
  // Свежие перекрывают старые: при одинаковых названиях ссылка ведёт на последнюю.
  for (const n of [...notes].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (n.status === "inbox") continue;
    m.set(normName(titleOf(n)), n);
  }
  return m;
}

/** Названия, на которые ссылается текст. */
export function linkedNames(body: string) {
  return [...body.matchAll(WIKI_RE)].map((m) => m[1].split("|")[0].trim());
}

/**
 * [[Название]] → markdown-ссылка: #nt:<id> — на заметку, #nt-new:<название> — заметки нет.
 * [[Название|текст]] — свой текст ссылки.
 */
export function wikiToMarkdown(body: string, index: Map<string, NoteDoc>) {
  return body.replace(WIKI_RE, (_m, inner: string) => {
    const [name, label] = inner.split("|").map((x) => x.trim());
    const target = index.get(normName(name));
    const text = (label || name).replace(/[[\]]/g, "");
    return target ? `[${text}](#nt:${target.id})` : `[${text}](#nt-new:${encodeURIComponent(name)})`;
  });
}

/** Кто ссылается на заметку через [[…]]. */
export function backlinks(note: NoteDoc, notes: NoteDoc[]) {
  const name = normName(titleOf(note));
  if (!name) return [];
  return notes.filter((n) => n.id !== note.id && n.status !== "inbox" && linkedNames(n.body ?? "").some((x) => normName(x) === name));
}

/** Пары «заметка → заметка» по [[…]] — для графа. */
export function wikiEdges(notes: NoteDoc[]) {
  const index = titleIndex(notes);
  const out: [string, string][] = [];
  for (const n of notes) {
    for (const name of linkedNames(n.body ?? "")) {
      const t = index.get(normName(name));
      if (t && t.id !== n.id) out.push([n.id, t.id]);
    }
  }
  return out;
}
