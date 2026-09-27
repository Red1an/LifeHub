import { getAudioContext } from "@modules/audio";
import { playClick } from "@modules/audio";
import { playGuitarNote, strumChord } from "./guitar-synth";
import { resolveChordShape } from "../resolve-chord";
import { noteIndex, splitChord } from "../music-theory";

export interface BackingOptions {
  chords: string[]; // one chord per bar of 4/4
  bpm: number;
  loop?: boolean;
  click?: boolean;
  countIn?: boolean;
  volume?: number;
  onBar?: (bar: number) => void; // -1 during the count-in
  onBeat?: (beat: number) => void;
  onEnd?: () => void;
}

// Strum on eighth notes: Д . Д В . В Д В — the everyday pop/folk pattern.
const STRUMS: { eighth: number; direction: "down" | "up"; weight: number }[] = [
  { eighth: 0, direction: "down", weight: 1 },
  { eighth: 2, direction: "down", weight: 0.7 },
  { eighth: 3, direction: "up", weight: 0.55 },
  { eighth: 5, direction: "up", weight: 0.55 },
  { eighth: 6, direction: "down", weight: 0.7 },
  { eighth: 7, direction: "up", weight: 0.5 },
];

function bassMidi(chord: string): number {
  const { root } = splitChord(chord);
  return 40 + ((noteIndex(root) - 4 + 12) % 12); // E2..D#3
}

/** Plays a strummed chord progression with a bass line. Returns a stop handle. */
export function startBacking(options: BackingOptions): { stop: () => void } {
  const { chords, bpm, loop = false, click = false, countIn = false, volume = 1 } = options;
  const audio = getAudioContext();
  const eighth = 60 / bpm / 2;
  const countInEighths = countIn ? 8 : 0;
  const totalEighths = chords.length * 8;

  let nextTime = audio.currentTime + 0.12;
  let step = 0;
  let stopped = false;

  const later = (fn: () => void, when: number) => {
    window.setTimeout(() => {
      if (!stopped) fn();
    }, Math.max(0, when * 1000));
  };

  const interval = window.setInterval(() => {
    while (nextTime < audio.currentTime + 0.15) {
      const when = Math.max(0, nextTime - audio.currentTime);

      if (step < countInEighths) {
        if (step % 2 === 0) {
          const beat = step / 2;
          playClick(beat === 0, when);
          later(() => {
            options.onBar?.(-1);
            options.onBeat?.(beat);
          }, when);
        }
      } else {
        const local = step - countInEighths;
        if (!loop && local >= totalEighths) {
          window.clearInterval(interval);
          later(() => options.onEnd?.(), when);
          return;
        }

        const position = local % totalEighths;
        const bar = Math.floor(position / 8);
        const eighthInBar = position % 8;
        const chord = chords[bar];
        const shape = resolveChordShape(chord);
        const strum = STRUMS.find((s) => s.eighth === eighthInBar);

        if (strum && shape) {
          // Up-strums catch only the treble strings, as a real hand does.
          const frets =
            strum.direction === "up"
              ? shape.frets.map((fret, index) => (index < 2 ? -1 : fret))
              : shape.frets;
          strumChord(frets, {
            when,
            direction: strum.direction,
            gain: 0.3 * strum.weight * volume,
            spread: strum.direction === "up" ? 0.012 : 0.018,
          });
        }
        if (eighthInBar === 0) {
          playGuitarNote(bassMidi(chord), { when, gain: 0.5 * volume, duration: eighth * 3.6 });
        }
        if (eighthInBar === 4) {
          playGuitarNote(bassMidi(chord) + 7, { when, gain: 0.38 * volume, duration: eighth * 3.6 });
        }
        if (click && eighthInBar % 2 === 0) {
          playClick(eighthInBar === 0, when, 0.45);
        }
        if (eighthInBar % 2 === 0) {
          later(() => {
            if (eighthInBar === 0) options.onBar?.(bar);
            options.onBeat?.(eighthInBar / 2);
          }, when);
        }
      }

      nextTime += eighth;
      step += 1;
    }
  }, 25);

  return {
    stop: () => {
      stopped = true;
      window.clearInterval(interval);
    },
  };
}

/** One strum of a chord — for auditioning answer options. */
export function auditionChord(chord: string, gain = 0.5) {
  const shape = resolveChordShape(chord);
  if (!shape) return;
  playGuitarNote(bassMidi(chord), { gain: 0.45, duration: 1.4 });
  strumChord(shape.frets, { gain });
}
