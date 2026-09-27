import { useEffect, useMemo, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { FretMarker, InteractiveFretboard } from "../../../components/train/InteractiveFretboard";
import { unlockAudio } from "@modules/audio";
import { playGuitarNote, playSequence } from "../../../lib/audio/guitar-synth";
import { GUITAR_OPEN_STRINGS_MIDI, SHARP_NOTES, noteIndex } from "../../../lib/music-theory";
import { randomInt, pickRandom } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const ROUNDS = 8;
const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
const ROOTS = ["A", "E", "G", "C", "D"];

const LEVELS = [
  { id: "easy", label: "3 ноты, по соседним", length: 3, maxStep: 1 },
  { id: "mid", label: "4 ноты", length: 4, maxStep: 2 },
  { id: "hard", label: "5 нот, со скачками", length: 5, maxStep: 3 },
];
type Level = (typeof LEVELS)[number];

interface BoxNote {
  string: number;
  fret: number;
  midi: number;
}

/** Box 1 of the minor pentatonic: four frets from the root on the low E string. */
function boxNotes(root: string): { notes: BoxNote[]; rootFret: number } {
  let rootFret = (noteIndex(root) - 4 + 12) % 12;
  if (rootFret < 3) rootFret += 12;
  const rootPc = noteIndex(root);
  const scale = new Set(MINOR_PENTATONIC.map((i) => (rootPc + i) % 12));
  const notes: BoxNote[] = [];
  GUITAR_OPEN_STRINGS_MIDI.forEach((open, string) => {
    for (let fret = rootFret; fret <= rootFret + 3; fret++) {
      const midi = open + fret;
      if (scale.has(midi % 12)) notes.push({ string, fret, midi });
    }
  });
  notes.sort((a, b) => a.midi - b.midi);
  return { notes, rootFret };
}

function makePhrase(notes: BoxNote[], root: string, level: Level): BoxNote[] {
  const rootPc = noteIndex(root);
  const rootIndexes = notes.map((n, i) => (n.midi % 12 === rootPc ? i : -1)).filter((i) => i >= 0);
  let index = pickRandom(rootIndexes);
  const phrase = [notes[index]];
  while (phrase.length < level.length) {
    let step = 0;
    while (step === 0) step = randomInt(-level.maxStep, level.maxStep);
    let next = index + step;
    if (next < 0 || next >= notes.length) next = index - step;
    index = Math.max(0, Math.min(notes.length - 1, next));
    phrase.push(notes[index]);
  }
  return phrase;
}

type Status = "listen" | "input" | "success" | "fail";

export default function CallResponse() {
  const [root, setRoot] = useState("A");
  const [level, setLevel] = useState<Level>(LEVELS[0]);
  const [phrase, setPhrase] = useState<BoxNote[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>("listen");
  const [wrongTap, setWrongTap] = useState<BoxNote | null>(null);
  const [hints, setHints] = useState(true);
  const [stats, setStats] = useState({ correct: 0, total: 0 });

  const { notes, rootFret } = useMemo(() => boxNotes(root), [root]);
  const finished = stats.total >= ROUNDS;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random phrase is picked client-side to avoid a hydration mismatch
    setPhrase(makePhrase(boxNotes("A").notes, "A", LEVELS[0]));
  }, []);

  function play(current = phrase) {
    if (!current) return;
    void unlockAudio();
    playSequence(current.map((n) => n.midi), 0.45, { gain: 0.7 });
    setStatus((s) => (s === "listen" ? "input" : s));
  }

  function finishPhrase(success: boolean) {
    const next = { correct: stats.correct + (success ? 1 : 0), total: stats.total + 1 };
    setStats(next);
    setStatus(success ? "success" : "fail");
    if (next.total >= ROUNDS) recordScore("call-response", Math.round((next.correct / next.total) * 100));
  }

  function handleSelect(position: { string: number; fret: number; midi: number }) {
    void unlockAudio();
    playGuitarNote(position.midi, { gain: 0.75 });
    if (!phrase || (status !== "input" && status !== "listen")) return;

    const expected = phrase[progress];
    if (position.midi === expected.midi) {
      const done = progress + 1;
      setProgress(done);
      setStatus("input");
      if (done >= phrase.length) finishPhrase(true);
    } else {
      setWrongTap({ ...position });
      finishPhrase(false);
    }
  }

  function newPhrase(nextRoot = root, nextLevel = level) {
    const fresh = makePhrase(boxNotes(nextRoot).notes, nextRoot, nextLevel);
    setPhrase(fresh);
    setProgress(0);
    setWrongTap(null);
    setStatus("listen");
    return fresh;
  }

  function restart(nextRoot = root, nextLevel = level) {
    setRoot(nextRoot);
    setLevel(nextLevel);
    setStats({ correct: 0, total: 0 });
    newPhrase(nextRoot, nextLevel);
  }

  const rootPc = noteIndex(root);
  const markers: FretMarker[] = [];
  if (phrase) {
    if (status === "fail" || status === "success") {
      if (wrongTap) markers.push({ ...wrongTap, tone: "wrong", label: "✕" });
      phrase.forEach((n, i) => {
        if (!markers.some((m) => m.string === n.string && m.fret === n.fret)) {
          markers.push({ string: n.string, fret: n.fret, tone: status === "success" ? "correct" : "target", label: String(i + 1) });
        }
      });
    } else {
      phrase.slice(0, progress).forEach((n, i) => {
        markers.push({ string: n.string, fret: n.fret, tone: "correct", label: String(i + 1) });
      });
    }
  }
  if (hints) {
    notes.forEach((n) => {
      if (!markers.some((m) => m.string === n.string && m.fret === n.fret)) {
        markers.push({ string: n.string, fret: n.fret, tone: n.midi % 12 === rootPc ? "root" : "muted" });
      }
    });
  }

  return (
    <ExerciseShell
      title="Повтори фразу"
      description="Звучит короткая мелодия из пентатоники — найди и сыграй её на грифе по порядку. Так учатся подбирать мелодии и собирают свой словарь фраз для соло."
      accent="sky"
      aside={<ScoreBadge correct={stats.correct} total={ROUNDS} />}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {LEVELS.map((item) => (
          <button
            key={item.id}
            onClick={() => restart(root, item)}
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
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-zinc-500">Тональность:</span>
        {ROOTS.map((r) => (
          <button
            key={r}
            onClick={() => restart(r)}
            className={`h-8 min-w-12 rounded-lg px-2 font-medium ${
              root === r ? "bg-sky-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"
            }`}
          >
            {r}m
          </button>
        ))}
      </div>

      {finished ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <div className="text-5xl font-bold text-sky-500">
            {Math.round((stats.correct / stats.total) * 100)}%
          </div>
          <p className="text-sm text-zinc-500">
            Фраз повторено: {stats.correct} из {stats.total}
          </p>
          <button
            onClick={() => restart()}
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700"
          >
            Ещё раунд
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => play()}
            className="mb-3 w-full rounded-2xl bg-sky-600 py-4 text-lg font-medium text-white hover:bg-sky-700"
          >
            ▶ Проиграть фразу
          </button>

          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-zinc-500">
              {status === "success"
                ? "Точно! Фраза повторена."
                : status === "fail"
                  ? "Мимо — цифры показывают, как было."
                  : phrase
                    ? `Нота ${Math.min(progress + 1, phrase.length)} из ${phrase.length}. Первая — всегда тоника (${SHARP_NOTES[rootPc]}).`
                    : ""}
            </span>
            <span className="text-zinc-400">
              Фраза {Math.min(stats.total + 1, ROUNDS)}/{ROUNDS}
            </span>
          </div>

          <InteractiveFretboard
            startFret={rootFret - 1}
            fretCount={5}
            markers={markers}
            onSelect={handleSelect}
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {(status === "success" || status === "fail") && (
              <button
                onClick={() => {
                  const fresh = newPhrase();
                  setTimeout(() => play(fresh), 150);
                }}
                className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Следующая фраза →
              </button>
            )}
            <label className="ml-auto flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={hints}
                onChange={(event) => setHints(event.target.checked)}
              />
              показывать бокс
            </label>
          </div>
        </>
      )}
    </ExerciseShell>
  );
}
