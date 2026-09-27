import { useCallback, useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { playClick } from "@modules/audio";
import { getAudioContext, unlockAudio } from "@modules/audio";
import { recordScore } from "../../../lib/train-stats";

const TAPS_PER_ROUND = 16;
const PERFECT_MS = 25;
const GOOD_MS = 70;

interface Hit {
  errorMs: number;
}

export default function RhythmTrainer() {
  const [bpm, setBpm] = useState(80);
  const [subdivision, setSubdivision] = useState(1); // 1 = quarters, 2 = eighths
  const [running, setRunning] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [beat, setBeat] = useState(0);
  const [lastError, setLastError] = useState<number | null>(null);

  const timerRef = useRef<number | null>(null);
  const nextTimeRef = useRef(0);
  const beatIndexRef = useRef(0);
  // Scheduled beat times (audio clock) still available for matching taps.
  const pendingRef = useRef<number[]>([]);

  const stop = useCallback(() => {
    setRunning(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    const audio = getAudioContext();
    const interval = 60 / bpm / subdivision;
    nextTimeRef.current = audio.currentTime + 0.2;
    beatIndexRef.current = 0;
    pendingRef.current = [];

    timerRef.current = window.setInterval(() => {
      while (nextTimeRef.current < audio.currentTime + 0.15) {
        const index = beatIndexRef.current;
        const when = Math.max(0, nextTimeRef.current - audio.currentTime);
        const isDownbeat = index % (4 * subdivision) === 0;
        playClick(isDownbeat, when, subdivision === 2 && index % 2 === 1 ? 0.5 : 1);

        pendingRef.current.push(nextTimeRef.current);
        if (pendingRef.current.length > 16) pendingRef.current.shift();

        const beatInBar = Math.floor(index / subdivision) % 4;
        window.setTimeout(() => setBeat(beatInBar), when * 1000);

        nextTimeRef.current += interval;
        beatIndexRef.current += 1;
      }
    }, 25);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [running, bpm, subdivision]);

  const registerTap = useCallback(() => {
    if (!running) return;
    const audio = getAudioContext();
    const now = audio.currentTime;
    const interval = 60 / bpm / subdivision;

    // Nearest scheduled beat, including the next one that has not sounded yet.
    const candidates = [...pendingRef.current, nextTimeRef.current];
    let closest = candidates[0];
    for (const time of candidates) {
      if (Math.abs(time - now) < Math.abs(closest - now)) closest = time;
    }
    const errorMs = (now - closest) * 1000;
    // A tap more than half a beat away is not a hit at all.
    if (Math.abs(errorMs) > (interval * 1000) / 2) return;

    setLastError(errorMs);
    setHits((previous) => {
      const next = [...previous, { errorMs }];
      if (next.length >= TAPS_PER_ROUND) {
        const accurate = next.filter((hit) => Math.abs(hit.errorMs) <= GOOD_MS).length;
        recordScore("rhythm", Math.round((accurate / next.length) * 100));
        stop();
      }
      return next;
    });
  }, [running, bpm, subdivision, stop]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        registerTap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registerTap]);

  async function toggle() {
    if (!running) {
      await unlockAudio();
      setHits([]);
      setLastError(null);
    }
    setRunning((value) => !value);
  }

  const averageError = hits.length
    ? hits.reduce((sum, hit) => sum + Math.abs(hit.errorMs), 0) / hits.length
    : 0;
  const accurate = hits.filter((hit) => Math.abs(hit.errorMs) <= GOOD_MS).length;
  const verdict =
    lastError === null
      ? null
      : Math.abs(lastError) <= PERFECT_MS
        ? "Идеально"
        : Math.abs(lastError) <= GOOD_MS
          ? lastError < 0 ? "Чуть раньше" : "Чуть позже"
          : lastError < 0 ? "Рано" : "Поздно";

  return (
    <ExerciseShell
      title="Чувство ритма"
      description="Запусти метроном и попадай в долю: жми большую кнопку или пробел. Точность считается в миллисекундах относительно клика."
      accent="amber"
    >
      <div className="mb-4 flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-lg font-semibold tabular-nums">{bpm} BPM</span>
          <button
            onClick={toggle}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white ${
              running ? "bg-red-600" : "bg-amber-600 hover:bg-amber-700"
            }`}
          >
            {running ? "Стоп" : "Старт"}
          </button>
        </div>
        <input
          type="range"
          min={40}
          max={180}
          value={bpm}
          onChange={(event) => setBpm(Number(event.target.value))}
          className="w-full"
        />
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-500">Доли:</span>
          {[
            { value: 1, label: "Четверти" },
            { value: 2, label: "Восьмые" },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setSubdivision(option.value)}
              className={`rounded px-2.5 py-1 ${
                subdivision === option.value
                  ? "bg-amber-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className={`h-2.5 flex-1 rounded-full transition-colors ${
              running && beat === index
                ? index === 0
                  ? "bg-amber-600"
                  : "bg-amber-400"
                : "bg-zinc-200 dark:bg-zinc-800"
            }`}
          />
        ))}
      </div>

      <button
        onPointerDown={registerTap}
        disabled={!running}
        className="mb-4 w-full rounded-3xl bg-amber-500 py-16 text-2xl font-bold text-white transition-transform active:scale-[0.98] disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800"
      >
        {running ? "ТАП" : "Нажми «Старт»"}
      </button>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Тапов</div>
          <div className="text-lg font-semibold tabular-nums">
            {hits.length}
            <span className="text-zinc-400">/{TAPS_PER_ROUND}</span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">В точку</div>
          <div className="text-lg font-semibold tabular-nums">{accurate}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Средняя</div>
          <div className="text-lg font-semibold tabular-nums">
            {hits.length ? `${Math.round(averageError)} мс` : "—"}
          </div>
        </div>
      </div>

      {verdict && (
        <div
          className={`mt-4 rounded-xl px-4 py-3 text-center text-sm font-medium ${
            Math.abs(lastError ?? 0) <= GOOD_MS
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {verdict} · {lastError! > 0 ? "+" : ""}
          {Math.round(lastError!)} мс
        </div>
      )}

      {hits.length >= TAPS_PER_ROUND && (
        <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 text-center">
          <div className="text-4xl font-bold text-amber-500">
            {Math.round((accurate / hits.length) * 100)}%
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Средняя погрешность {Math.round(averageError)} мс
          </p>
        </div>
      )}
    </ExerciseShell>
  );
}
