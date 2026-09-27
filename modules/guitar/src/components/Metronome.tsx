import { useEffect, useRef, useState } from "react";
import { getAudioContext } from "@modules/audio";
import { playClick } from "@modules/audio";

export function Metronome() {
  const [bpm, setBpm] = useState(90);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(0);

  const timerRef = useRef<number | null>(null);
  const nextTimeRef = useRef(0);
  const beatCountRef = useRef(0);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    const ctx = getAudioContext();
    nextTimeRef.current = ctx.currentTime;
    beatCountRef.current = 0;

    const scheduleAheadTime = 0.15;
    const lookahead = 25; // ms

    timerRef.current = window.setInterval(() => {
      const secondsPerBeat = 60 / bpm;
      while (nextTimeRef.current < ctx.currentTime + scheduleAheadTime) {
        const accent = beatCountRef.current % beatsPerBar === 0;
        const when = nextTimeRef.current - ctx.currentTime;
        playClick(accent, Math.max(0, when));
        const beatIdx = beatCountRef.current % beatsPerBar;
        setTimeout(() => setBeat(beatIdx), Math.max(0, when * 1000));
        nextTimeRef.current += secondsPerBeat;
        beatCountRef.current += 1;
      }
    }, lookahead);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [running, bpm, beatsPerBar]);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{bpm} BPM</span>
        <button
          onClick={() => setRunning((r) => !r)}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            running
              ? "bg-red-600 text-white"
              : "bg-emerald-600 text-white"
          }`}
        >
          {running ? "Стоп" : "Старт"}
        </button>
      </div>

      <input
        type="range"
        min={40}
        max={220}
        value={bpm}
        onChange={(e) => setBpm(Number(e.target.value))}
        className="w-full"
      />

      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-500">Размер такта:</span>
        {[2, 3, 4, 6].map((n) => (
          <button
            key={n}
            onClick={() => setBeatsPerBar(n)}
            className={`rounded px-2 py-1 text-sm ${
              beatsPerBar === n
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        {Array.from({ length: beatsPerBar }).map((_, i) => (
          <div
            key={i}
            className={`h-3 flex-1 rounded-full transition-colors ${
              running && beat === i
                ? i === 0
                  ? "bg-emerald-600"
                  : "bg-emerald-400"
                : "bg-zinc-200 dark:bg-zinc-800"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
