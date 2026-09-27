import { useEffect, useRef, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { useMicSource } from "@modules/audio";
import { ChordDiagram } from "../../../components/ChordDiagram";
import { bassPitchClass, chromaFromSpectrum, matchChord, sameChord, ChordCandidate } from "@modules/audio";
import { strumChord } from "../../../lib/audio/guitar-synth";
import { disconnectSafely, unlockAudio } from "@modules/audio";
import { resolveChordShape } from "../../../lib/resolve-chord";
import { pickRandom } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const FFT = 16384;
const ROUNDS = 10;
const HOLD_FRAMES = 12;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const LEVELS = [
  { id: "open", label: "Открытые", chords: ["C", "G", "D", "Am", "Em", "E", "A", "Dm"] },
  { id: "more", label: "+ баррэ и септаккорды", chords: ["C", "G", "D", "Am", "Em", "E", "A", "Dm", "F", "Bm", "B7", "E7", "A7", "D7", "G7", "C7"] },
  { id: "color", label: "+ краски (maj7, sus)", chords: ["Cmaj7", "Fmaj7", "Am7", "Dsus4", "Asus2", "Csus4", "G7", "E7", "F", "Bm"] },
];

const base = (name: string) => name.replace(/(maj7|m7|7|sus2|sus4|5)$/, (m) => (m === "m7" ? "m" : ""));

/** A lone seventh on one string is easy to under-hear, so accept "triad on top, seventh a close second". */
function heardAs(candidates: ChordCandidate[], target: string): boolean {
  if (!candidates.length) return false;
  if (sameChord(candidates[0].name, target)) return true;
  const second = candidates[1];
  return !!second && sameChord(second.name, target) && sameChord(base(candidates[0].name), base(target));
}

export default function ChordCheck() {
  const mic = useMicSource();
  const [mode, setMode] = useState<"task" | "free">("task");
  const [level, setLevel] = useState(LEVELS[0]);
  const [target, setTarget] = useState("C");
  const [candidates, setCandidates] = useState<ChordCandidate[]>([]);
  const [chroma, setChroma] = useState<number[]>(new Array(12).fill(0));
  const [sounding, setSounding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const [flash, setFlash] = useState<"ok" | null>(null);

  const targetRef = useRef(target);
  const modeRef = useRef(mode);
  const holdRef = useRef(0);
  const lockedRef = useRef(false);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random first chord is picked client-side
    setTarget(pickRandom(LEVELS[0].chords));
  }, []);

  useEffect(() => {
    const source = mic.source;
    if (!source) return;
    const context = source.context as AudioContext;
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const wave = new Float32Array(2048);
    const smoothed = new Float32Array(12);
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
      const loud = Math.sqrt(sum / wave.length) > 0.002;
      setSounding(loud);
      if (!loud) {
        holdRef.current = 0;
        setProgress(0);
        return;
      }
      analyser.getFloatFrequencyData(spectrum);
      const frame = chromaFromSpectrum(spectrum, context.sampleRate, FFT);
      for (let i = 0; i < 12; i++) smoothed[i] = smoothed[i] * 0.65 + frame[i] * 0.35;
      const found = matchChord(smoothed, bassPitchClass(spectrum, context.sampleRate, FFT), 3);
      setCandidates(found);
      setChroma(Array.from(smoothed));

      if (modeRef.current !== "task" || lockedRef.current) return;
      if (heardAs(found, targetRef.current)) {
        holdRef.current++;
        setProgress(Math.min(1, holdRef.current / HOLD_FRAMES));
        if (holdRef.current >= HOLD_FRAMES) {
          lockedRef.current = true;
          setFlash("ok");
          setStats((s) => ({ correct: s.correct + 1, total: s.total + 1 }));
        }
      } else {
        holdRef.current = Math.max(0, holdRef.current - 1);
        setProgress(holdRef.current / HOLD_FRAMES);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      disconnectSafely(source, analyser);
    };
  }, [mic.source]);

  const recordedRef = useRef(false);
  useEffect(() => {
    if (stats.total === ROUNDS && !recordedRef.current) {
      recordedRef.current = true;
      recordScore("chord-check", Math.round((stats.correct / ROUNDS) * 100));
    }
    if (stats.total === 0) recordedRef.current = false;
  }, [stats]);

  function nextChord(skip = false) {
    if (skip) setStats((s) => ({ ...s, total: s.total + 1 }));
    const options = level.chords.filter((c) => c !== target);
    setTarget(pickRandom(options));
    setFlash(null);
    holdRef.current = 0;
    lockedRef.current = false;
    setProgress(0);
  }

  function restart(nextLevel = level) {
    setLevel(nextLevel);
    setStats({ correct: 0, total: 0 });
    setTarget(pickRandom(nextLevel.chords));
    setFlash(null);
    holdRef.current = 0;
    lockedRef.current = false;
  }

  const finished = stats.total >= ROUNDS;
  const heard = sounding && candidates[0] ? candidates[0].name : null;

  return (
    <ExerciseShell
      title="Проверка аккорда"
      description="Поставь аккорд и ударь по струнам — приложение по звуку определит, что прозвучало. Если какая-то струна заглушена или ноту взял не ту, аккорд «поплывёт»."
      aside={mode === "task" ? <ScoreBadge correct={stats.correct} total={ROUNDS} /> : undefined}
    >
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop}>
        <div className="flex flex-wrap gap-2">
          {(["task", "free"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
            >
              {m === "task" ? "Задание" : "Свободно: что я играю?"}
            </button>
          ))}
          {mode === "task" &&
            LEVELS.map((item) => (
              <button
                key={item.id}
                onClick={() => restart(item)}
                className={`rounded-lg px-3 py-1.5 text-sm ${level.id === item.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}
              >
                {item.label}
              </button>
            ))}
        </div>

        {mode === "task" && !finished && (
          <div
            className={`grid grid-cols-1 gap-4 rounded-2xl border-2 p-4 sm:grid-cols-2 ${
              flash === "ok" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Сыграй</span>
              <span className="text-4xl font-bold">{target}</span>
              <ChordDiagram chord={target} size={110} />
              <button
                onClick={() => {
                  void unlockAudio();
                  const shape = resolveChordShape(target);
                  if (shape) strumChord(shape.frets);
                }}
                className="text-sm text-emerald-600 hover:underline dark:text-emerald-400"
              >
                ▶ как должно звучать
              </button>
            </div>
            <div className="flex flex-col items-center justify-center gap-3">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Слышу</span>
              <span className={`text-4xl font-bold ${heard && heardAs(candidates, target) ? "text-emerald-500" : ""}`}>
                {heard ?? "—"}
              </span>
              <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
              {flash === "ok" ? (
                <button onClick={() => nextChord()} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white">
                  Отлично! Следующий →
                </button>
              ) : (
                <button onClick={() => nextChord(true)} className="text-sm text-zinc-500 hover:underline">
                  Пропустить
                </button>
              )}
            </div>
          </div>
        )}

        {mode === "task" && finished && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
            <div className="text-5xl font-bold text-emerald-500">{Math.round((stats.correct / ROUNDS) * 100)}%</div>
            <p className="text-sm text-zinc-500">Чисто сыграно {stats.correct} из {ROUNDS}</p>
            <button onClick={() => restart()} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white">
              Ещё раунд
            </button>
          </div>
        )}

        {mode === "free" && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
            <span className="text-5xl font-bold">{heard ?? "—"}</span>
            <span className="text-sm text-zinc-500">
              {sounding && candidates.length > 1
                ? `может быть: ${candidates.slice(1).map((c) => c.name).join(", ")}`
                : "сыграй аккорд"}
            </span>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs text-zinc-500">Какие ноты звучат (хромаграмма):</p>
          <div className="flex h-24 items-end gap-1">
            {chroma.map((value, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-emerald-500/80" style={{ height: `${Math.round(value * 72)}px` }} />
                <span className="text-[10px] text-zinc-500">{NOTE_NAMES[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </MicGate>
    </ExerciseShell>
  );
}
