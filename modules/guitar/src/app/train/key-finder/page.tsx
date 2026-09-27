import { useEffect, useRef, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { unlockAudio } from "@modules/audio";
import { startBacking } from "../../../lib/audio/backing";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { COMMON_PROGRESSIONS, KEY_ROOTS, Mode, chordsFor, keyLabel } from "../../../lib/keys";
import { SHARP_NOTES, SOLFEGE_RU, noteIndex } from "../../../lib/music-theory";
import { pickRandom } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const ROUNDS = 8;
const BPM = 96;

// Cadences that come home to the tonic — the easiest way to hear "home".
const CADENCES: Record<Mode, string[][]> = {
  major: [
    ["I", "IV", "V", "I"],
    ["I", "V", "IV", "I"],
    ["I", "vi", "V", "I"],
    ["IV", "V", "I", "I"],
  ],
  minor: [
    ["i", "iv", "V", "i"],
    ["i", "VI", "V", "i"],
    ["i", "VII", "VI", "i"],
    ["iv", "V", "i", "i"],
  ],
};

const LEVELS = [
  { id: "easy", label: "Мажор, конец на тонике", modes: ["major"] as Mode[], homeEnding: true },
  { id: "mid", label: "Мажор и минор", modes: ["major", "minor"] as Mode[], homeEnding: true },
  { id: "hard", label: "Как в песне (без опоры)", modes: ["major", "minor"] as Mode[], homeEnding: false },
];
type Level = (typeof LEVELS)[number];

interface Round {
  root: string;
  mode: Mode;
  romans: string[];
}

function makeRound(level: Level): Round {
  const mode = pickRandom(level.modes);
  const root = pickRandom(KEY_ROOTS[mode]);
  if (level.homeEnding) return { root, mode, romans: pickRandom(CADENCES[mode]) };
  // Rotate a real progression so it neither starts nor ends on the tonic.
  const base = pickRandom(COMMON_PROGRESSIONS[mode]);
  return { root, mode, romans: [...base.slice(2), ...base.slice(0, 2)] };
}

export default function KeyFinder() {
  const [level, setLevel] = useState<Level>(LEVELS[0]);
  const [round, setRound] = useState<Round | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const playerRef = useRef<{ stop: () => void } | null>(null);

  const finished = stats.total >= ROUNDS;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random round is picked client-side to avoid a hydration mismatch
    setRound(makeRound(LEVELS[0]));
    return () => playerRef.current?.stop();
  }, []);

  async function play(current = round) {
    if (!current) return;
    await unlockAudio();
    playerRef.current?.stop();
    setPlaying(true);
    playerRef.current = startBacking({
      chords: chordsFor(current.root, current.mode, current.romans),
      bpm: BPM,
      onEnd: () => setPlaying(false),
    });
  }

  function tapNote(pc: number) {
    void unlockAudio();
    playGuitarNote(48 + pc, { gain: 0.75 });
    if (!answered) setSelected(pc);
  }

  function answer() {
    if (!round || selected === null) return;
    const isCorrect = selected === noteIndex(round.root);
    const next = { correct: stats.correct + (isCorrect ? 1 : 0), total: stats.total + 1 };
    setStats(next);
    setAnswered(true);
    if (next.total >= ROUNDS) recordScore("key-finder", Math.round((next.correct / next.total) * 100));
  }

  function nextRound() {
    const fresh = makeRound(level);
    setRound(fresh);
    setSelected(null);
    setAnswered(false);
    setTimeout(() => play(fresh), 150);
  }

  function restart(nextLevel = level) {
    playerRef.current?.stop();
    setPlaying(false);
    setLevel(nextLevel);
    setStats({ correct: 0, total: 0 });
    setSelected(null);
    setAnswered(false);
    setRound(makeRound(nextLevel));
  }

  const rootPc = round ? noteIndex(round.root) : -1;

  return (
    <ExerciseShell
      title="Найди тонику"
      description="Тоника — нота «дома», на которой песня хочет остановиться. Знаешь тонику — знаешь тональность, а значит, какие ноты и аккорды подходят к песне."
      accent="sky"
      aside={<ScoreBadge correct={stats.correct} total={ROUNDS} />}
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
      </div>

      {finished ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <div className="text-5xl font-bold text-sky-500">
            {Math.round((stats.correct / stats.total) * 100)}%
          </div>
          <p className="text-sm text-zinc-500">
            Тоника найдена {stats.correct} раз из {stats.total}
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
          <button
            onClick={() => play()}
            className="mb-5 w-full rounded-2xl bg-sky-600 py-4 text-lg font-medium text-white hover:bg-sky-700"
          >
            ▶ {playing ? "Играет…" : "Проиграть отрывок"}
          </button>

          <p className="mb-2 text-sm text-zinc-500">
            Нажимай ноты и сравнивай с отрывком. Тоника — та, после которой
            ощущение «всё, приехали».
          </p>
          <div className="mb-5 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {SHARP_NOTES.map((note, pc) => {
              const isSelected = selected === pc;
              const isRoot = answered && pc === rootPc;
              const isWrong = answered && isSelected && pc !== rootPc;
              return (
                <button
                  key={note}
                  onClick={() => tapNote(pc)}
                  className={`flex flex-col items-center rounded-xl border-2 py-2.5 transition-all active:scale-95 ${
                    isRoot
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                      : isWrong
                        ? "border-red-500 bg-red-50 dark:bg-red-950"
                        : isSelected
                          ? "border-sky-500"
                          : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <span className="font-bold">{note}</span>
                  <span className="text-[11px] text-zinc-500">{SOLFEGE_RU[pc]}</span>
                </button>
              );
            })}
          </div>

          {!answered ? (
            <button
              onClick={answer}
              disabled={selected === null}
              className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-40"
            >
              Это тоника
            </button>
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
              <p className="text-sm">
                {selected === rootPc ? "Верно! " : "Не то. "}
                Тоника — <b>{round.root}</b>, тональность{" "}
                <b>{keyLabel(round.root, round.mode)}</b>.
              </p>
              <p className="text-sm text-zinc-500">
                Аккорды отрывка: {chordsFor(round.root, round.mode, round.romans).join(" – ")}
              </p>
              <button
                onClick={nextRound}
                className="self-start rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Дальше →
              </button>
            </div>
          )}

          <div className="mt-6 rounded-2xl bg-zinc-50 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
            <p className="mb-1 font-medium text-zinc-800 dark:text-zinc-200">Приём из жизни</p>
            Включи песню и напевай одну ноту поверх. Если нота звучит устойчиво
            почти на всех аккордах и на ней хочется закончить — это тоника. Дальше
            бери пентатонику от неё и играй мелодию или соло.
          </div>
        </>
      ) : null}
    </ExerciseShell>
  );
}
