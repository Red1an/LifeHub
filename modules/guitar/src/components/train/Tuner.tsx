import { useState } from "react";
import { PitchMeter } from "./PitchMeter";
import { MicGate } from "./MicGate";
import { useMicPitch } from "@modules/audio";
import { playGuitarNote } from "../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import {
  GUITAR_OPEN_STRINGS_MIDI,
  centsFromNearestNote,
  midiToName,
} from "../../lib/music-theory";

const TUNINGS = [
  { id: "standard", label: "Стандарт (EADGBE)", offsets: [0, 0, 0, 0, 0, 0] },
  { id: "drop-d", label: "Drop D", offsets: [-2, 0, 0, 0, 0, 0] },
  { id: "half-down", label: "На полтона ниже", offsets: [-1, -1, -1, -1, -1, -1] },
];

export function Tuner() {
  const { state, pitch, level, start, stop } = useMicPitch();
  const [tuning, setTuning] = useState(TUNINGS[0]);

  const reading = pitch ? centsFromNearestNote(pitch.frequency) : null;
  const strings = GUITAR_OPEN_STRINGS_MIDI.map(
    (midi, index) => midi + tuning.offsets[index]
  );
  const nearestString =
    reading === null
      ? null
      : strings.reduce((best, midi) =>
          Math.abs(midi - reading.midi) < Math.abs(best - reading.midi) ? midi : best
        );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {TUNINGS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTuning(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tuning.id === item.id
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <MicGate state={state} onStart={start} onStop={stop} level={level}>
        <PitchMeter
          cents={reading?.cents ?? null}
          midi={reading?.midi ?? null}
          tolerance={5}
          caption="Дёрни струну"
        />
        {nearestString !== null && (
          <p className="text-center text-sm text-zinc-500">
            Ближайшая струна: <b>{midiToName(nearestString)}</b>
          </p>
        )}
      </MicGate>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
        <p className="mb-3 text-sm text-zinc-500">
          Эталон — нажми, чтобы услышать, как должна звучать струна:
        </p>
        <div className="flex flex-wrap gap-2">
          {strings.map((midi, index) => (
            <button
              key={index}
              onClick={() => {
                void unlockAudio();
                playGuitarNote(midi, { gain: 0.7 });
              }}
              className="flex h-12 w-14 flex-col items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-medium hover:border-emerald-500"
            >
              {midiToName(midi)}
              <span className="text-[10px] text-zinc-500">{index + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
