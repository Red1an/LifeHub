import { useCallback, useEffect, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { InteractiveFretboard, FretMarker } from "../../../components/train/InteractiveFretboard";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { GUITAR_OPEN_STRINGS_MIDI, SHARP_NOTES, SOLFEGE_RU } from "../../../lib/music-theory";
import { recordScore } from "../../../lib/train-stats";
import { randomInt } from "../../../lib/ear-training";

const ROUND_LENGTH = 10;

type Level = { id: string; label: string; startFret: number; fretCount: number };

const LEVELS: Level[] = [
  { id: "open", label: "Открытые + 3 лада", startFret: 0, fretCount: 3 },
  { id: "five", label: "До 5 лада", startFret: 0, fretCount: 5 },
  { id: "twelve", label: "Весь гриф (12)", startFret: 0, fretCount: 12 },
];

interface Question {
  string: number;
  fret: number;
  midi: number;
}

function makeQuestion(level: Level): Question {
  const string = randomInt(0, 5);
  const fret = randomInt(level.startFret, level.startFret + level.fretCount);
  return { string, fret, midi: GUITAR_OPEN_STRINGS_MIDI[string] + fret };
}

function noteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return SHARP_NOTES[pc];
}

export default function FretboardTrainer() {
  const [level, setLevel] = useState<Level>(LEVELS[0]);
  // Picked after mount: choosing at render time makes the server and client
  // disagree on the note and breaks hydration.
  const [question, setQuestion] = useState<Question | null>(null);
  const [asked, setAsked] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [feedback, setFeedback] = useState<FretMarker[]>([]);
  const [locked, setLocked] = useState(false);
  const finished = asked >= ROUND_LENGTH;

  const nextQuestion = useCallback(
    (nextLevel = level) => {
      setQuestion(makeQuestion(nextLevel));
      setFeedback([]);
      setLocked(false);
    },
    [level]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only randomisation, see above
    setQuestion(makeQuestion(LEVELS[0]));
  }, []);

  function handleSelect(position: { string: number; fret: number; midi: number }) {
    if (locked || finished || !question) return;
    void unlockAudio();
    playGuitarNote(position.midi);

    // Any position sounding the right pitch class counts — the point is
    // knowing where the note lives, not memorising one exact box.
    const isCorrect = ((position.midi % 12) + 12) % 12 === ((question.midi % 12) + 12) % 12;
    setLocked(true);
    const answeredCount = asked + 1;
    const correctCount = correct + (isCorrect ? 1 : 0);
    setAsked(answeredCount);
    setCorrect(correctCount);
    if (answeredCount >= ROUND_LENGTH) {
      recordScore("fretboard", Math.round((correctCount / ROUND_LENGTH) * 100));
    }

    setFeedback(
      isCorrect
        ? [{ ...position, tone: "correct", label: noteName(position.midi) }]
        : [
            { ...position, tone: "wrong", label: noteName(position.midi) },
            { string: question.string, fret: question.fret, tone: "target", label: noteName(question.midi) },
          ]
    );

    setTimeout(() => nextQuestion(), isCorrect ? 750 : 1600);
  }

  function restart(nextLevel = level) {
    setLevel(nextLevel);
    setAsked(0);
    setCorrect(0);
    nextQuestion(nextLevel);
  }

  const targetName = question ? noteName(question.midi) : "…";
  const targetSolfege = question
    ? SOLFEGE_RU[((question.midi % 12) + 12) % 12]
    : "";

  return (
    <ExerciseShell
      title="Ноты на грифе"
      description="Найди названную ноту на грифе. Любая позиция с этой нотой засчитывается — гриф отзовётся звуком."
      aside={<ScoreBadge correct={correct} total={ROUND_LENGTH} />}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {LEVELS.map((item) => (
          <button
            key={item.id}
            onClick={() => restart(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              level.id === item.id
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {finished ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <div className="text-5xl font-bold text-emerald-500">
            {Math.round((correct / ROUND_LENGTH) * 100)}%
          </div>
          <p className="text-sm text-zinc-500">
            {correct} из {ROUND_LENGTH} правильно
          </p>
          <button
            onClick={() => restart()}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Ещё раз
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-6">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              Найди ноту
            </span>
            <span className="text-5xl font-bold">{targetName}</span>
            <span className="text-sm text-zinc-500">{targetSolfege}</span>
            <span className="mt-1 text-xs text-zinc-400">
              Вопрос {asked + 1} из {ROUND_LENGTH}
            </span>
          </div>

          <InteractiveFretboard
            startFret={level.startFret}
            fretCount={level.fretCount}
            markers={feedback}
            onSelect={handleSelect}
          />

          <p className="mt-2 text-xs text-zinc-500">
            Нажимай прямо по ладам. Кружок слева от порожка — открытая струна.
          </p>
        </>
      )}
    </ExerciseShell>
  );
}
