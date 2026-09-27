import { useEffect, useRef, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { unlockAudio } from "@modules/audio";
import { auditionChord, startBacking } from "../../../lib/audio/backing";
import {
  COMMON_PROGRESSIONS,
  KEY_ROOTS,
  Mode,
  chordName,
  chordsFor,
  degreesFor,
  findDegree,
  keyLabel,
} from "../../../lib/keys";
import { pickRandom } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const ROUNDS = 6;
const BPM = 88;

const LEVELS = [
  { id: "easy", label: "I · IV · V", major: ["I", "IV", "V"], minor: ["i", "iv", "V"] },
  { id: "mid", label: "+ vi / VI", major: ["I", "IV", "V", "vi"], minor: ["i", "iv", "V", "VI"] },
  {
    id: "hard",
    label: "Все ступени",
    major: ["I", "ii", "iii", "IV", "V", "vi"],
    minor: ["i", "III", "iv", "V", "VI", "VII"],
  },
];
type Level = (typeof LEVELS)[number];
type ModeSetting = Mode | "both";

interface Round {
  root: string;
  mode: Mode;
  romans: string[];
}

function makeRound(level: Level, modeSetting: ModeSetting): Round {
  const mode: Mode =
    modeSetting === "both" ? pickRandom<Mode>(["major", "minor"]) : modeSetting;
  const allowed = level[mode];
  const root = pickRandom(KEY_ROOTS[mode]);
  const fitting = COMMON_PROGRESSIONS[mode].filter((p) => p.every((r) => allowed.includes(r)));

  // Mostly real-song progressions, so the ear learns the patterns it will meet.
  if (fitting.length > 0 && Math.random() < 0.6) {
    return { root, mode, romans: pickRandom(fitting) };
  }
  const romans = [allowed[0]];
  while (romans.length < 4) {
    const candidate = pickRandom(allowed);
    if (candidate !== romans[romans.length - 1]) romans.push(candidate);
  }
  return { root, mode, romans };
}

export default function ProgressionDictation() {
  const [level, setLevel] = useState<Level>(LEVELS[0]);
  const [modeSetting, setModeSetting] = useState<ModeSetting>("major");
  const [round, setRound] = useState<Round | null>(null);
  const [answers, setAnswers] = useState<(string | null)[]>([null, null, null, null]);
  const [activeSlot, setActiveSlot] = useState(1);
  const [checked, setChecked] = useState(false);
  const [playingBar, setPlayingBar] = useState<number | null>(null);
  const [showNames, setShowNames] = useState(true);
  const [stats, setStats] = useState({ correct: 0, total: 0, rounds: 0 });
  const playerRef = useRef<{ stop: () => void } | null>(null);

  const finished = stats.rounds >= ROUNDS;

  function begin(nextRound: Round) {
    setRound(nextRound);
    setAnswers([nextRound.romans[0], null, null, null]);
    setActiveSlot(1);
    setChecked(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random round is picked client-side to avoid a hydration mismatch
    begin(makeRound(LEVELS[0], "major"));
    return () => playerRef.current?.stop();
  }, []);

  async function play(current = round) {
    if (!current) return;
    await unlockAudio();
    playerRef.current?.stop();
    playerRef.current = startBacking({
      chords: chordsFor(current.root, current.mode, current.romans),
      bpm: BPM,
      onBar: setPlayingBar,
      onEnd: () => setPlayingBar(null),
    });
  }

  function pickOption(roman: string) {
    if (!round) return;
    void unlockAudio();
    auditionChord(chordName(round.root, findDegree(round.mode, roman)));
    if (checked) return;

    const next = [...answers];
    next[activeSlot] = roman;
    setAnswers(next);
    const empty = [1, 2, 3].find((slot) => slot > activeSlot && next[slot] === null)
      ?? [1, 2, 3].find((slot) => next[slot] === null);
    if (empty !== undefined) setActiveSlot(empty);
  }

  function check() {
    if (!round) return;
    const correct = [1, 2, 3].filter((slot) => answers[slot] === round.romans[slot]).length;
    const nextStats = {
      correct: stats.correct + correct,
      total: stats.total + 3,
      rounds: stats.rounds + 1,
    };
    setStats(nextStats);
    setChecked(true);
    if (nextStats.rounds >= ROUNDS) {
      recordScore("progressions", Math.round((nextStats.correct / nextStats.total) * 100));
    }
  }

  function nextRound(nextLevel = level, nextMode = modeSetting) {
    const fresh = makeRound(nextLevel, nextMode);
    begin(fresh);
    setTimeout(() => play(fresh), 150);
  }

  function restart(nextLevel = level, nextMode = modeSetting) {
    playerRef.current?.stop();
    setPlayingBar(null);
    setLevel(nextLevel);
    setModeSetting(nextMode);
    setStats({ correct: 0, total: 0, rounds: 0 });
    begin(makeRound(nextLevel, nextMode));
  }

  const options = round
    ? degreesFor(round.mode).filter((d) => level[round.mode].includes(d.roman))
    : [];
  const allFilled = answers.every((a) => a !== null);

  return (
    <ExerciseShell
      title="Подбор аккордов"
      description="Играет последовательность из четырёх аккордов. Первый — тоника, он дан. Подбери остальные: нажимай варианты, чтобы примерить их на слух, как на гитаре."
      accent="sky"
      aside={<ScoreBadge correct={stats.correct} total={ROUNDS * 3} label="Аккорды" />}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {LEVELS.map((item) => (
          <button
            key={item.id}
            onClick={() => restart(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              level.id === item.id
                ? "bg-sky-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}
        <div className="ml-auto flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm">
          {([
            ["major", "Мажор"],
            ["minor", "Минор"],
            ["both", "Оба"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => restart(level, id)}
              className={`px-3 py-1.5 ${modeSetting === id ? "bg-sky-600 text-white" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {finished ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <div className="text-5xl font-bold text-sky-500">
            {Math.round((stats.correct / stats.total) * 100)}%
          </div>
          <p className="text-sm text-zinc-500">
            Угадано аккордов: {stats.correct} из {stats.total}
          </p>
          <button
            onClick={() => restart()}
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700"
          >
            Ещё раунд
          </button>
        </div>
      ) : round ? (
        <>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span>
              Тональность: <b>{keyLabel(round.root, round.mode)}</b>
            </span>
            <span className="text-zinc-500">
              Последовательность {stats.rounds + 1} из {ROUNDS}
            </span>
          </div>

          <button
            onClick={() => play()}
            className="mb-4 w-full rounded-2xl bg-sky-600 py-4 text-lg font-medium text-white hover:bg-sky-700"
          >
            ▶ {playingBar === null ? "Проиграть последовательность" : "Играет…"}
          </button>

          <div className="mb-5 grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((slot) => {
              const answer = answers[slot];
              const isCorrect = checked && answer === round.romans[slot];
              const isWrong = checked && slot > 0 && answer !== round.romans[slot];
              return (
                <button
                  key={slot}
                  disabled={slot === 0 || checked}
                  onClick={() => setActiveSlot(slot)}
                  className={`flex h-20 flex-col items-center justify-center rounded-xl border-2 transition-all ${
                    playingBar === slot ? "scale-105 shadow-lg" : ""
                  } ${
                    isWrong
                      ? "border-red-500 bg-red-50 dark:bg-red-950"
                      : isCorrect && slot > 0
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                        : slot === 0
                          ? "border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900"
                          : activeSlot === slot && !checked
                            ? "border-sky-500"
                            : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <span className="text-lg font-bold">{answer ?? "?"}</span>
                  {answer && showNames && (
                    <span className="text-xs text-zinc-500">
                      {chordName(round.root, findDegree(round.mode, answer))}
                    </span>
                  )}
                  {isWrong && (
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      → {round.romans[slot]}{" "}
                      {showNames && chordName(round.root, findDegree(round.mode, round.romans[slot]))}
                    </span>
                  )}
                  {slot === 0 && <span className="text-[10px] text-zinc-400">дано</span>}
                </button>
              );
            })}
          </div>

          <p className="mb-2 text-xs text-zinc-500">
            Варианты — нажми, чтобы услышать и поставить в выбранную ячейку:
          </p>
          <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {options.map((degree) => (
              <button
                key={degree.roman}
                onClick={() => pickOption(degree.roman)}
                className="flex flex-col items-center rounded-xl border border-zinc-200 dark:border-zinc-800 py-3 transition-colors hover:border-sky-400 active:scale-95"
              >
                <span className="font-bold">{degree.roman}</span>
                {showNames && (
                  <span className="text-xs text-zinc-500">{chordName(round.root, degree)}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!checked ? (
              <button
                onClick={check}
                disabled={!allFilled}
                className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-40"
              >
                Проверить
              </button>
            ) : (
              <button
                onClick={() => nextRound()}
                className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Следующая →
              </button>
            )}
            <label className="ml-auto flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={showNames}
                onChange={(event) => setShowNames(event.target.checked)}
              />
              названия аккордов
            </label>
          </div>

          <div className="mt-6 rounded-2xl bg-zinc-50 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
            <p className="mb-1 font-medium text-zinc-800 dark:text-zinc-200">Как слушать</p>
            Следи за басом — он почти всегда играет корень аккорда. Мажорные
            ступени (заглавные I, IV, V) звучат светло, минорные (ii, iii, vi) —
            темнее. V тянет обратно к тонике, IV звучит как «шаг в сторону».
          </div>
        </>
      ) : null}
    </ExerciseShell>
  );
}
