import { useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { CHORD_QUALITIES, pickRandom, randomRootMidi } from "../../../lib/ear-training";
import { playGuitarNotes, playSequence } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { recordScore } from "../../../lib/train-stats";

const ROUND_LENGTH = 12;

const SETS = [
  { id: "triads", label: "Только трезвучия", ids: ["maj", "min", "dim", "aug"] },
  { id: "sevenths", label: "С септаккордами", ids: CHORD_QUALITIES.map((q) => q.id) },
];

interface Exercise {
  root: number;
  qualityId: string;
}

function newExercise(allowed: string[]): Exercise {
  return { root: randomRootMidi(48, 57), qualityId: pickRandom(allowed) };
}

export default function ChordEarTrainer() {
  const [set, setSet] = useState(SETS[0]);
  const [exercise, setExercise] = useState<Exercise>(() => newExercise(SETS[0].ids));
  const [answered, setAnswered] = useState<string | null>(null);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const [finished, setFinished] = useState(false);

  const options = CHORD_QUALITIES.filter((quality) => set.ids.includes(quality.id));

  function notesFor(current: Exercise): number[] {
    const definition = CHORD_QUALITIES.find((q) => q.id === current.qualityId)!;
    return definition.intervals.map((interval) => current.root + interval);
  }

  function play(current = exercise) {
    void unlockAudio();
    playGuitarNotes(notesFor(current), { gain: 0.6 });
  }

  function playArpeggio(current = exercise) {
    void unlockAudio();
    playSequence(notesFor(current), 0.32, { gain: 0.6 });
  }

  function answer(qualityId: string) {
    if (answered !== null) return;
    const isCorrect = qualityId === exercise.qualityId;
    setAnswered(qualityId);
    const total = stats.total + 1;
    const correct = stats.correct + (isCorrect ? 1 : 0);
    setStats({ correct, total });
    if (total >= ROUND_LENGTH) {
      setFinished(true);
      recordScore("chords-ear", Math.round((correct / total) * 100));
    }
  }

  function nextQuestion() {
    const next = newExercise(set.ids);
    setExercise(next);
    setAnswered(null);
    setTimeout(() => play(next), 120);
  }

  function restart(nextSet = set) {
    setSet(nextSet);
    setStats({ correct: 0, total: 0 });
    setFinished(false);
    setAnswered(null);
    setExercise(newExercise(nextSet.ids));
  }

  if (finished) {
    return (
      <ExerciseShell
        title="Аккорды на слух"
        description="Узнавай тип аккорда по звучанию."
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
      title="Аккорды на слух"
      description="Звучит аккорд — определи его тип. Если сложно услышать целиком, разложи его по нотам."
      accent="violet"
      aside={<ScoreBadge correct={stats.correct} total={ROUND_LENGTH} />}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {SETS.map((item) => (
          <button
            key={item.id}
            onClick={() => restart(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              set.id === item.id
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          onClick={() => play()}
          className="rounded-2xl bg-violet-600 py-5 text-lg font-medium text-white hover:bg-violet-700"
        >
          ▶ Проиграть аккорд
        </button>
        <button
          onClick={() => playArpeggio()}
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 py-5 text-lg font-medium hover:border-violet-400"
        >
          ↗ По нотам
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((quality) => {
          const isAnswer = answered !== null && quality.id === exercise.qualityId;
          const isWrongPick = answered === quality.id && answered !== exercise.qualityId;
          return (
            <button
              key={quality.id}
              disabled={answered !== null}
              onClick={() => answer(quality.id)}
              className={`rounded-xl border px-3 py-3 text-left text-sm transition-colors disabled:cursor-default ${
                isAnswer
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                  : isWrongPick
                    ? "border-red-500 bg-red-50 dark:bg-red-950"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-violet-400"
              }`}
            >
              {quality.label}
            </button>
          );
        })}
      </div>

      {answered !== null && (
        <div className="mt-5 flex items-center justify-between rounded-xl bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
          <span className="text-sm">
            {answered === exercise.qualityId
              ? "Верно!"
              : `Это был ${CHORD_QUALITIES.find((q) => q.id === exercise.qualityId)?.label.toLowerCase()}`}
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
