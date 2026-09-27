import { useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { useMicSource } from "@modules/audio";
import { useOnsetRecorder } from "@modules/audio";
import { LatencyCalibration } from "../../../components/train/LatencyCalibration";
import { startMetronome } from "@modules/audio";
import { getAudioContext, unlockAudio } from "@modules/audio";
import { analyzeTiming } from "@modules/audio";
import { recordScore } from "../../../lib/train-stats";

const SUBDIVISIONS = [
  { value: 2, label: "Восьмые" },
  { value: 3, label: "Триоли" },
  { value: 4, label: "Шестнадцатые" },
];

interface BarResult {
  bpm: number;
  clean: boolean;
}

// A bar counts as clean when nothing is missed or added and nearly every note
// lands within 35 ms of its click.
function isClean(summary: ReturnType<typeof analyzeTiming>, notes: number) {
  return summary.missed === 0 && summary.extra === 0 && summary.good >= Math.ceil(notes * 0.85) && Math.abs(summary.meanMs) < 30;
}

export default function SpeedTrainer() {
  const mic = useMicSource();
  const recorder = useOnsetRecorder(mic.source);
  const [startBpm, setStartBpm] = useState(70);
  const [targetBpm, setTargetBpm] = useState(120);
  const [step, setStep] = useState(4);
  const [subdivision, setSubdivision] = useState(4);
  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(70);
  const [bars, setBars] = useState<BarResult[]>([]);
  const [message, setMessage] = useState("");
  const bpmRef = useRef(70);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    await unlockAudio();
    await recorder.start();
    const audio = getAudioContext();
    bpmRef.current = startBpm;
    setBpm(startBpm);
    setBars([]);
    setMessage("Отсчёт — вступай со второго такта");
    setRunning(true);

    const perBar = 4 * subdivision;
    const ticks: { time: number; bar: number }[] = [];
    let cleanStreak = 0;
    let best = 0;
    let evaluatedBar = 0; // bar 0 is the count-in
    let stopped = false;

    const metronome = startMetronome({
      getBpm: () => bpmRef.current,
      subdivision,
      sound: "blip",
      startDelay: 0.3,
      onTick: (time, _index, info) => ticks.push({ time, bar: info.bar }),
    });

    // Judge each bar once its last note (plus a margin) is safely in the past.
    const judge = window.setInterval(() => {
      if (stopped) return;
      const next = evaluatedBar + 1;
      const barTicks = ticks.filter((t) => t.bar === next).map((t) => t.time);
      if (barTicks.length < perBar) return;
      const interval = barTicks[1] - barTicks[0];
      if (audio.currentTime < barTicks[barTicks.length - 1] + interval * 0.6 + 0.08) return;
      evaluatedBar = next;

      const onsets = recorder.onsetsRef.current.filter(
        (o) => o.time > barTicks[0] - interval * 0.5 && o.time < barTicks[barTicks.length - 1] + interval * 0.5
      );
      const summary = analyzeTiming(barTicks, onsets, interval * 0.5, 35);
      const clean = isClean(summary, perBar);
      const played = bpmRef.current;
      setBars((list) => [...list, { bpm: played, clean }]);

      if (clean) {
        best = Math.max(best, played);
        cleanStreak++;
        if (played >= targetBpm && cleanStreak >= 2) {
          setMessage(`Цель ${targetBpm} BPM взята чисто!`);
          finish();
          return;
        }
        if (cleanStreak >= 2) {
          cleanStreak = 0;
          bpmRef.current = Math.min(targetBpm, played + step);
          setBpm(bpmRef.current);
          setMessage(`Чисто — темп ${bpmRef.current}`);
        } else {
          setMessage("Чисто, ещё такт на этом темпе");
        }
      } else {
        cleanStreak = 0;
        bpmRef.current = Math.max(startBpm, played - step);
        setBpm(bpmRef.current);
        const why = summary.missed ? "пропущены ноты" : summary.extra ? "лишние ноты" : Math.abs(summary.meanMs) >= 30 ? (summary.meanMs < 0 ? "спешишь" : "тянешь") : "неровно";
        setMessage(`Грязно (${why}) — темп ${bpmRef.current}`);
      }
    }, 50);

    function finish() {
      stopped = true;
      metronome.stop();
      window.clearInterval(judge);
      recorder.stop();
      setRunning(false);
      if (best > 0) recordScore("speed", best);
    }
    stopRef.current = finish;
  }

  const best = bars.filter((b) => b.clean).reduce((max, b) => Math.max(max, b.bpm), 0);
  const chartMax = Math.max(targetBpm, ...bars.map((b) => b.bpm));
  const chartMin = Math.min(startBpm, ...bars.map((b) => b.bpm)) - 5;

  return (
    <ExerciseShell
      title="Спид-тренер"
      description="Выбери упражнение (гамму, хроматику, рифф) и играй его под метроном. Каждые два чистых такта темп растёт, на грязном — откатывается. Так скорость набирается без потери качества."
      aside={
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Чистый рекорд</div>
          <div className="text-lg font-semibold tabular-nums">{best || "—"} BPM</div>
        </div>
      }
    >
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop}>
        <LatencyCalibration source={mic.source} />

        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:grid-cols-3">
          {[
            { label: "Старт", value: startBpm, set: setStartBpm, min: 40, max: 200 },
            { label: "Цель", value: targetBpm, set: setTargetBpm, min: 50, max: 240 },
            { label: "Шаг", value: step, set: setStep, min: 1, max: 10 },
          ].map((field) => (
            <label key={field.label} className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">
                {field.label}: <b className="text-zinc-900 dark:text-zinc-100">{field.value}</b>
              </span>
              <input
                type="range"
                min={field.min}
                max={field.max}
                value={field.value}
                disabled={running}
                onChange={(e) => field.set(Number(e.target.value))}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2 text-sm sm:col-span-3">
            {SUBDIVISIONS.map((s) => (
              <button
                key={s.value}
                disabled={running}
                onClick={() => setSubdivision(s.value)}
                className={`rounded-lg px-3 py-1.5 ${subdivision === s.value ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 dark:bg-zinc-900 p-4">
          <div>
            <div className="text-4xl font-bold tabular-nums">{bpm}</div>
            <div className="text-xs text-zinc-500">текущий темп</div>
          </div>
          <div className="max-w-[60%] text-right text-sm">{message}</div>
        </div>

        <button
          onClick={running ? () => stopRef.current?.() : start}
          className={`w-full rounded-2xl py-5 text-lg font-semibold text-white ${running ? "bg-red-600" : "bg-emerald-600 hover:bg-emerald-700"}`}
        >
          {running ? "Стоп" : "Начать"}
        </button>

        {bars.length > 0 && (
          <svg viewBox="0 0 640 140" className="w-full rounded-xl bg-zinc-50 dark:bg-zinc-900">
            {bars.map((b, i) => {
              const w = Math.min(24, 620 / bars.length);
              const h = ((b.bpm - chartMin) / (chartMax - chartMin)) * 120;
              return (
                <rect
                  key={i}
                  x={10 + i * w}
                  y={130 - h}
                  width={w - 2}
                  height={h}
                  rx={2}
                  className={b.clean ? "fill-emerald-500" : "fill-red-400"}
                />
              );
            })}
          </svg>
        )}
        <p className="text-xs text-zinc-500">
          Зелёный столбик — чистый такт, красный — грязный. Играй отрывисто, одна
          нота на щелчок; лучше в наушниках.
        </p>
      </MicGate>
    </ExerciseShell>
  );
}
