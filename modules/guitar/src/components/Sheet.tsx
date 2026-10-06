import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { placeChords, wrapPair, wrapTab, type Chunk, type SheetLine } from "../lib/sheet";

/** Сколько символов моноширинного шрифта помещается в строку. */
function useColumns(fontSize: number) {
  const ref = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [cols, setCols] = useState(60);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const charW = (probe.current?.getBoundingClientRect().width ?? fontSize * 12) / 20 || fontSize * 0.6;
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setCols(Math.max(18, Math.floor(inner / charW) - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Шрифт мог догрузиться позже — перемеряем.
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [fontSize]);
  return { ref, probe, cols };
}

function ChordRow({ prefix, chunks, onChord, revealed, onReveal, hide }: { prefix: string; chunks: Chunk[]; onChord: (c: string) => void; revealed: Set<string>; onReveal: (k: string) => void; hide: boolean }) {
  const placed = placeChords(chunks);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  placed.forEach((c, i) => {
    if (c.col > pos) parts.push(" ".repeat(c.col - pos));
    const key = `${prefix}${c.col}:${i}`;
    const shown = revealed.has(key);
    parts.push(
      <span
        key={key}
        className="gt-chord"
        data-shown={shown}
        role="button"
        tabIndex={0}
        onClick={() => (hide && !shown ? onReveal(key) : onChord(c.chord))}
      >
        {c.chord}
      </span>,
    );
    pos = c.col + c.chord.length;
  });
  return <div className="whitespace-pre">{parts}</div>;
}

function TabLine({ text }: { text: string }) {
  // Цифры ладов — подсвечиваем, остальное как есть.
  const parts = text.split(/(\d+)/g);
  return (
    <div className="gt-tabline whitespace-pre">
      {parts.map((p, i) => (/^\d+$/.test(p) ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}
    </div>
  );
}

/** Текст песни: аккорды над словами, переносы под ширину экрана, табы, режим подбора. */
export function Sheet({
  lines,
  fontSize = 15,
  hideChords = false,
  onChord,
}: {
  lines: SheetLine[];
  fontSize?: number;
  hideChords?: boolean;
  onChord: (chord: string) => void;
}) {
  const { ref, probe, cols } = useColumns(fontSize);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const reveal = (k: string) => setRevealed((s) => new Set(s).add(k));

  return (
    <div ref={ref} className="gt-sheet gt-mono relative overflow-hidden" data-hide={hideChords} style={{ fontSize }}>
      <span ref={probe} aria-hidden className="pointer-events-none invisible absolute whitespace-pre">
        {"M".repeat(20)}
      </span>
      {lines.map((l, i) => {
        if (l.t === "blank") return <div key={i} className="h-[0.9em]" />;
        if (l.t === "section")
          return (
            <div key={i}>
              <span className="gt-section">{l.label}</span>
            </div>
          );
        if (l.t === "text") return <div key={i} className="whitespace-pre-wrap break-words text-[var(--gt-muted)]">{l.text}</div>;
        if (l.t === "tab")
          return (
            <div key={i} className="my-2 space-y-2">
              {wrapTab(l.lines, cols).map((block, b) => (
                <div key={b} className="rounded-lg bg-black/20 px-1 py-1">
                  {block.map((t, j) => (
                    <TabLine key={j} text={t} />
                  ))}
                </div>
              ))}
            </div>
          );
        return (
          <div key={i} className="mb-1">
            {wrapPair(l.chords, l.lyric, cols).map((seg, j) => (
              <div key={j}>
                {seg.chords.length > 0 && <ChordRow prefix={`${i}-${j}-`} chunks={seg.chords} onChord={onChord} revealed={revealed} onReveal={reveal} hide={hideChords} />}
                {seg.lyric && <div className="whitespace-pre">{seg.lyric}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
