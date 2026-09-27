import { useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { ChordDiagram } from "../../../components/ChordDiagram";
import { playClick } from "@modules/audio";
import { strumChord } from "../../../lib/audio/guitar-synth";
import { getAudioContext, unlockAudio } from "@modules/audio";
import { resolveChordShape } from "../../../lib/resolve-chord";
import { pickRandom } from "../../../lib/ear-training";
import { markPractice } from "../../../lib/train-stats";

const CHORD_SETS: { id: string; label: string; chords: string[] }[] = [
  { id: "easy", label: "Для начинающих", chords: ["Em", "Am", "C", "G", "D"] },
  { id: "pop", label: "Поп-набор", chords: ["G", "D", "Em", "C", "Am", "F"] },
  { id: "barre", label: "С баррэ", chords: ["F", "Bm", "B", "Am", "C", "G"] },
];

export default function ChordChangesTrainer() {
  const [set, setSet] = useState(CHORD_SETS[0]);
  const [bpm, setBpm] = useState(70);
  const [barsPerChord, setBarsPerChord] = useState(1);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState("Em");
  const [next, setNext] = useState("Am");
  const [beat, setBeat] = useState(0);
  const [changes, setChanges] = useState(0);

  const timerRef = useRef<number | null>(null);
  const nextTimeRef = useRef(0);
  const beatCountRef = useRef(0);
  const currentRef = useRef(current);
  const nextRef = useRef(next);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }

    const audio = getAudioContext();
    nextTimeRef.current = audio.currentTime + 0.1;
    beatCountRef.current = 0;
    const beatsPerChord = barsPerChord * 4;

    timerRef.current = window.setInterval(() => {
      const secondsPerBeat = 60 / bpm;
      while (nextTimeRef.current < audio.currentTime + 0.15) {
        const index = beatCountRef.current;
        const beatInBar = index % 4;
        const when = Math.max(0, nextTimeRef.current - audio.currentTime);
        playClick(beatInBar === 0, when);

        if (index % beatsPerChord === 0) {
          // Strum the chord we are switching to, on the downbeat.
          const shape = resolveChordShape(nextRef.current);
          if (shape) strumChord(shape.frets, { when, gain: 0.4 });

          const arriving = nextRef.current;
          const upcoming = pickRandom(set.chords.filter((c) => c !== arriving));
          window.setTimeout(() => {
            setCurrent(arriving);
            setNext(upcoming);
            setChanges((value) => value + 1);
          }, when * 1000);
        }

        window.setTimeout(() => setBeat(beatInBar), when * 1000);
        nextTimeRef.current += secondsPerBeat;
        beatCountRef.current += 1;
      }
    }, 25);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [running, bpm, barsPerChord, set]);

  async function toggle() {
    if (!running) {
      await unlockAudio();
      markPractice("chord-changes");
      setChanges(0);
      setCurrent(set.chords[0]);
      setNext(pickRandom(set.chords.filter((c) => c !== set.chords[0])));
    }
    setRunning((value) => !value);
  }

  return (
    <ExerciseShell
      title="Смена аккордов"
      description="Метроном задаёт темп, аккорд меняется каждый такт. Задача — успеть переставить пальцы к следующему аккорду, не сбивая ритм."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {CHORD_SETS.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setRunning(false);
              setSet(item);
              setCurrent(item.chords[0]);
              setNext(item.chords[1]);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              set.id === item.id
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-emerald-500 p-4">
          <span className="text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            Сейчас
          </span>
          <ChordDiagram chord={current} size={120} />
        </div>
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Следующий
          </span>
          <ChordDiagram chord={next} size={120} />
        </div>
      </div>

      <div className="mt-4 flex gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className={`h-2.5 flex-1 rounded-full transition-colors ${
              running && beat === index
                ? index === 0
                  ? "bg-emerald-600"
                  : "bg-emerald-400"
                : "bg-zinc-200 dark:bg-zinc-800"
            }`}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-lg font-semibold tabular-nums">{bpm} BPM</span>
          <button
            onClick={toggle}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white ${
              running ? "bg-red-600" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {running ? "Стоп" : "Старт"}
          </button>
        </div>
        <input
          type="range"
          min={40}
          max={160}
          value={bpm}
          onChange={(event) => setBpm(Number(event.target.value))}
          className="w-full"
        />
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-500">Тактов на аккорд:</span>
          {[1, 2, 4].map((value) => (
            <button
              key={value}
              onClick={() => setBarsPerChord(value)}
              className={`rounded px-2.5 py-1 ${
                barsPerChord === value
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {value}
            </button>
          ))}
          <span className="ml-auto text-zinc-500">Смен: {changes}</span>
        </div>
      </div>
    </ExerciseShell>
  );
}
