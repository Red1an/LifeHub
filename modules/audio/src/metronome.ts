import { getAudioContext } from "./context";
import { playBlip, playClick } from "./click";

export type ClickSound = "click" | "blip" | "none";

export interface MetronomeOptions {
  getBpm: () => number; // read on every tick, so tempo can change live
  subdivision?: number; // clicks per beat
  beatsPerBar?: number;
  sound?: ClickSound;
  startDelay?: number;
  onTick: (time: number, index: number, info: { beat: number; bar: number; sub: number }) => void;
}

/** Lookahead-scheduled metronome on the audio clock. `onTick` fires at schedule time. */
export function startMetronome(options: MetronomeOptions): { stop: () => void } {
  const { subdivision = 1, beatsPerBar = 4, sound = "blip", startDelay = 0.15 } = options;
  const audio = getAudioContext();
  let next = audio.currentTime + startDelay;
  let index = 0;

  const interval = window.setInterval(() => {
    while (next < audio.currentTime + 0.12) {
      const sub = index % subdivision;
      const beatIndex = Math.floor(index / subdivision);
      const beat = beatIndex % beatsPerBar;
      const bar = Math.floor(beatIndex / beatsPerBar);
      const when = Math.max(0, next - audio.currentTime);
      if (sound !== "none" && sub === 0) {
        if (sound === "blip") playBlip(beat === 0, when);
        else playClick(beat === 0, when);
      }
      options.onTick(next, index, { beat, bar, sub });
      next += 60 / options.getBpm() / subdivision;
      index += 1;
    }
  }, 20);

  return { stop: () => window.clearInterval(interval) };
}
