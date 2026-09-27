import { transposeChord } from "./music-theory";

export interface ChordToken {
  chord: string;
  text: string; // lyric text that follows this chord until the next one
}

export interface ParsedLine {
  type: "lyric" | "section" | "blank";
  tokens: ChordToken[];
  label?: string; // for section headers like "Куплет 1"
}

const SECTION_RE = /^\s*\[\[(.+)\]\]\s*$/; // [[Chorus]] on its own line
const CHORD_RE = /\[([^\]]+)\]/g;

/** Parses ChordPro-lite text: "[G]Amazing [C]grace" and "[[Section]]" headers. */
export function parseChordPro(source: string): ParsedLine[] {
  return source.replace(/\r\n/g, "\n").split("\n").map((rawLine): ParsedLine => {
    if (rawLine.trim() === "") return { type: "blank", tokens: [] };

    const sectionMatch = rawLine.match(SECTION_RE);
    if (sectionMatch) {
      return { type: "section", tokens: [], label: sectionMatch[1] };
    }

    const tokens: ChordToken[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let pendingChord: string | null = null;
    CHORD_RE.lastIndex = 0;

    while ((match = CHORD_RE.exec(rawLine))) {
      const textBefore = rawLine.slice(lastIndex, match.index);
      if (pendingChord !== null || textBefore !== "") {
        tokens.push({ chord: pendingChord ?? "", text: textBefore });
      }
      pendingChord = match[1];
      lastIndex = CHORD_RE.lastIndex;
    }
    const rest = rawLine.slice(lastIndex);
    tokens.push({ chord: pendingChord ?? "", text: rest });

    return { type: "lyric", tokens };
  });
}

export function transposeLines(lines: ParsedLine[], semitones: number, preferFlats = false): ParsedLine[] {
  if (semitones === 0) return lines;
  return lines.map((line) => ({
    ...line,
    tokens: line.tokens.map((t) => ({
      ...t,
      chord: t.chord ? transposeChord(t.chord, semitones, preferFlats) : t.chord,
    })),
  }));
}

export function extractUniqueChords(lines: ParsedLine[]): string[] {
  const set = new Set<string>();
  for (const line of lines) {
    for (const t of line.tokens) {
      if (t.chord) set.add(t.chord);
    }
  }
  return Array.from(set);
}
