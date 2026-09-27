import { useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { useMicPitch } from "@modules/audio";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { freqToMidiFloat, midiToName, midiToSolfege } from "../../../lib/music-theory";

const VOICE_TYPES = [
  { label: "Бас", min: 40, max: 62 },
  { label: "Баритон", min: 43, max: 65 },
  { label: "Тенор", min: 48, max: 69 },
  { label: "Альт", min: 53, max: 74 },
  { label: "Меццо-сопрано", min: 55, max: 77 },
  { label: "Сопрано", min: 60, max: 81 },
];

function classifyVoice(low: number, high: number): string {
  let best = VOICE_TYPES[0];
  let bestScore = -Infinity;
  for (const type of VOICE_TYPES) {
    // Overlap between the sung range and each reference range.
    const overlap = Math.min(high, type.max) - Math.max(low, type.min);
    if (overlap > bestScore) {
      bestScore = overlap;
      best = type;
    }
  }
  return best.label;
}

export default function VocalRangeTrainer() {
  const { state, pitch, level, start, stop } = useMicPitch();
  const [lowest, setLowest] = useState<number | null>(null);
  const [highest, setHighest] = useState<number | null>(null);
  const stableRef = useRef<{ midi: number; frames: number } | null>(null);

  const currentMidi = pitch ? freqToMidiFloat(pitch.frequency) : null;

  // Only count a note once it has held steady for a few frames, so a squeak
  // or a cracking voice does not set a fake record.
  useEffect(() => {
    if (currentMidi === null) {
      stableRef.current = null;
      return;
    }
    const rounded = Math.round(currentMidi);
    const tracked = stableRef.current;
    if (tracked && Math.abs(tracked.midi - rounded) <= 1) {
      tracked.frames += 1;
      if (tracked.frames === 8) {
        setLowest((value) => (value === null ? rounded : Math.min(value, rounded)));
        setHighest((value) => (value === null ? rounded : Math.max(value, rounded)));
      }
    } else {
      stableRef.current = { midi: rounded, frames: 1 };
    }
  }, [currentMidi]);

  const semitones = lowest !== null && highest !== null ? highest - lowest : 0;
  const octaves = (semitones / 12).toFixed(1);

  return (
    <ExerciseShell
      title="Диапазон голоса"
      description="Спой от самой низкой комфортной ноты до самой высокой — плавно, без крика. Приложение запомнит границы и подскажет тип голоса."
      accent="rose"
    >
      <MicGate state={state} onStart={start} onStop={stop} level={level}>
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-8">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Сейчас поёшь
          </span>
          <span className="text-5xl font-bold tabular-nums">
            {currentMidi === null ? "—" : midiToName(currentMidi)}
          </span>
          <span className="text-sm text-zinc-500">
            {currentMidi === null
              ? "тишина"
              : `${midiToSolfege(currentMidi)} · ${pitch!.frequency.toFixed(1)} Гц`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Нижняя нота", midi: lowest },
            { label: "Верхняя нота", midi: highest },
          ].map((entry) => (
            <div
              key={entry.label}
              className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4"
            >
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                {entry.label}
              </span>
              <span className="text-2xl font-bold">
                {entry.midi === null ? "—" : midiToName(entry.midi)}
              </span>
              {entry.midi !== null && (
                <button
                  onClick={() => {
                    void unlockAudio();
                    playGuitarNote(entry.midi!, { gain: 0.6 });
                  }}
                  className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                >
                  ▶ послушать
                </button>
              )}
            </div>
          ))}
        </div>

        {lowest !== null && highest !== null && semitones > 0 && (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 text-center">
            <div className="text-3xl font-bold text-rose-500">
              {octaves} октавы
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {semitones} полутонов · похоже на{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                {classifyVoice(lowest, highest)}
              </span>
            </p>
          </div>
        )}

        <div className="flex justify-center">
          <button
            onClick={() => {
              setLowest(null);
              setHighest(null);
              stableRef.current = null;
            }}
            className="text-sm text-zinc-500 hover:underline"
          >
            Сбросить замер
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          Совет: пой на удобной гласной («а» или «о»), начинай со среднего
          регистра и спускайся вниз, потом так же плавно вверх. Нота
          засчитывается, только если удержать её стабильно.
        </p>
      </MicGate>
    </ExerciseShell>
  );
}
