import { useEffect, useMemo, useRef, useState } from "react";
import { Song } from "../data/songs";
import { parseChordPro, transposeLines, extractUniqueChords } from "../lib/chordpro";
import { ChordDiagram } from "./ChordDiagram";
import { ChordBottomSheet } from "./ChordBottomSheet";

export function SongView({ song }: { song: Song }) {
  const [semitones, setSemitones] = useState(0);
  const [preferFlats, setPreferFlats] = useState(false);
  const [autoscroll, setAutoscroll] = useState(false);
  const [speed, setSpeed] = useState(30); // px per second
  const [activeChord, setActiveChord] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const baseLines = useMemo(() => parseChordPro(song.body), [song.body]);
  const lines = useMemo(
    () => transposeLines(baseLines, semitones, preferFlats),
    [baseLines, semitones, preferFlats]
  );
  const chords = useMemo(() => extractUniqueChords(lines), [lines]);

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
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 sm:gap-4 sm:p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">Тональность:</span>
          <button
            className="rounded bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-sm"
            onClick={() => setSemitones((s) => s - 1)}
          >
            −
          </button>
          <span className="w-16 text-center text-sm font-medium">
            {semitones === 0 ? song.key : `${semitones > 0 ? "+" : ""}${semitones}`}
          </span>
          <button
            className="rounded bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-sm"
            onClick={() => setSemitones((s) => s + 1)}
          >
            +
          </button>
          {semitones !== 0 && (
            <button
              className="text-xs text-zinc-500 underline"
              onClick={() => setSemitones(0)}
            >
              сброс
            </button>
          )}
        </div>

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={preferFlats}
            onChange={(e) => setPreferFlats(e.target.checked)}
          />
          бемоли (♭)
        </label>

        <div className="flex items-center gap-2">
          <button
            className={`rounded px-3 py-1.5 text-sm ${
              autoscroll
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800"
            }`}
            onClick={() => setAutoscroll((v) => !v)}
          >
            {autoscroll ? "⏸" : "▶"} Прокрутка
          </button>
          <input
            type="range"
            min={10}
            max={100}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-20 sm:w-24"
            title="Скорость прокрутки"
          />
        </div>

        {song.capo !== undefined && (
          <span className="text-sm text-zinc-500">Каподастр: {song.capo}</span>
        )}
      </div>

      {chords.length > 0 && (
        <div className="flex flex-wrap gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          {chords.map((c) => (
            <button key={c} onClick={() => setActiveChord(c)}>
              <ChordDiagram chord={c} size={64} />
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-500 sm:hidden">
        Совет: нажми на любой аккорд прямо в тексте, чтобы увидеть его аппликатуру.
      </p>

      <div
        ref={scrollRef}
        className="max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 font-mono text-sm leading-8 whitespace-pre sm:p-6"
      >
        {lines.map((line, i) => {
          if (line.type === "blank") return <div key={i} className="h-4" />;
          if (line.type === "section") {
            return (
              <div
                key={i}
                className="mt-4 mb-1 font-sans text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
              >
                {line.label}
              </div>
            );
          }
          return (
            <div key={i} className="relative mt-4 whitespace-pre-wrap first:mt-0">
              {line.tokens.map((t, j) =>
                t.chord ? (
                  <span key={j} className="relative">
                    <button
                      onClick={() => setActiveChord(t.chord)}
                      className="absolute -top-4 left-0 text-emerald-600 dark:text-emerald-400 font-sans text-xs font-semibold hover:underline"
                    >
                      {t.chord}
                    </button>
                    {t.text || " "}
                  </span>
                ) : (
                  <span key={j}>{t.text}</span>
                )
              )}
            </div>
          );
        })}
      </div>

      <ChordBottomSheet chord={activeChord} onClose={() => setActiveChord(null)} />
    </div>
  );
}
