import { useEffect, useRef, useState } from "react";
import { Song } from "../data/songs";

export function TabView({ song }: { song: Song }) {
  const [autoscroll, setAutoscroll] = useState(false);
  const [speed, setSpeed] = useState(20);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoscroll) return;
    let raf: number;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const el = scrollRef.current;
      if (el) {
        el.scrollTop += speed * dt;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight) {
          setAutoscroll(false);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoscroll, speed]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 sm:p-4">
        <button
          className={`rounded px-3 py-1.5 text-sm ${
            autoscroll ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"
          }`}
          onClick={() => setAutoscroll((v) => !v)}
        >
          {autoscroll ? "⏸" : "▶"} Прокрутка
        </button>
        <input
          type="range"
          min={5}
          max={80}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="w-20 sm:w-24"
          title="Скорость прокрутки"
        />
        {song.capo !== undefined && (
          <span className="text-sm text-zinc-500">Каподастр: {song.capo}</span>
        )}
      </div>

      <p className="text-xs text-zinc-500 sm:hidden">
        Листай таб горизонтально пальцем — строки со струнами шире экрана.
      </p>

      <div
        ref={scrollRef}
        className="max-h-[65vh] overflow-y-auto overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6"
      >
        <pre className="font-mono text-xs leading-6 sm:text-sm sm:leading-7">
          {song.body}
        </pre>
      </div>
    </div>
  );
}
