import { useEffect, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { PitchMeter } from "../../../components/train/PitchMeter";
import { useMicPitch } from "@modules/audio";
import { useHoldTimer } from "@modules/audio";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { INTERVAL_NAMES, centsBetween, midiToName } from "../../../lib/music-theory";
import { VOICE_RANGES } from "../../../lib/vocal";
import { pickRandom, randomInt } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const ROUNDS = 10;
const TOLERANCE = 40;

const LEVELS = [
  { id: "easy", label: "Терция, квинта, октава", intervals: [4, 7, 12] },
  { id: "mid", label: "+ секунды и кварта", intervals: [2, 3, 4, 5, 7, 12] },
  { id: "all", label: "Все интервалы", intervals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
];

type Direction = "up" | "down" | "both";

interface Task {
  root: number;
  semis: number;
  up: boolean;
}

export default function SingInterval() {
  const [range, setRange] = useState(VOICE_RANGES[1]);
  const [level, setLevel] = useState(LEVELS[0]);
  const [direction, setDirection] = useState<Direction>("up");
  const [task, setTask] = useState<Task>({ root: 55, semis: 7, up: true });
  const [state, setState] = useState<"singing" | "correct" | "revealed">("singing");
  const [hint, setHint] = useState(true);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const mic = useMicPitch();

  function makeTask(nextLevel = level, nextDirection = direction, nextRange = range): Task {
    const up = nextDirection === "both" ? Math.random() < 0.5 : nextDirection === "up";
    const semis = pickRandom(nextLevel.intervals);
    // Keep the target note inside a comfortable singing range.
    const root = up ? nextRange.root + randomInt(-2, 5) : nextRange.root + randomInt(5, 10);
    return { root, semis, up };
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random first task is picked client-side
    setTask(makeTask());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const target = task.root + (task.up ? task.semis : -task.semis);
  const cents = mic.pitch ? centsBetween(mic.pitch.frequency, target) : null;
  const onTarget = state === "singing" && cents !== null && Math.abs(cents) <= TOLERANCE;

  function tally(correct: boolean) {
    const next = { correct: stats.correct + (correct ? 1 : 0), total: stats.total + 1 };
    setStats(next);
    if (next.total === ROUNDS) recordScore("sing-interval", Math.round((next.correct / ROUNDS) * 100));
  }

  const progress = useHoldTimer(onTarget, 800, () => {
    setState("correct");
    tally(true);
  });

  function playRoot(t = task) {
    void unlockAudio();
    playGuitarNote(t.root, { gain: 0.75 });
  }

  function giveUp() {
    setState("revealed");
    tally(false);
    void unlockAudio();
    playGuitarNote(task.root, { gain: 0.6 });
    playGuitarNote(target, { when: 0.7, gain: 0.75 });
  }

  function next() {
    const t = makeTask();
    setTask(t);
    setState("singing");
    setTimeout(() => playRoot(t), 150);
  }

  function restart(nextLevel = level, nextDirection = direction, nextRange = range) {
    setLevel(nextLevel);
    setDirection(nextDirection);
    setRange(nextRange);
    setStats({ correct: 0, total: 0 });
    setTask(makeTask(nextLevel, nextDirection, nextRange));
    setState("singing");
  }

  const finished = stats.total >= ROUNDS;
  const name = INTERVAL_NAMES[task.semis].toLowerCase();

  return (
    <ExerciseShell
      title="Спой интервал"
      description="Звучит нота — спой от неё заданный интервал. Это главное упражнение сольфеджио: голос учится «попадать» в расстояния, а не только повторять ноты."
      accent="rose"
      aside={<ScoreBadge correct={stats.correct} total={ROUNDS} />}
    >
      <div className="flex flex-wrap gap-2">
        {LEVELS.map((item) => (
          <button key={item.id} onClick={() => restart(item)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${level.id === item.id ? "bg-rose-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["up", "down", "both"] as const).map((d) => (
          <button key={d} onClick={() => restart(level, d)} className={`rounded-lg px-3 py-1.5 ${direction === d ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {d === "up" ? "Вверх" : d === "down" ? "Вниз" : "В обе стороны"}
          </button>
        ))}
        {VOICE_RANGES.map((r) => (
          <button key={r.id} onClick={() => restart(level, direction, r)} className={`rounded-lg px-3 py-1.5 ${range.id === r.id ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {r.label}
          </button>
        ))}
      </div>

      {finished ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <div className="text-5xl font-bold text-rose-500">{Math.round((stats.correct / ROUNDS) * 100)}%</div>
          <p className="text-sm text-zinc-500">Спето верно: {stats.correct} из {ROUNDS}</p>
          <button onClick={() => restart()} className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white">Ещё раунд</button>
        </div>
      ) : (
        <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop} level={mic.level}>
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 text-center">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Спой от ноты {midiToName(task.root)}</span>
            <span className="text-3xl font-bold">
              {name} {task.up ? "вверх ↑" : "вниз ↓"}
            </span>
            {state !== "singing" && (
              <span className={state === "correct" ? "text-emerald-600" : "text-zinc-500"}>
                {state === "correct" ? "Верно! " : ""}Нужная нота — {midiToName(target)}
              </span>
            )}
            <button onClick={() => playRoot()} className="mt-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white">
              ▶ Исходная нота
            </button>
          </div>

          {hint ? (
            <PitchMeter cents={cents} midi={mic.pitch ? target : null} tolerance={TOLERANCE} caption="Спой интервал" />
          ) : (
            <div className="rounded-2xl border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
              {mic.pitch ? "Слышу голос…" : "Пой — подсказка стрелкой выключена"}
            </div>
          )}

          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-emerald-500" style={{ width: `${state === "correct" ? 100 : progress * 100}%` }} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {state === "singing" ? (
              <button onClick={giveUp} className="text-sm text-zinc-500 hover:underline">Не получается — покажи</button>
            ) : (
              <button onClick={next} className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white">Дальше →</button>
            )}
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={hint} onChange={(e) => setHint(e.target.checked)} />
              подсказка стрелкой
            </label>
          </div>
        </MicGate>
      )}
    </ExerciseShell>
  );
}
