import { SHARP_NOTES, noteIndex } from "./music-theory";

export type Mode = "major" | "minor";

export interface Degree {
  roman: string;
  semis: number; // from the tonic
  quality: "" | "m";
}

export const MAJOR_DEGREES: Degree[] = [
  { roman: "I", semis: 0, quality: "" },
  { roman: "ii", semis: 2, quality: "m" },
  { roman: "iii", semis: 4, quality: "m" },
  { roman: "IV", semis: 5, quality: "" },
  { roman: "V", semis: 7, quality: "" },
  { roman: "vi", semis: 9, quality: "m" },
];

// Natural minor, but with the major V that most songs use (E in A minor).
export const MINOR_DEGREES: Degree[] = [
  { roman: "i", semis: 0, quality: "m" },
  { roman: "III", semis: 3, quality: "" },
  { roman: "iv", semis: 5, quality: "m" },
  { roman: "V", semis: 7, quality: "" },
  { roman: "VI", semis: 8, quality: "" },
  { roman: "VII", semis: 10, quality: "" },
];

// Guitar-friendly keys spelled entirely with sharps, so chord names stay correct.
export const KEY_ROOTS: Record<Mode, string[]> = {
  major: ["C", "G", "D", "A", "E"],
  minor: ["A", "E", "B"],
};

export function degreesFor(mode: Mode): Degree[] {
  return mode === "major" ? MAJOR_DEGREES : MINOR_DEGREES;
}

export function findDegree(mode: Mode, roman: string): Degree {
  return degreesFor(mode).find((d) => d.roman === roman)!;
}

export function chordName(root: string, degree: Degree): string {
  return `${SHARP_NOTES[(noteIndex(root) + degree.semis) % 12]}${degree.quality}`;
}

export function chordsFor(root: string, mode: Mode, romans: string[]): string[] {
  return romans.map((roman) => chordName(root, findDegree(mode, roman)));
}

export function keyLabel(root: string, mode: Mode): string {
  return `${root} ${mode === "major" ? "мажор" : "минор"}`;
}

/** Chord progressions that real songs lean on, as scale degrees. */
export const COMMON_PROGRESSIONS: Record<Mode, string[][]> = {
  major: [
    ["I", "V", "vi", "IV"],
    ["I", "IV", "V", "IV"],
    ["I", "vi", "IV", "V"],
    ["I", "IV", "I", "V"],
    ["I", "V", "IV", "V"],
    ["I", "ii", "V", "I"],
    ["I", "iii", "IV", "V"],
    ["I", "IV", "vi", "V"],
  ],
  minor: [
    ["i", "VI", "III", "VII"],
    ["i", "iv", "V", "i"],
    ["i", "VII", "VI", "VII"],
    ["i", "iv", "VII", "III"],
    ["i", "VI", "VII", "i"],
    ["i", "V", "iv", "V"],
  ],
};
