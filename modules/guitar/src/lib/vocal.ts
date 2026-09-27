export const VOICE_RANGES = [
  { id: "low", label: "Низкий голос", root: 48 }, // C3
  { id: "mid", label: "Средний", root: 53 }, // F3
  { id: "high", label: "Высокий", root: 60 }, // C4
];

export type VoiceRange = (typeof VOICE_RANGES)[number];

export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export interface SungNote {
  start: number;
  end: number;
  midi: number;
}

export interface NoteVerdict {
  medianCents: number | null;
  coverage: number; // share of the note where a pitch was heard
  hit: boolean;
}

/**
 * Judges one sung note from pitch samples. The first quarter of the note is
 * ignored — that is where the voice is still arriving — and the median keeps
 * a scooped start or a crack from dominating.
 */
export function judgeNote(
  samples: { t: number; midi: number | null }[],
  note: SungNote,
  toleranceCents = 35
): NoteVerdict {
  const from = note.start + (note.end - note.start) * 0.25;
  const inside = samples.filter((s) => s.t >= from && s.t <= note.end);
  const voiced = inside.flatMap((s) => (s.midi === null ? [] : [(s.midi - note.midi) * 100]));
  const coverage = inside.length ? voiced.length / inside.length : 0;
  if (voiced.length < 3) return { medianCents: null, coverage, hit: false };
  // Singing the right note in another octave is still off: keep raw cents.
  const sorted = [...voiced].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  return { medianCents: median, coverage, hit: coverage >= 0.4 && Math.abs(median) <= toleranceCents };
}
