import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@lifehub/sdk";
import { getAudioContext, playClick, unlockAudio } from "@modules/audio";
import { playGuitarNote } from "../lib/audio/guitar-synth";
import { rangeLength, sections, timeline, type Beat, type Measure, type Part } from "../lib/songsterr";
import { markPractice } from "../lib/train-stats";

/* ───────────── раскладка ───────────── */

const LS = 12; // расстояние между струнами
const TOP = 24;
const BOTTOM = 10;
const GUTTER = 14;
const PAD = 7;

const beatW = (b: Beat) => (b.grace ? 10 : Math.max(15, Math.round(32 * Math.sqrt(b.dur * 4))));
const measureW = (m: Measure) => m.beats.reduce((s, b) => s + beatW(b), 0) + PAD * 2;

interface Row {
  measures: { m: Measure; x: number; w: number; scale: number }[];
}

function layout(measures: Measure[], width: number): Row[] {
  const rows: Row[] = [];
  let cur: Row = { measures: [] };
  let x = GUTTER;
  for (const m of measures) {
    const w = measureW(m);
    if (cur.measures.length && x + w > width) {
      rows.push(cur);
      cur = { measures: [] };
      x = GUTTER;
    }
    const avail = width - GUTTER;
    const scale = w > avail ? avail / w : 1;
    cur.measures.push({ m, x, w: w * scale, scale });
    x += w * scale;
  }
  if (cur.measures.length) rows.push(cur);
  // Растягиваем строки на всю ширину — так таб читается ровнее.
  for (const r of rows.slice(0, -1)) {
    const used = r.measures.reduce((s, x) => s + x.w, 0);
    const k = (width - GUTTER) / used;
    let xx = GUTTER;
    for (const it of r.measures) {
      it.w *= k;
      it.scale *= k;
      it.x = xx;
      xx += it.w;
    }
  }
  return rows;
}

function noteText(n: Beat["notes"][number]) {
  let s = n.dead ? "x" : n.harmonic ? `<${n.fret}>` : String(n.fret);
  if (n.tie) s = `(${s})`;
  if (n.bend) s += n.bend >= 2 ? "↑" : "↑½";
  if (n.vibrato) s += "~";
  return s;
}

const STRING_NAMES: Record<number, string> = { 64: "e", 59: "B", 55: "G", 50: "D", 45: "A", 40: "E", 43: "G", 38: "D", 33: "A", 28: "E" };

function TabRow({
  row,
  part,
  width,
  cursor,
  loop,
  onMeasure,
}: {
  row: Row;
  part: Part;
  width: number;
  cursor: { measure: number; beat: number } | null;
  loop: [number, number] | null;
  onMeasure?: (i: number) => void;
}) {
  const strings = part.strings;
  const H = TOP + (strings - 1) * LS + BOTTOM;
  const y = (s: number) => TOP + s * LS;
  const end = row.measures[row.measures.length - 1];
  const right = end.x + end.w;
  return (
    <svg width={width} height={H} className="block select-none" style={{ overflow: "visible" }}>
      {row.measures.map(({ m, x, w }) =>
        loop && m.index >= loop[0] && m.index <= loop[1] ? <rect key={`l${m.index}`} x={x} y={TOP - 6} width={w} height={(strings - 1) * LS + 12} fill="var(--gt-sky)" opacity={0.08} /> : null,
      )}
      {Array.from({ length: strings }).map((_, s) => (
        <g key={s}>
          <line x1={GUTTER} x2={right} y1={y(s)} y2={y(s)} stroke="var(--gt-muted)" strokeWidth={0.6} opacity={0.55} />
          <text x={2} y={y(s) + 3.5} fontSize={9} fill="var(--gt-muted)">
            {STRING_NAMES[part.tuning[s]] ?? ""}
          </text>
        </g>
      ))}
      {row.measures.map(({ m, x, w, scale }) => {
        let bx = x + PAD * scale;
        return (
          <g key={m.index} onClick={() => onMeasure?.(m.index)} className={onMeasure ? "cursor-pointer" : ""}>
            <rect x={x} y={0} width={w} height={H} fill="transparent" />
            <line x1={x} x2={x} y1={y(0)} y2={y(strings - 1)} stroke="var(--gt-muted)" strokeWidth={1} />
            <text x={x + 2} y={TOP - 14} fontSize={8} fill="var(--gt-muted)">
              {m.index + 1}
            </text>
            {m.marker && (
              <text x={x + 14} y={TOP - 14} fontSize={10} fontWeight={700} fill="var(--gt-brass)">
                {m.marker}
              </text>
            )}
            {m.beats.map((b, bi) => {
              const bw = beatW(b) * scale;
              const cx = bx + bw / 2;
              bx += bw;
              const active = cursor && cursor.measure === m.index && cursor.beat === bi;
              return (
                <g key={bi}>
                  {active && <rect x={cx - bw / 2} y={TOP - 7} width={bw} height={(strings - 1) * LS + 14} rx={3} fill="var(--gt-brass)" opacity={0.3} />}
                  {b.chord && !m.marker && (
                    <text x={cx} y={TOP - 13} fontSize={9} fontWeight={700} textAnchor="middle" fill="var(--gt-sky)">
                      {b.chord}
                    </text>
                  )}
                  {b.palmMute && (
                    <text x={cx} y={y(strings - 1) + 10} fontSize={7} textAnchor="middle" fill="var(--gt-muted)">
                      PM
                    </text>
                  )}
                  {b.notes.map((n, ni) => {
                    if (n.string >= strings) return null;
                    const t = noteText(n);
                    const tw = t.length * 6.2 + 2;
                    return (
                      <g key={ni}>
                        <rect x={cx - tw / 2} y={y(n.string) - 6} width={tw} height={12} fill="var(--gt-panel)" />
                        <text
                          x={cx}
                          y={y(n.string) + 3.8}
                          fontSize={10.5}
                          fontWeight={700}
                          textAnchor="middle"
                          fontFamily="JetBrains Mono, monospace"
                          fill={n.tie || n.ghost ? "var(--gt-muted)" : n.dead ? "var(--gt-muted)" : active ? "var(--gt-brass)" : "var(--gt-fg)"}
                        >
                          {t}
                        </text>
                        {(n.hp || n.slide) && (
                          <text x={cx - tw / 2 - 1} y={y(n.string) - 5} fontSize={7.5} textAnchor="end" fill="var(--gt-copper)">
                            {n.slide ? (n.slide.startsWith("up") ? "/" : "\\") : "⌒"}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
      <line x1={right} x2={right} y1={y(0)} y2={y(strings - 1)} stroke="var(--gt-muted)" strokeWidth={1} />
    </svg>
  );
}

/* ───────────── проигрывание ───────────── */

function usePlayer(part: Part, range: [number, number], speed: number, loop: boolean, click: boolean) {
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState<{ measure: number; beat: number } | null>(null);
  const stopRef = useRef<() => void>(() => {});

  const stop = () => {
    stopRef.current();
    stopRef.current = () => {};
    setPlaying(false);
  };

  const start = async () => {
    stop();
    await unlockAudio();
    markPractice("tabs");
    const ctx = getAudioContext();
    const [from, to] = range;
    const events = timeline(part, from, to, speed);
    const total = rangeLength(part, from, to, speed);
    const quarter = 60 / ((part.tempo[0]?.bpm ?? 100) * speed);
    let t0 = ctx.currentTime + 0.15 + (click ? quarter * 4 : 0);
    if (click) for (let i = 0; i < 4; i++) playClick(i === 0, 0.15 + i * quarter);
    let idx = 0;
    let nextClick = 0;
    let alive = true;

    const schedule = () => {
      if (!alive) return;
      const horizon = ctx.currentTime + 0.2;
      while (alive) {
        if (idx >= events.length) {
          if (!loop) break;
          t0 += total;
          idx = 0;
          nextClick = 0;
          continue;
        }
        const ev = events[idx];
        const at = t0 + ev.time;
        if (at > horizon) break;
        const beat = part.measures[ev.measure].beats[ev.beat];
        const when = Math.max(0, at - ctx.currentTime);
        for (const n of beat.notes) {
          if (n.tie) continue;
          const midi = part.tuning[n.string] + n.fret + (n.harmonic ? 12 : 0);
          if (n.dead) {
            playGuitarNote(midi, { when, gain: 0.25, duration: 0.05 });
            continue;
          }
          const dur = Math.min(3, Math.max(0.12, ev.dur * 1.15));
          playGuitarNote(midi, { when, gain: n.ghost ? 0.25 : 0.55, duration: n.bend ? ev.dur * 0.35 : dur });
          if (n.bend) playGuitarNote(midi + n.bend, { when: when + ev.dur * 0.3, gain: 0.45, duration: Math.max(0.1, dur - ev.dur * 0.3) });
        }
        idx++;
      }
      if (click) {
        while (alive && t0 + nextClick * quarter < horizon && nextClick * quarter < total) {
          const at = t0 + nextClick * quarter - ctx.currentTime;
          if (at >= 0) playClick(nextClick % 4 === 0, at);
          nextClick++;
        }
      }
      if (!loop && idx >= events.length && ctx.currentTime > t0 + total) {
        alive = false;
        setPlaying(false);
        setCursor(null);
      }
    };

    const timer = window.setInterval(schedule, 25);
    schedule();
    let raf = 0;
    let last = -1;
    const tick = () => {
      if (!alive) return;
      const now = ctx.currentTime - t0;
      const pos = loop && total > 0 ? ((now % total) + total) % total : now;
      let lo = 0;
      let hi = events.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].time <= pos) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (found !== last && now >= 0) {
        last = found;
        if (found >= 0) setCursor({ measure: events[found].measure, beat: events[found].beat });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    stopRef.current = () => {
      alive = false;
      window.clearInterval(timer);
      cancelAnimationFrame(raf);
    };
    setPlaying(true);
  };

  useEffect(() => () => stopRef.current(), []);
  return { playing, cursor, start, stop };
}

/* ───────────── компонент ───────────── */

/** Таб партии: рисунок по тактам под ширину экрана, проигрывание с курсором, скорость, петля, метроном. */
export function TabPlayer({ part, from = 0, to, compact }: { part: Part; from?: number; to?: number; compact?: boolean }) {
  const last = Math.min(to ?? part.measures.length - 1, part.measures.length - 1);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [speed, setSpeed] = useState(1);
  const [loopOn, setLoopOn] = useState(!!compact);
  const [click, setClick] = useState(false);
  // Петля — отдельный выбор тактов; без петли играем с выбранного такта до конца.
  const [loopRange, setLoopRange] = useState<[number, number]>([from, last]);
  const [startAt, setStartAt] = useState(from);
  const [pick, setPick] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const range: [number, number] = loopOn ? loopRange : [startAt, last];

  useEffect(() => {
    setLoopRange([from, last]);
    setStartAt(from);
  }, [from, last, part]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = useMemo(() => part.measures.slice(from, last + 1), [part, from, last]);
  const rows = useMemo(() => layout(shown, width), [shown, width]);
  const player = usePlayer(part, range, speed, loopOn, click);
  const secs = useMemo(() => (compact ? [] : sections(part)), [part, compact]);

  // Перезапуск при смене настроек во время игры (или по нажатию на такт).
  const wantPlay = useRef(false);
  useEffect(() => {
    if (player.playing || wantPlay.current) {
      wantPlay.current = false;
      void player.start();
    }
  }, [speed, loopOn, click, range[0], range[1]]);

  // Следим за курсором — прокручиваем к текущей строке.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cursorRow = player.cursor ? rows.findIndex((r) => r.measures.some((x) => x.m.index === player.cursor!.measure)) : -1;
  useEffect(() => {
    if (follow && cursorRow >= 0) rowRefs.current[cursorRow]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cursorRow, follow]);

  const onMeasure = (i: number) => {
    if (loopOn && !compact) {
      // Режим петли: первое нажатие — начало, второе — конец.
      if (pick === null) {
        setPick(i);
        setLoopRange([i, i]);
      } else {
        setLoopRange([Math.min(pick, i), Math.max(pick, i)]);
        setPick(null);
      }
      return;
    }
    // Обычный режим: играть с этого такта.
    if (loopOn) setLoopOn(false);
    if (i === startAt && !loopOn) void player.start();
    else {
      wantPlay.current = true;
      setStartAt(i);
    }
  };
  const isWhole = loopRange[0] === from && loopRange[1] === last;

  return (
    <div ref={ref}>
      <div className={cn("z-10 mb-2 flex flex-wrap items-center gap-2", !compact && "sticky top-[calc(6.25rem+env(safe-area-inset-top))] lg:top-[3.75rem] rounded-2xl border border-[var(--gt-line)] bg-[var(--gt-panel)]/95 p-2 backdrop-blur")}>
        <button className={cn("gt-btn !min-h-10", player.playing ? "gt-btn-ghost" : "gt-btn-brass")} onClick={() => (player.playing ? player.stop() : player.start())}>
          {player.playing ? "⏸" : "▶"} {compact ? "" : player.playing ? "Пауза" : startAt > from && !loopOn ? `С такта ${startAt + 1}` : "Играть"}
        </button>
        <div className="flex rounded-xl bg-[var(--gt-panel-2)] p-0.5 text-xs">
          {[0.5, 0.75, 1].map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={cn("min-h-8 rounded-lg px-2 font-bold", speed === s ? "bg-[var(--gt-brass)] text-black" : "text-[var(--gt-muted)]")}>
              {s * 100}%
            </button>
          ))}
        </div>
        <button
          data-on={loopOn}
          onClick={() => {
            setPick(null);
            if (!loopOn && !compact) setLoopRange([startAt, Math.min(last, startAt + 3)]);
            setLoopOn(!loopOn);
          }}
          className="gt-chip !min-h-8 text-xs"
        >
          🔁 Петля
        </button>
        <button data-on={click} onClick={() => setClick(!click)} className="gt-chip !min-h-8 text-xs">
          🥁
        </button>
        {!compact && (
          <button data-on={follow} onClick={() => setFollow(!follow)} className="gt-chip !min-h-8 text-xs">
            ↕ Следить
          </button>
        )}
        {!compact && loopOn && (
          <button
            className="text-xs text-[var(--gt-muted)] underline"
            onClick={() => {
              setLoopOn(false);
              setPick(null);
              setLoopRange([from, last]);
            }}
          >
            петля: такты {loopRange[0] + 1}–{loopRange[1] + 1} ✕
          </button>
        )}
      </div>

      {secs.length > 1 && (
        <div className="gt-scroll-x mb-3">
          {secs.map((s, i) => (
            <button
              key={i}
              data-on={loopOn && loopRange[0] === s.from && loopRange[1] === s.to}
              onClick={() => {
                setLoopRange([s.from, s.to]);
                setPick(null);
                setLoopOn(true);
                rowRefs.current[rows.findIndex((r) => r.measures.some((x) => x.m.index === s.from))]?.scrollIntoView({ block: "center", behavior: "smooth" });
              }}
              className="gt-chip !min-h-8 text-xs"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {!compact && loopOn && (
        <div className="mb-2 text-xs text-[var(--gt-sky)]">
          {pick !== null ? `Начало петли — такт ${pick + 1}. Нажми последний такт петли.` : "Петля: нажми первый такт петли, потом последний."}
        </div>
      )}
      {!compact && !loopOn && <div className="mb-2 text-xs text-[var(--gt-muted)]">Нажми на такт — заиграет с него.</div>}

      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} ref={(el) => void (rowRefs.current[i] = el)}>
            <TabRow row={r} part={part} width={width} cursor={player.cursor} loop={loopOn && !isWhole ? loopRange : null} onMeasure={onMeasure} />
          </div>
        ))}
      </div>
    </div>
  );
}
