// Fretboard shapes for chord diagrams.
// fret: 0 = open string, -1 = muted string. Array is low-E to high-E (6 strings).
// barre: optional { fret, fromString, toString } (string indices 0=low E .. 5=high E)

export interface ChordShape {
  frets: number[]; // length 6, -1 = mute, 0 = open
  fingers?: number[]; // 0 = open/mute, 1-4 = finger number
  baseFret?: number; // fret the diagram starts at, default 1
  barre?: { fret: number; fromString: number; toString: number };
}

export const CHORD_SHAPES: Record<string, ChordShape> = {
  C: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  "C7": { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  D: { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  D7: { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 3, 1, 2] },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  F: {
    frets: [1, 3, 3, 2, 1, 1],
    fingers: [1, 3, 4, 2, 1, 1],
    barre: { fret: 1, fromString: 0, toString: 5 },
  },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  A: { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  A7: { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  B7: { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  Bm: {
    frets: [-1, 2, 4, 4, 3, 2],
    fingers: [0, 1, 3, 4, 2, 1],
    baseFret: 2,
    barre: { fret: 2, fromString: 1, toString: 5 },
  },
  B: {
    frets: [-1, 2, 4, 4, 4, 2],
    fingers: [0, 1, 3, 3, 3, 1],
    baseFret: 2,
    barre: { fret: 2, fromString: 1, toString: 5 },
  },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
  Asus2: { frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  // x33011: the open high e would add an E and turn this back into plain C.
  Csus4: { frets: [-1, 3, 3, 0, 1, 1], fingers: [0, 3, 4, 0, 1, 1] },
};

/**
 * Fallback: builds a movable barre-chord shape (E-shape / Am-shape) for any root
 * when no open-chord diagram is hand-authored above.
 */
export function movableBarreShape(
  rootSemitoneFromE: number,
  quality: "" | "m"
): ChordShape {
  const fret = ((rootSemitoneFromE % 12) + 12) % 12;
  if (fret === 0) {
    return quality === "m"
      ? CHORD_SHAPES.Em
      : CHORD_SHAPES.E;
  }
  if (quality === "m") {
    return {
      frets: [fret, fret + 2, fret + 2, fret, fret, fret],
      baseFret: fret,
      barre: { fret, fromString: 0, toString: 5 },
    };
  }
  return {
    frets: [fret, fret + 2, fret + 2, fret + 1, fret, fret],
    baseFret: fret,
    barre: { fret, fromString: 0, toString: 5 },
  };
}
