import { useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { useMicSource } from "@modules/audio";
import { useOnsetRecorder } from "@modules/audio";
import { LatencyCalibration } from "../../../components/train/LatencyCalibration";
import { TimingChart, timingAdvice } from "../../../components/train/TimingChart";
import { startMetronome, ClickSound } from "@modules/audio";
import { getAudioContext, unlockAudio } from "@modules/audio";
import { analyzeTiming, TimingSummary } from "@modules/audio";
import { recordScore } from "../../../lib/train-stats";

const SUBDIVISIONS = [
  { value: 1, label: "Четверти" },
  { value: 2, label: "Восьмые" },
  { value: 3, label: "Триоли" },
  { value: 4, label: "Шестнадцатые" },
];

type Phase = "idle" | "countin" | "playing" | "done";

export default function RhythmMicTrainer() {
  const mic = useMicSource();
  const recorder = useOnsetRecorder(mic.source);
  const [bpm, setBpm] = useState(80);
  const [subdivision, setSubdivision] = useState(2);
  const [bars, setBars] = useState(4);
  const [sound, setSound] = useState<ClickSound>("blip");
  const [phase, setPhase] = useState<Phase>("idle");
  const [beat, setBeat] = useState(0);
  const [result, setResult] = useState<TimingSummary | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  async function run() {
    await unlockAudio();
    await recorder.start();
    setResult(null);
    setPhase("countin");

    const expected: number[] = [];
    const perBar = 4 * subdivision;
    const total = perBar * (bars + 1); // +1 bar of count-in
    let finished = false;

    const metronome = startMetronome({
      getBpm: () => bpm,
      subdivision,
      sound,
      startDelay: 0.3,
      onTick: (time, index, info) => {
        if (index >= total) return;
        if (index >= perBar) expected.push(time);
        const wait = Math.max(0, (time - getAudioContext().currentTime) * 1000);
        window.setTimeout(() => {
          if (finished) return;
          setBeat(info.beat);
          if (index === perBar) setPhase("playing");
        }, wait);
        if (index === total - 1) {
          const tail = wait + (60 / bpm / subdivision) * 1000 + 400;
          window.setTimeout(() => {
            finished = true;
            metronome.stop();
            recorder.stop();
            const window_ = (60 / bpm / subdivision) * 0.5;
            const summary = analyzeTiming(expected, recorder.onsetsRef.current, window_);
            setResult(summary);
            setPhase("done");
            recordScore("rhythm-mic", summary.score);
          }, tail);
        }
      },
    });
    stopRef.current = () => {
      finished = true;
      metronome.stop();
      recorder.stop();
    };
  }

  function cancel() {
    stopRef.current?.();
    setPhase("idle");
  }

  const busy = phase === "countin" || phase === "playing";

  return (
    <ExerciseShell
      title="Ритм-анализ игры"
      description="Играй под метроном — микрофон слышит каждую ноту и показывает, где ты спешишь, где тянешь и насколько ровно держишь доли."
      accent="amber"
    >
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop}>
        <LatencyCalibration source={mic.source} />

        <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold tabular-nums">{bpm} BPM</span>
            <span className="text-sm text-zinc-500">{bars} такта</span>
          </div>
          <input type="range" min={40} max={180} value={bpm} disabled={busy} onChange={(e) => setBpm(Number(e.target.value))} />
          <div className="flex flex-wrap gap-2 text-sm">
            {SUBDIVISIONS.map((s) => (
              <button
                key={s.value}
                disabled={busy}
                onClick={() => setSubdivision(s.value)}
                className={`rounded-lg px-3 py-1.5 ${subdivision === s.value ? "bg-amber-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-zinc-500">Длина:</span>
            {[2, 4, 8].map((n) => (
              <button
                key={n}
                disabled={busy}
                onClick={() => setBars(n)}
                className={`rounded px-2.5 py-1 ${bars === n ? "bg-amber-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
              >
                {n}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5">
              <input type="checkbox" checked={sound === "none"} disabled={busy} onChange={(e) => setSound(e.target.checked ? "none" : "blip")} />
              метроном без звука (только мигание)
            </label>
          </div>
        </div>

        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-3 flex-1 rounded-full transition-colors ${
                busy && beat === i ? (phase === "countin" ? "bg-zinc-400" : i === 0 ? "bg-amber-600" : "bg-amber-400") : "bg-zinc-200 dark:bg-zinc-800"
              }`}
            />
          ))}
        </div>

        <button
          onClick={busy ? cancel : run}
          className={`w-full rounded-2xl py-5 text-lg font-semibold text-white ${busy ? "bg-red-600" : "bg-amber-600 hover:bg-amber-700"}`}
        >
          {phase === "countin" ? "Отсчёт… приготовься" : phase === "playing" ? "Играй! (стоп)" : "Начать запись"}
        </button>

        <p className="text-xs text-zinc-500">
          Играй одну ноту или глухой удар на каждый щелчок и приглушай струны
          ладонью — отрывистая игра даёт самый точный замер. Лучше в наушниках.
        </p>

        {result && (
          <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <Stat label="Оценка" value={`${result.score}%`} accent />
              <Stat label="Смещение" value={`${result.meanMs > 0 ? "+" : ""}${Math.round(result.meanMs)} мс`} />
              <Stat label="Разброс" value={`±${Math.round(result.spreadMs)} мс`} />
              <Stat label="Пропуски / лишние" value={`${result.missed} / ${result.extra}`} />
            </div>
            <TimingChart matches={result.matches} />
            <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
              {timingAdvice(result.meanMs, result.spreadMs, result.missed, result.matches.length).map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </div>
        )}
      </MicGate>
    </ExerciseShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div>
    </div>
  );
}
