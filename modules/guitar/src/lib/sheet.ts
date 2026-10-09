import { isEasy, looksLikeChord, parseChord, transpose } from "./chords";

/*
 * Текст песни в одной модели для любых источников:
 *  - Ultimate Guitar: аккорды размечены [ch]Am[/ch] над строками слов, блоки [tab]…[/tab];
 *  - свой ChordPro-lite: «[G]слова [C]дальше», секции [[Припев]];
 *  - просто вставленный текст: строки из одних аккордов над словами, табулатуры e|---.
 * Аккорды хранятся с колонкой (позиция над словами), поэтому их можно транспонировать
 * и переносить строки под ширину экрана, не сбивая аккорды со слов.
 */

export interface Chunk {
  col: number;
  chord: string;
}

export type SheetLine =
  | { t: "section"; label: string }
  | { t: "pair"; chords: Chunk[]; lyric: string }
  | { t: "text"; text: string }
  | { t: "tab"; lines: string[] }
  | { t: "blank" };

const SECTION_RU: [RegExp, string][] = [
  [/^pre[- ]?chorus/i, "Предприпев"],
  [/^chorus/i, "Припев"],
  [/^verse/i, "Куплет"],
  [/^intro/i, "Вступление"],
  [/^outro/i, "Концовка"],
  [/^bridge/i, "Бридж"],
  [/^(instrumental|interlude)/i, "Проигрыш"],
  [/^solo/i, "Соло"],
  [/^riff/i, "Рифф"],
  [/^hook/i, "Хук"],
  [/^coda|^ending/i, "Концовка"],
  [/^tab/i, "Таб"],
];

export function sectionLabel(raw: string): string {
  const s = raw.trim().replace(/:$/, "");
  for (const [re, ru] of SECTION_RU) {
    const m = s.match(re);
    if (m) return ru + s.slice(m[0].length).replace(/^\s*/, " ").trimEnd();
  }
  return s;
}

const TAB_LINE = /^\s*([a-gA-G][#b]?\s*)?[|:]?[-–0-9hpbrxvt\/\\~|().*^<>=sSPM ]{5,}$/;
const isTabLine = (line: string) => TAB_LINE.test(line) && (line.match(/-/g)?.length ?? 0) >= 5 && /\|/.test(line);

const SECTION_LINE = /^\s*\[([^\]\[]{1,40})\]\s*$/;
const RU_SECTION = /^\s*(куплет|припев|вступление|проигрыш|бридж|кода|концовка|соло|предприпев|аутро|интро)[\s\d.:]*$/i;

/** Строка из одних аккордов (без разметки) → аккорды с колонками. */
function bareChordLine(line: string): Chunk[] | null {
  const tokens = [...line.matchAll(/\S+/g)];
  if (!tokens.length) return null;
  const chunks: Chunk[] = [];
  for (const m of tokens) {
    const tok = m[0];
    if (/^(\||x\d+|\d+x|\(x?\d+\)|-+|\/|%|\.+|N\.?C\.?)$/i.test(tok)) continue;
    if (!looksLikeChord(tok)) return null;
    chunks.push({ col: m.index!, chord: tok });
  }
  return chunks.length ? chunks : null;
}

/** Строка с разметкой [ch]…[/ch] → аккорды с колонками и остаток текста. */
function markedLine(line: string): { chunks: Chunk[]; rest: string } {
  const chunks: Chunk[] = [];
  let out = "";
  const re = /\[ch\](.*?)\[\/ch\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    out += line.slice(last, m.index);
    chunks.push({ col: out.length, chord: m[1].trim() });
    out += m[1].trim();
    last = re.lastIndex;
  }
  out += line.slice(last);
  // Пометка повтора «×2» в строке аккордов — тоже элемент строки (показывается приглушённо).
  for (const r of out.matchAll(/×\d+/g)) if (!chunks.some((c) => r.index! >= c.col && r.index! < c.col + c.chord.length)) chunks.push({ col: r.index!, chord: r[0] });
  chunks.sort((a, b) => a.col - b.col);
  let rest = out;
  for (const c of [...chunks].reverse()) rest = rest.slice(0, c.col) + " ".repeat(c.chord.length) + rest.slice(c.col + c.chord.length);
  return { chunks, rest };
}

function parsePlain(body: string): SheetLine[] {
  const src = body.replace(/\r\n?/g, "\n").replace(/\[\/?tab\]/g, "").replace(/\t/g, "    ");
  const lines = src.split("\n");
  const out: SheetLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (!line.trim()) {
      if (out.length && out[out.length - 1].t !== "blank") out.push({ t: "blank" });
      continue;
    }
    const sec = line.match(SECTION_LINE);
    if (sec && !line.includes("[ch]")) {
      out.push({ t: "section", label: sectionLabel(sec[1]) });
      continue;
    }
    if (RU_SECTION.test(line)) {
      out.push({ t: "section", label: line.trim().replace(/:$/, "") });
      continue;
    }
    if (isTabLine(line)) {
      const block = [line];
      while (i + 1 < lines.length && isTabLine(lines[i + 1].replace(/\s+$/, ""))) block.push(lines[++i].replace(/\s+$/, ""));
      out.push({ t: "tab", lines: block });
      continue;
    }
    let chunks: Chunk[] | null = null;
    let restText = "";
    if (line.includes("[ch]")) {
      const r = markedLine(line);
      chunks = r.chunks;
      restText = r.rest;
    } else {
      chunks = bareChordLine(line);
    }
    if (chunks && chunks.length) {
      // Если кроме аккордов на строке есть слова (редко) — оставляем строку текстом с аккордами.
      const leftover = restText.replace(/[\s|x\d()\-.%/]+/gi, "");
      if (leftover.length > 2) {
        out.push({ t: "pair", chords: chunks, lyric: restText });
        continue;
      }
      const next = lines[i + 1]?.replace(/\s+$/, "") ?? "";
      const nextIsLyric =
        next.trim() !== "" && !next.includes("[ch]") && !SECTION_LINE.test(next) && !isTabLine(next) && !bareChordLine(next) && !RU_SECTION.test(next);
      if (nextIsLyric) {
        out.push({ t: "pair", chords: chunks, lyric: next });
        i++;
      } else {
        out.push({ t: "pair", chords: chunks, lyric: "" });
      }
      continue;
    }
    out.push({ t: "text", text: line });
  }
  while (out.length && out[out.length - 1].t === "blank") out.pop();
  return out;
}

function parseChordPro(body: string): SheetLine[] {
  const out: SheetLine[] = [];
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      if (out.length && out[out.length - 1].t !== "blank") out.push({ t: "blank" });
      continue;
    }
    const sec = line.match(/^\s*\[\[(.+)\]\]\s*$/) ?? line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec && !parseChord(sec[1])) {
      out.push({ t: "section", label: sectionLabel(sec[1]) });
      continue;
    }
    const chunks: Chunk[] = [];
    let lyric = "";
    let last = 0;
    const re = /\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      lyric += line.slice(last, m.index);
      if (!parseChord(m[1])) {
        // Не аккорд (пометка в скобках) — оставляем как текст.
        lyric += m[0];
        last = re.lastIndex;
        continue;
      }
      const prev = chunks[chunks.length - 1];
      // Аккорды не должны налезать друг на друга: при необходимости раздвигаем слова.
      const minCol = prev ? prev.col + prev.chord.length + 1 : 0;
      if (lyric.length < minCol) lyric += " ".repeat(minCol - lyric.length);
      chunks.push({ col: lyric.length, chord: m[1] });
      last = re.lastIndex;
    }
    lyric += line.slice(last);
    out.push(chunks.length ? { t: "pair", chords: chunks, lyric: lyric.trim() ? lyric : "" } : { t: "text", text: line });
  }
  return out;
}

export type SheetFormat = "chordpro" | "plain";

export function detectFormat(body: string): SheetFormat {
  if (body.includes("[ch]")) return "plain";
  if (/\[\[[^\]]+\]\]/.test(body) || /\[[A-H][#b]?[^\]\s]{0,8}\][^\n]*[a-zа-яё]/i.test(body)) return "chordpro";
  return "plain";
}

export function parseSheet(body: string, format: SheetFormat = detectFormat(body)): SheetLine[] {
  return format === "chordpro" ? parseChordPro(body) : parsePlain(body);
}

export function transposeSheet(lines: SheetLine[], semis: number, flats = false): SheetLine[] {
  if (!semis) return lines;
  return lines.map((l) => (l.t === "pair" ? { ...l, chords: l.chords.map((c) => ({ ...c, chord: transpose(c.chord, semis, flats) })) } : l));
}

/** Аккорды песни в порядке появления. */
export function sheetChords(lines: SheetLine[]): string[] {
  const seen = new Set<string>();
  for (const l of lines) if (l.t === "pair") for (const c of l.chords) if (parseChord(c.chord)) seen.add(c.chord);
  return [...seen];
}

/** Основной ход аккордов (для практики и аккомпанемента): первая часть с 3+ разными аккордами. */
export function mainProgression(lines: SheetLine[]): string[] {
  const parts: string[][] = [[]];
  for (const l of lines) {
    if (l.t === "section" || l.t === "blank") parts.push([]);
    if (l.t === "pair") for (const c of l.chords) if (parseChord(c.chord)) parts[parts.length - 1].push(c.chord);
  }
  const clean = (seq: string[]) => seq.filter((c, i) => c !== seq[i - 1]);
  const good = parts.map(clean).find((p) => new Set(p).size >= 3) ?? clean(parts.flat());
  // Повторяющийся цикл — берём одну итерацию.
  for (let n = 2; n <= Math.min(8, good.length / 2); n++) {
    if (good.slice(0, n).join() === good.slice(n, 2 * n).join()) return good.slice(0, n);
  }
  return good.slice(0, 8);
}

/** Тональность по аккордам: первый аккорд, если он же встречается чаще всего в конце строк, иначе самый частый. */
export function guessKey(lines: SheetLine[]): string | null {
  const counts = new Map<string, number>();
  const firsts: string[] = [];
  for (const l of lines) if (l.t === "pair" && l.chords.length) {
    firsts.push(l.chords[0].chord);
    for (const c of l.chords) counts.set(c.chord, (counts.get(c.chord) ?? 0) + 1);
  }
  if (!firsts.length) return null;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const first = firsts[0];
  const pick = (counts.get(first) ?? 0) >= (counts.get(top) ?? 0) * 0.6 ? first : top;
  const p = parseChord(pick);
  if (!p) return null;
  return p.rootName + (p.suffix.startsWith("m") && !p.suffix.startsWith("maj") ? "m" : "");
}

export interface CapoOption {
  capo: number;
  chords: string[];
  hard: number;
}

/** Каподастр, при котором аккорды песни играются проще всего (меньше баррэ). */
export function capoOptions(chords: string[]): CapoOption[] {
  const options: CapoOption[] = [];
  for (let capo = 0; capo <= 7; capo++) {
    const shapes = chords.map((c) => transpose(c, -capo));
    const hard = shapes.filter((c) => !isEasy(c)).length;
    options.push({ capo, chords: shapes, hard });
  }
  return options.sort((a, b) => a.hard - b.hard || a.capo - b.capo);
}

/* ───────────── перенос строк под ширину экрана ───────────── */

/** Строка аккордов в текстовом виде (для измерения и копирования). */
export function placeChords(chunks: Chunk[]): { col: number; chord: string }[] {
  let end = 0;
  return chunks.map((c) => {
    const col = Math.max(c.col, end);
    end = col + c.chord.length + 1;
    return { col, chord: c.chord };
  });
}

export function wrapPair(chunks: Chunk[], lyric: string, cols: number): { chords: Chunk[]; lyric: string }[] {
  const out: { chords: Chunk[]; lyric: string }[] = [];
  let ch = placeChords(chunks);
  let ly = lyric;
  const width = () => Math.max(ly.length, ...ch.map((c) => c.col + c.chord.length));
  let guard = 0;
  while (width() > cols && guard++ < 50) {
    let cut = -1;
    for (let c = cols; c >= Math.floor(cols * 0.45); c--) {
      const spaceOk = c >= ly.length || ly[c] === " " || ly[c - 1] === " ";
      const chordOk = ch.every((x) => !(x.col < c && c < x.col + x.chord.length));
      if (spaceOk && chordOk) {
        cut = c;
        break;
      }
    }
    if (cut < 0) {
      // Длинное слово без пробелов: режем перед аккордом или по ширине.
      const crossing = ch.find((x) => x.col < cols && cols < x.col + x.chord.length);
      cut = crossing && crossing.col > 0 ? crossing.col : cols;
    }
    out.push({ chords: ch.filter((x) => x.col < cut), lyric: ly.slice(0, cut).trimEnd() });
    let rest = ly.slice(cut);
    let restCh = ch.filter((x) => x.col >= cut).map((x) => ({ ...x, col: x.col - cut }));
    const lead = Math.min(rest.length - rest.trimStart().length, ...restCh.map((x) => x.col));
    if (lead > 0 && Number.isFinite(lead)) {
      rest = rest.slice(lead);
      restCh = restCh.map((x) => ({ ...x, col: x.col - lead }));
    }
    ly = rest;
    ch = restCh;
  }
  out.push({ chords: ch, lyric: ly });
  return out;
}

/** Табулатура шире экрана — переносим целыми тактами, повторяя названия струн. */
export function wrapTab(lines: string[], cols: number): string[][] {
  const len = Math.max(...lines.map((l) => l.length));
  if (len <= cols) return [lines];
  const prefixOf = (l: string) => l.match(/^\s*[a-gA-G][#b]?\s*[|:]?/)?.[0] ?? "";
  const prefixes = lines.map(prefixOf);
  const pw = Math.max(...prefixes.map((p) => p.length));
  const padded = lines.map((l) => l.padEnd(len, " "));
  const blocks: string[][] = [];
  let start = 0;
  let first = true;
  while (start < len) {
    const room = cols - (first ? 0 : pw);
    if (len - start <= room) {
      blocks.push(padded.map((l, i) => (first ? "" : prefixes[i].padEnd(pw)) + l.slice(start)));
      break;
    }
    let cut = -1;
    for (let c = start + room; c > start + room * 0.4; c--) if (padded.every((l) => l[c] === "|")) { cut = c + 1; break; }
    if (cut < 0) for (let c = start + room; c > start + room * 0.4; c--) if (padded.every((l) => l[c] === "-" || l[c] === " ")) { cut = c; break; }
    if (cut < 0) cut = start + room;
    blocks.push(padded.map((l, i) => (first ? "" : prefixes[i].padEnd(pw)) + l.slice(start, cut)));
    start = cut;
    first = false;
  }
  return blocks;
}
