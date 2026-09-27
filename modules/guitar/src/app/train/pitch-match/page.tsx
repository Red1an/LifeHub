import { useEffect, useRef, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { PitchMeter } from "../../../components/train/PitchMeter";
import { MicGate } from "../../../components/train/MicGate";
import { useMicPitch } from "@modules/audio";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { centsBetween, midiToName, midiToSolfege } from "../../../lib/music-theory";
import { randomInt } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const ROUND_LENGTH = 8;
const HOLD_MS = 1200; // how long you must stay in tune to score
const TOLERANCE = 35; // cents

const VOICE_RANGES = [
  { id: "low", label: "Низкий голос", min: 43, max: 57 },
  { id: "mid", label: "Средний", min: 48, max: 64 },
  { id: "high", label: "Высокий", min: 55, max: 72 },
];

export default function PitchMatchTrainer() {
  const { state, pitch, level, start, stop } = useMicPitch();
  const [range, setRange] = useState(VOICE_RANGES[1]);
  // Fixed on the server, randomised after mount — picking at render time
  // would make the server and client render different notes.
  const [target, setTarget] = useState(55);
  const [held, setHeld] = useState(0);
  const [done, setDone] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [finished, setFinished] = useState(false);
  const holdStartRef = useRef<number | null>(null);

  const cents = pitch ? centsBetween(pitch.frequency, target) : null;
  const inTune = cents !== null && Math.abs(cents) <= TOLERANCE;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only randomisation, see above
    setTarget(randomInt(VOICE_RANGES[1].min, VOICE_RANGES[1].max));
  }, []);

  const inTuneRef = useRef(false);
  const rangeRef = useRef(range);
  useEffect(() => {
    inTuneRef.current = inTune && !finished;
  }, [inTune, finished]);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Track how long the singer stays within tolerance. Driven by an animation
  // frame loop rather than the pitch effect so the progress bar keeps moving
  // even on frames where the detector drops out.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!inTuneRef.current) {
        holdStartRef.current = null;
        setHeld(0);
        return;
      }
      if (holdStartRef.current === null) holdStartRef.current = performance.now();
      const elapsed = performance.now() - holdStartRef.current;
      if (elapsed < HOLD_MS) {
        setHeld(elapsed / HOLD_MS);
        return;
      }

      holdStartRef.current = null;
      inTuneRef.current = false;
      setHeld(0);
      setCorrect((value) => value + 1);
      setDone((value) => {
        const next = value + 1;
        if (next >= ROUND_LENGTH) setFinished(true);
        return next;
      });
      setTarget(randomInt(rangeRef.current.min, rangeRef.current.max));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (finished) {
      recordScore("pitch-match", Math.round((correct / ROUND_LENGTH) * 100));
    }
  }, [finished, correct]);

  function playTarget(midi = target) {
    void unlockAudio();
    playGuitarNote(midi, { gain: 0.7 });
  }

  function skip() {
    setDone((value) => {
      const next = value + 1;
      if (next >= ROUND_LENGTH) setFinished(true);
      return next;
    });
    const nextTarget = randomInt(range.min, range.max);
    setTarget(nextTarget);
    holdStartRef.current = null;
    setHeld(0);
    setTimeout(() => playTarget(nextTarget), 150);
  }

  function restart(nextRange = range) {
    setRange(nextRange);
    setDone(0);
    setCorrect(0);
    setFinished(false);
    setHeld(0);
    holdStartRef.current = null;
    setTarget(randomInt(nextRange.min, nextRange.max));
  }

  return (
    <ExerciseShell
      title="Попадание в ноту"
      description="Звучит нота — спой её и удержи полторы секунды. Стрелка показывает, выше или ниже ты поёшь, прямо в реальном времени."
      accent="rose"
      aside={<ScoreBadge correct={correct} total={ROUND_LENGTH} />}
    >
      <MicGate state={state} onStart={start} onStop={stop} level={level}>
        {finished ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
            <div className="text-5xl font-bold text-rose-500">
              {Math.round((correct / ROUND_LENGTH) * 100)}%
            </div>
            <p className="text-sm text-zinc-500">
              Спето точно: {correct} из {ROUND_LENGTH}
            </p>
            <button
              onClick={() => restart()}
              className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white hover:bg-rose-700"
            >
              Ещё раунд
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {VOICE_RANGES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => restart(item)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    range.id === item.id
                      ? "bg-rose-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-5">
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                Спой эту ноту
              </span>
              <span className="text-4xl font-bold">{midiToName(target)}</span>
              <span className="text-sm text-zinc-500">{midiToSolfege(target)}</span>
              <button
                onClick={() => playTarget()}
                className="mt-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                ▶ Проиграть ноту
              </button>
              <span className="text-xs text-zinc-400">
                Нота {done + 1} из {ROUND_LENGTH}
              </span>
            </div>

            <PitchMeter
              cents={cents}
              midi={pitch ? target : null}
              tolerance={TOLERANCE}
              caption="Спой ноту в микрофон"
            />

            <div>
              <div className="mb-1 flex justify-between text-xs text-zinc-500">
                <span>Удержание</span>
                <span>{Math.round(held * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-100"
                  style={{ width: `${held * 100}%` }}
                />
              </div>
            </div>

            <button
              onClick={skip}
              className="self-center text-sm text-zinc-500 hover:underline"
            >
              Пропустить ноту →
            </button>
          </>
        )}
      </MicGate>
    </ExerciseShell>
  );
}
