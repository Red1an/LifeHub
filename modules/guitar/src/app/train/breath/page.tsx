import { disconnectSafely } from "@modules/audio";
import { useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { useMicSource } from "@modules/audio";
import { dayKey, recordScore } from "../../../lib/train-stats";
import { hubStorage } from "../../../lib/storage";

const LOG_KEY = "guitarhub:breath-log";
const END_SILENCE_MS = 450;

interface Attempt {
  day: string;
  seconds: number;
  evenness: number; // 0..100
}

type Phase = "idle" | "calibrating" | "waiting" | "running" | "done";

function loadLog(): Attempt[] {
  try {
    return JSON.parse(hubStorage.getItem(LOG_KEY) ?? "[]") as Attempt[];
  } catch {
    return [];
  }
}

export default function BreathTrainer() {
  const mic = useMicSource();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [last, setLast] = useState<Attempt | null>(null);
  const [log, setLog] = useState<Attempt[]>([]);
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading saved attempts after mount
    setLog(loadLog());
  }, []);

  useEffect(() => {
    const source = mic.source;
    if (!source) return;
    const analyser = source.context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let raf = 0;
    let floorSum = 0;
    let floorCount = 0;
    let threshold = 0.01;
    let calibrateUntil = 0;
    let startedAt = 0;
    let lastLoud = 0;
    const levels: number[] = [];

    const tick = () => {
      raf = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      const rms = Math.sqrt(sum / buffer.length);
      setLevel(Math.min(1, rms / 0.12));
      const now = performance.now();
      const phaseNow = phaseRef.current;

      if (phaseNow === "calibrating") {
        if (!calibrateUntil) calibrateUntil = now + 1000;
        floorSum += rms;
        floorCount++;
        if (now >= calibrateUntil) {
          // A hiss is noisy and pitchless: detect it as sustained level above the room.
          threshold = Math.max(0.0015, (floorSum / floorCount) * 3.5);
          phaseRef.current = "waiting";
          setPhase("waiting");
        }
      } else if (phaseNow === "waiting" && rms > threshold) {
        startedAt = now;
        lastLoud = now;
        levels.length = 0;
        phaseRef.current = "running";
        setPhase("running");
      } else if (phaseNow === "running") {
        if (rms > threshold) {
          lastLoud = now;
          levels.push(rms);
        }
        setElapsed((lastLoud - startedAt) / 1000);
        if (now - lastLoud > END_SILENCE_MS) {
          const seconds = (lastLoud - startedAt) / 1000;
          const mean = levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length);
          const sd = Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, levels.length));
          const evenness = Math.round(Math.max(0, 100 - (sd / Math.max(mean, 1e-6)) * 100));
          const attempt = { day: dayKey(), seconds: Math.round(seconds * 10) / 10, evenness };
          const updated = [...loadLog(), attempt].slice(-50);
          hubStorage.setItem(LOG_KEY, JSON.stringify(updated));
          setLog(updated);
          setLast(attempt);
          recordScore("breath", Math.round(seconds));
          phaseRef.current = "done";
          setPhase("done");
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      disconnectSafely(source, analyser);
    };
  }, [mic.source]);

  function begin() {
    setElapsed(0);
    setLast(null);
    phaseRef.current = "calibrating";
    setPhase("calibrating");
  }

  const best = log.reduce((max, a) => Math.max(max, a.seconds), 0);
  const recent = log.slice(-12);
  const chartMax = Math.max(20, ...recent.map((a) => a.seconds));

  return (
    <ExerciseShell
      title="Дыхание"
      description="Опора голоса — это длинный ровный выдох. Глубоко вдохни животом и выдыхай на «с-с-с» как можно дольше и ровнее. Приложение засечёт время и оценит равномерность."
      accent="rose"
      aside={
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Рекорд</div>
          <div className="text-lg font-semibold tabular-nums">{best ? `${best} с` : "—"}</div>
        </div>
      }
    >
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop}>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
          <span className="text-6xl font-bold tabular-nums">{elapsed.toFixed(1)}</span>
          <span className="text-sm text-zinc-500">секунд</span>
          <div className="h-3 w-full max-w-sm overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-rose-500 transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
          </div>
          <span className="text-sm text-zinc-500">
            {phase === "calibrating"
              ? "Тишина… слушаю фон комнаты"
              : phase === "waiting"
                ? "Вдохни и начинай «с-с-с»"
                : phase === "running"
                  ? "Ровно, не выталкивай воздух"
                  : phase === "done" && last
                    ? `Равномерность ${last.evenness}%`
                    : "Отодвинь телефон на 20–30 см от лица"}
          </span>
        </div>

        <button
          onClick={begin}
          disabled={phase === "calibrating" || phase === "waiting" || phase === "running"}
          className="w-full rounded-2xl bg-rose-600 py-5 text-lg font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          {phase === "done" ? "Ещё раз" : "Начать"}
        </button>

        {recent.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-zinc-500">Последние попытки:</p>
            <div className="flex h-28 items-end gap-1.5">
              {recent.map((a, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-zinc-500">{a.seconds}</span>
                  <div className="w-full rounded-t bg-rose-400" style={{ height: `${(a.seconds / chartMax) * 80}px` }} />
                </div>
              ))}
            </div>
          </div>
        )}
        <ul className="list-disc pl-5 text-xs text-zinc-500">
          <li>Новичку хорошо 15–20 секунд, тренированному певцу — 40+.</li>
          <li>Плечи не поднимаются, живот уходит внутрь медленно и равномерно.</li>
          <li>Равномерность важнее рекорда: ровный слабый поток лучше рывков.</li>
        </ul>
      </MicGate>
    </ExerciseShell>
  );
}
