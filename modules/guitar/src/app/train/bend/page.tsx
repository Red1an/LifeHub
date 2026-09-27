import { useCallback, useEffect, useRef, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { PitchMeter } from "../../../components/train/PitchMeter";
import { PitchGraph, GraphSample } from "../../../components/train/PitchGraph";
import { useMicPitch } from "@modules/audio";
import { useHoldTimer } from "@modules/audio";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { GUITAR_OPEN_STRINGS_MIDI, centsBetween, freqToMidiFloat, midiToName } from "../../../lib/music-theory";
import { randomInt, pickRandom } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const ROUNDS = 8;
const TOLERANCE = 15;
const HOLD_MS = 600;
const WINDOW_S = 4;
const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];

const LEVELS = [
  { id: "half", label: "Полутон", semis: [1] },
  { id: "whole", label: "Тон", semis: [2] },
  { id: "mixed", label: "Полутон, тон, полтора", semis: [1, 2, 3] },
];

interface Task {
  string: number;
  fret: number;
  semis: number;
}

function makeTask(semis: number[]): Task {
  return { string: pickRandom([3, 4, 5]), fret: randomInt(5, 12), semis: pickRandom(semis) };
}

export default function BendTrainer() {
  const [level, setLevel] = useState(LEVELS[1]);
  const [task, setTask] = useState<Task>({ string: 4, fret: 8, semis: 2 });
  const [samples, setSamples] = useState<GraphSample[]>([]);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const [done, setDone] = useState(false);
  const bufferRef = useRef<GraphSample[]>([]);
  const frameRef = useRef(0);

  const onFrame = useCallback((pitch: { frequency: number; clarity: number } | null, time: number) => {
    const midi = pitch && pitch.clarity > 0.9 ? freqToMidiFloat(pitch.frequency) : null;
    const buffer = bufferRef.current;
    buffer.push({ t: time, midi });
    while (buffer.length && buffer[0].t < time - WINDOW_S) buffer.shift();
    // Re-render the graph every third frame; 20 fps is plenty for a pitch trace.
    if (++frameRef.current % 3 === 0) {
      const start = time - WINDOW_S;
      setSamples(buffer.map((s) => ({ t: s.t - start, midi: s.midi })));
    }
  }, []);

  const { state, pitch, level: micLevel, start, stop } = useMicPitch({ fftSize: 2048, onFrame });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random first task is picked client-side
    setTask(makeTask(LEVELS[1].semis));
  }, []);

  const baseMidi = GUITAR_OPEN_STRINGS_MIDI[task.string] + task.fret;
  const targetMidi = baseMidi + task.semis;
  const cents = pitch ? centsBetween(pitch.frequency, targetMidi) : null;
  const onTarget = !done && cents !== null && Math.abs(cents) <= TOLERANCE;

  function tally(correct: boolean) {
    const nextStats = { correct: stats.correct + (correct ? 1 : 0), total: stats.total + 1 };
    setStats(nextStats);
    if (nextStats.total === ROUNDS) recordScore("bend", Math.round((nextStats.correct / ROUNDS) * 100));
  }

  const progress = useHoldTimer(onTarget, HOLD_MS, () => {
    setDone(true);
    tally(true);
  });

  function next(skip = false) {
    if (skip) tally(false);
    setTask(makeTask(level.semis));
    setDone(false);
  }

  function restart(nextLevel = level) {
    setLevel(nextLevel);
    setStats({ correct: 0, total: 0 });
    setTask(makeTask(nextLevel.semis));
    setDone(false);
  }

  const finished = stats.total >= ROUNDS;
  const bendLabel = task.semis === 1 ? "на полутон" : task.semis === 2 ? "на тон" : "на полтора тона";

  return (
    <ExerciseShell
      title="Бенды"
      description="Зажми лад и подтяни струну так, чтобы нота поднялась до цели. Стрелка и линия на графике покажут, дотянул ты или «недотянул» — самая частая ошибка в соло."
      aside={<ScoreBadge correct={stats.correct} total={ROUNDS} />}
    >
      <div className="flex flex-wrap gap-2">
        {LEVELS.map((item) => (
          <button
            key={item.id}
            onClick={() => restart(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${level.id === item.id ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {finished ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <div className="text-5xl font-bold text-emerald-500">{Math.round((stats.correct / ROUNDS) * 100)}%</div>
          <p className="text-sm text-zinc-500">Точных бендов: {stats.correct} из {ROUNDS}</p>
          <button onClick={() => restart()} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white">
            Ещё раунд
          </button>
        </div>
      ) : (
        <MicGate state={state} onStart={start} onStop={stop} level={micLevel}>
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">Задание</div>
              <div className="text-xl font-semibold">
                Струна {STRING_NAMES[task.string]}, {task.fret} лад — подтяни {bendLabel}
              </div>
              <div className="text-sm text-zinc-500">
                {midiToName(baseMidi)} → {midiToName(targetMidi)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                onClick={() => {
                  void unlockAudio();
                  playGuitarNote(baseMidi, { gain: 0.7 });
                }}
                className="rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800"
              >
                ▶ исходная
              </button>
              <button
                onClick={() => {
                  void unlockAudio();
                  playGuitarNote(targetMidi, { gain: 0.7 });
                }}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white"
              >
                ▶ цель
              </button>
            </div>
          </div>

          <PitchMeter cents={cents} midi={pitch ? targetMidi : null} tolerance={TOLERANCE} caption="Подтяни струну" />

          <PitchGraph
            samples={samples}
            duration={WINDOW_S}
            toleranceCents={TOLERANCE}
            range={[baseMidi - 2, targetMidi + 2]}
            targets={[
              { start: 0, end: WINDOW_S, midi: baseMidi, hit: null },
              { start: 0, end: WINDOW_S, midi: targetMidi, hit: done ? true : null },
            ]}
          />

          <div>
            <div className="mb-1 flex justify-between text-xs text-zinc-500">
              <span>Удержи цель</span>
              <span>{done ? "Точно!" : `${Math.round(progress * 100)}%`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full bg-emerald-500" style={{ width: `${done ? 100 : progress * 100}%` }} />
            </div>
          </div>

          <div className="flex justify-center">
            {done ? (
              <button onClick={() => next()} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white">
                Следующий бенд →
              </button>
            ) : (
              <button onClick={() => next(true)} className="text-sm text-zinc-500 hover:underline">
                Пропустить
              </button>
            )}
          </div>
        </MicGate>
      )}
    </ExerciseShell>
  );
}
