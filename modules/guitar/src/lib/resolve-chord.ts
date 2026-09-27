import { CHORD_SHAPES, movableBarreShape, ChordShape } from "./chord-shapes";
import { splitChord, noteIndex } from "./music-theory";

/** Resolves a chord symbol to a diagram shape, falling back to a movable barre shape. */
export function resolveChordShape(chord: string): ChordShape | null {
  if (CHORD_SHAPES[chord]) return CHORD_SHAPES[chord];

  const { root, suffix } = splitChord(chord);
  const normalized = `${root}${suffix}`;
  if (CHORD_SHAPES[normalized]) return CHORD_SHAPES[normalized];

  const idx = noteIndex(root);
  const eIdx = noteIndex("E");
  const semisFromE = idx - eIdx;

  if (suffix === "" || suffix === "maj") {
    return movableBarreShape(semisFromE, "");
  }
  if (suffix === "m" || suffix === "min") {
    return movableBarreShape(semisFromE, "m");
  }
  // Unknown quality (7th, sus, maj7, etc.) with no hand-authored shape:
  // fall back to the plain major/minor barre shape as a best-effort guide.
  if (suffix.startsWith("m")) {
    return movableBarreShape(semisFromE, "m");
  }
  return movableBarreShape(semisFromE, "");
}
