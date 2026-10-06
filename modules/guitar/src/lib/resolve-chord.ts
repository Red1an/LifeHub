import type { ChordShape } from "./chord-shapes";
import { bestShape } from "./chords";

/** Аппликатура для любого обозначения аккорда (самая удобная из найденных движком в lib/chords.ts). */
export function resolveChordShape(chord: string): ChordShape | null {
  return bestShape(chord);
}
