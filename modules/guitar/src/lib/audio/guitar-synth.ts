import { renderPluck } from "@modules/audio";
import { getAudioContext, getGuitarBus } from "@modules/audio";
import { midiToFreq, GUITAR_OPEN_STRINGS_MIDI } from "../music-theory";

const NOTE_SECONDS = 2.6;
const bufferCache = new Map<number, AudioBuffer>();

function getPluckBuffer(midi: number): AudioBuffer {
  const key = Math.round(midi);
  const cached = bufferCache.get(key);
  if (cached) return cached;

  const audio = getAudioContext();
  const frequency = midiToFreq(key);
  const samples = renderPluck({
    sampleRate: audio.sampleRate,
    frequency,
    duration: NOTE_SECONDS,
    // Wound low strings are darker; plain high strings ring brighter.
    brightness: 0.35 + 0.4 * Math.min(1, Math.max(0, (key - 40) / 36)),
    damping: 0.9965,
  });

  const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
  buffer.getChannelData(0).set(samples);
  bufferCache.set(key, buffer);
  return buffer;
}

export interface PlayNoteOptions {
  when?: number; // seconds from now
  gain?: number;
  duration?: number; // cuts the note short with a fade
}

export function playGuitarNote(midi: number, options: PlayNoteOptions = {}) {
  const { when = 0, gain = 0.7, duration } = options;
  const audio = getAudioContext();
  const source = audio.createBufferSource();
  source.buffer = getPluckBuffer(midi);

  const amp = audio.createGain();
  const startAt = audio.currentTime + Math.max(0, when);
  amp.gain.setValueAtTime(gain, startAt);

  source.connect(amp).connect(getGuitarBus());
  // start() must precede stop(), or the browser throws InvalidStateError.
  source.start(startAt);

  if (duration !== undefined) {
    const stopAt = startAt + duration;
    amp.gain.setValueAtTime(gain, Math.max(startAt, stopAt - 0.08));
    amp.gain.linearRampToValueAtTime(0.0001, stopAt);
    source.stop(stopAt + 0.02);
  }

  return source;
}

export function playGuitarNotes(
  midis: number[],
  options: PlayNoteOptions = {}
) {
  midis.forEach((m) => playGuitarNote(m, { ...options, gain: (options.gain ?? 0.7) * 0.75 }));
}

/** Plays notes one after another — used for melodic interval and scale drills. */
export function playSequence(
  midis: number[],
  noteGap = 0.55,
  options: PlayNoteOptions = {}
) {
  midis.forEach((m, i) =>
    playGuitarNote(m, { ...options, when: (options.when ?? 0) + i * noteGap })
  );
}

/**
 * Strums a chord shape. `frets` is low-E-first, -1 for a muted string,
 * matching the ChordShape format used by the diagrams.
 */
export function strumChord(
  frets: number[],
  options: PlayNoteOptions & { direction?: "down" | "up"; spread?: number } = {}
) {
  const { direction = "down", spread = 0.022, when = 0, gain = 0.55 } = options;
  const order = frets.map((fret, index) => ({ fret, index }));
  const sequence = direction === "down" ? order : [...order].reverse();

  let voice = 0;
  for (const { fret, index } of sequence) {
    if (fret < 0) continue;
    const midi = GUITAR_OPEN_STRINGS_MIDI[index] + fret;
    playGuitarNote(midi, {
      when: when + voice * spread,
      // Let the bass strings sit slightly louder, as in a real strum.
      gain: gain * (index < 2 ? 1 : 0.85),
    });
    voice++;
  }
}

export function midiForString(stringIndex: number, fret: number): number {
  return GUITAR_OPEN_STRINGS_MIDI[stringIndex] + fret;
}
