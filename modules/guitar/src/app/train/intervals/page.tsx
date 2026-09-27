import { useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { INTERVAL_NAMES } from "../../../lib/music-theory";
import { randomInt, randomRootMidi } from "../../../lib/ear-training";
import { playGuitarNote, playGuitarNotes } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { recordScore } from "../../../lib/train-stats";

const ROUND_LENGTH = 12;

interface Exercise {
  root: number;
  semitones: number;
}

const SCOPES = [
  { id: "simple", label: "Простые (до квинты)", max: 7 },
  { id: "all", label: "Все до октавы", max: 12 },
];

function newExercise(max: number): Exercise {
  return { root: randomRootMidi(45, 57), semitones: randomInt(1, max) };
}

export default function IntervalTrainer() {
  const [scope, setScope] = useState(SCOPES[0]);
  const [exercise, setExercise] = useState<Exercise>(() => newExercise(SCOPES[0].max));
  const [mode, setMode] = useState<"melodic" | "harmonic">("melodic");
  const [answered, setAnswered] = useState<number | null>(null);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const [finished, setFinished] = useState(false);

  function play(current = exercise) {
    void unlockAudio();
    if (mode === "melodic") {
      playGuitarNote(current.root, { gain: 0.65 });
      playGuitarNote(current.root + current.semitones, { when: 0.6, gain: 0.65 });
    } else {
      playGuitarNotes([current.root, current.root + current.semitones], { gain: 0.65 });
    }
  }

  function answer(semitones: number) {
    if (answered !== null) return;
    const isCorrect = semitones === exercise.semitones;
    setAnswered(semitones);
    const total = stats.total + 1;
    const correct = stats.correct + (isCorrect ? 1 : 0);
    setStats({ correct, total });
    if (total >= ROUND_LENGTH) {
      setFinished(true);
      recordScore("intervals", Math.round((correct / total) * 100));
    }
  }

  function nextQuestion() {
    const next = newExercise(scope.max);
    setExercise(next);
    setAnswered(null);
    setTimeout(() => play(next), 120);
  }

  function restart(nextScope = scope) {
    setScope(nextScope);
    setStats({ correct: 0, total: 0 });
    setFinished(false);
    setAnswered(null);
    setExercise(newExercise(nextScope.max));
  }

  if (finished) {
    return (
      <ExerciseShell
        title="Интервалы на слух"
        description="Определи расстояние между двумя звуками."
        accent="violet"
      >
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <div className="text-5xl font-bold text-violet-500">
            {Math.round((stats.correct / stats.total) * 100)}%
          </div>
          <p className="text-sm text-zinc-500">
            {stats.correct} из {stats.total} правильно
          </p>
          <button
            onClick={() => restart()}
            className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Ещё раунд
          </button>
        </div>
      </ExerciseShell>
    );
  }

  return (
    <ExerciseShell
      title="Интервалы на слух"
      description="Звучат два звука — определи расстояние между ними. Начни с простых интервалов и добавляй сложные, когда станет легко."
      accent="violet"
      aside={<ScoreBadge correct={stats.correct} total={ROUND_LENGTH} />}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SCOPES.map((item) => (
          <button
            key={item.id}
            onClick={() => restart(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              scope.id === item.id
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}
        <div className="ml-auto flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm">
          <button
            onClick={() => setMode("melodic")}
            className={`px-3 py-1.5 ${mode === "melodic" ? "bg-violet-600 text-white" : ""}`}
          >
            По очереди
          </button>
          <button
            onClick={() => setMode("harmonic")}
            className={`px-3 py-1.5 ${mode === "harmonic" ? "bg-violet-600 text-white" : ""}`}
          >
            Вместе
          </button>
        </div>
      </div>

      <button
        onClick={() => play()}
        className="mb-5 w-full rounded-2xl bg-violet-600 py-5 text-lg font-medium text-white transition-colors hover:bg-violet-700"
      >
        ▶ Проиграть интервал
      </button>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {INTERVAL_NAMES.slice(1, scope.max + 1).map((name, index) => {
          const semitones = index + 1;
          const isAnswer = answered !== null && semitones === exercise.semitones;
          const isWrongPick = answered === semitones && answered !== exercise.semitones;
          return (
            <button
              key={semitones}
              disabled={answered !== null}
              onClick={() => answer(semitones)}
              className={`rounded-xl border px-3 py-3 text-left text-sm transition-colors disabled:cursor-default ${
                isAnswer
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                  : isWrongPick
                    ? "border-red-500 bg-red-50 dark:bg-red-950"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-violet-400"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      {answered !== null && (
        <div className="mt-5 flex items-center justify-between rounded-xl bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
          <span className="text-sm">
            {answered === exercise.semitones
              ? "Верно!"
              : `Это была ${INTERVAL_NAMES[exercise.semitones].toLowerCase()}`}
          </span>
          <button
            onClick={nextQuestion}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            Далее →
          </button>
        </div>
      )}
    </ExerciseShell>
  );
}
