import { useCallback, useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { useMicPitch } from "@modules/audio";
import { playGuitarNote, playGuitarNotes } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { centsBetween, midiToName, midiToSolfege } from "../../../lib/music-theory";
import { markPractice } from "../../../lib/train-stats";

interface Pattern {
  id: string;
  label: string;
  hint: string;
  degrees: number[];
  syllables: string[];
}

const PATTERNS: Pattern[] = [
  {
    id: "five",
    label: "Пятиступенка",
    hint: "Классическая распевка: вверх по пяти ступеням и обратно.",
    degrees: [0, 2, 4, 5, 7, 5, 4, 2, 0],
    syllables: ["до", "ре", "ми", "фа", "соль", "фа", "ми", "ре", "до"],
  },
  {
    id: "triad",
    label: "Арпеджио",
    hint: "Трезвучие вверх и вниз — учит слышать аккорд голосом.",
    degrees: [0, 4, 7, 12, 7, 4, 0],
    syllables: ["до", "ми", "соль", "до", "соль", "ми", "до"],
  },
  {
    id: "around",
    label: "Вокруг примы",
    hint: "Опевание тоники: уходим на соседнюю ступень и каждый раз возвращаемся на «до», постепенно расширяя шаг до квинты вверх и вниз.",
    degrees: [0, 2, 0, -1, 0, 4, 0, -3, 0, 5, 0, -5, 0, 7, 0],
    syllables: ["до", "ре", "до", "си", "до", "ми", "до", "ля", "до", "фа", "до", "соль", "до", "соль", "до"],
  },
  {
    id: "scale",
    label: "Гамма до–до",
    hint: "Вся мажорная гамма на октаву вверх и обратно: до-ре-ми-фа-соль-ля-си-до.",
    degrees: [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0],
    syllables: ["до", "ре", "ми", "фа", "соль", "ля", "си", "до", "си", "ля", "соль", "фа", "ми", "ре", "до"],
  },
  {
    id: "octave",
    label: "Октава",
    hint: "Скачок на октаву — тренирует переход между регистрами.",
    degrees: [0, 12, 0],
    syllables: ["до", "до", "до"],
  },
];

const STEP_MS = 800;

export default function WarmupTrainer() {
  const { state, pitch, level, start, stop } = useMicPitch();
  const [pattern, setPattern] = useState(PATTERNS[0]);
  const [rootMidi, setRootMidi] = useState(53); // F3, comfortable starting point
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [hits, setHits] = useState<boolean[]>([]);

  const timerRef = useRef<number | null>(null);
  const hitRef = useRef(false);

  const targetMidi = step >= 0 ? rootMidi + pattern.degrees[step] : null;
  const cents =
    pitch && targetMidi !== null ? centsBetween(pitch.frequency, targetMidi) : null;
  const onTarget = cents !== null && Math.abs(cents) <= 50;

  useEffect(() => {
    if (onTarget) hitRef.current = true;
  }, [onTarget]);

  const stopRun = useCallback(() => {
    setRunning(false);
    setStep(-1);
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (!running) return;
    let index = 0;

    const advance = () => {
      if (index > 0) {
        setHits((previous) => [...previous, hitRef.current]);
      }
      hitRef.current = false;

      if (index >= pattern.degrees.length) {
        // Move the whole pattern up a semitone and keep going.
        setRootMidi((value) => (value >= 72 ? 53 : value + 1));
        index = 0;
        setStep(-1);
        return;
      }

      const midi = rootMidi + pattern.degrees[index];
      playGuitarNote(midi, { gain: 0.55, duration: STEP_MS / 1000 });
      setStep(index);
      index += 1;
    };

    advance();
    timerRef.current = window.setInterval(advance, STEP_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [running, pattern, rootMidi]);

  async function toggle() {
    if (!running) {
      await unlockAudio();
      markPractice("warmup");
      setHits([]);
      // Sound the tonic chord once so the ear has a reference.
      playGuitarNotes([rootMidi, rootMidi + 4, rootMidi + 7], { gain: 0.4 });
      setRunning(true);
    } else {
      stopRun();
    }
  }

  const accuracy = hits.length
    ? Math.round((hits.filter(Boolean).length / hits.length) * 100)
    : null;

  return (
    <ExerciseShell
      title="Распевки"
      description="Пой за аккомпанементом: каждая фраза поднимается на полутон вверх. Подсветка показывает, какую ноту петь сейчас, а микрофон — попал ли ты."
      accent="rose"
    >
      <MicGate state={state} onStart={start} onStop={stop} level={level}>
        <div className="flex flex-wrap gap-2">
          {PATTERNS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                stopRun();
                setPattern(item);
                setHits([]);
                if (item.id === "scale") setRootMidi(48); // literally start on C3
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                pattern.id === item.id
                  ? "bg-rose-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-zinc-500">{pattern.hint}</p>

        <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          {pattern.degrees.map((degree, index) => {
            const isCurrent = index === step;
            return (
              <div
                key={index}
                className={`flex h-16 w-16 flex-col items-center justify-center rounded-xl border-2 transition-all ${
                  isCurrent
                    ? onTarget
                      ? "scale-110 border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                      : "scale-110 border-rose-500 bg-rose-50 dark:bg-rose-950"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <span className="text-sm font-semibold">
                  {midiToName(rootMidi + degree)}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {pattern.syllables[index]}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">
              Тоника
            </div>
            <div className="text-lg font-semibold">
              {midiToName(rootMidi)}{" "}
              <span className="text-xs font-normal text-zinc-500">
                {midiToSolfege(rootMidi)}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">
              Ты поёшь
            </div>
            <div
              className={`text-lg font-semibold ${
                onTarget ? "text-emerald-500" : ""
              }`}
            >
              {pitch ? midiToName(Math.round(69 + 12 * Math.log2(pitch.frequency / 440))) : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">
              Попадание
            </div>
            <div className="text-lg font-semibold">
              {accuracy === null ? "—" : `${accuracy}%`}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setRootMidi((value) => Math.max(45, value - 1))}
            className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm"
          >
            ниже
          </button>
          <button
            onClick={toggle}
            className={`rounded-lg px-6 py-2.5 text-sm font-medium text-white ${
              running ? "bg-red-600" : "bg-rose-600 hover:bg-rose-700"
            }`}
          >
            {running ? "Стоп" : "Начать распевку"}
          </button>
          <button
            onClick={() => setRootMidi((value) => Math.min(72, value + 1))}
            className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm"
          >
            выше
          </button>
        </div>
      </MicGate>
    </ExerciseShell>
  );
}
