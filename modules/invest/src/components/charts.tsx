import { cn } from "@lifehub/sdk";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { fmtDate, monthAxis } from "../lib/dates.ts";
import { short, shortRub } from "../lib/fmt.ts";

/* ── линии во времени ── */

export interface TimeSeries {
  name: string;
  color: string;
  points: [number, number][];
  area?: boolean;
  dashed?: boolean;
}

export function TimeChart({ series, height = 220, format = shortRub, className }: { series: TimeSeries[]; height?: number; format?: (v: number) => string; className?: string }) {
  const W = 640;
  const H = height;
  const pad = { l: 8, r: 8, t: 14, b: 24 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const geo = useMemo(() => {
    if (all.length < 2) return null;
    const t0 = Math.min(...all.map((p) => p[0]));
    const t1 = Math.max(...all.map((p) => p[0]));
    let v0 = Math.min(...all.map((p) => p[1]));
    let v1 = Math.max(...all.map((p) => p[1]));
    const vmax = v1;
    if (v0 > 0 && series.some((s) => s.area)) v0 = 0;
    const span = v1 - v0 || 1;
    v0 -= span * 0.04;
    v1 += span * 0.06;
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - v0) / (v1 - v0)) * (H - pad.t - pad.b);
    return { t0, t1, v0, v1, vmax, x, y };
  }, [all, series, H]);
  if (!geo) return <div className="inv-muted grid place-items-center text-sm" style={{ height }}>Пока мало данных для графика</div>;
  const { t0, t1, v0, vmax, x, y } = geo;
  // Подписи оси дат: годы или месяцы, без метки у самого правого края
  const ticks: number[] = [];
  const years = (t1 - t0) / (365.25 * 86_400_000);
  const d = new Date(t0);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  const stepMonths = years > 4 ? 12 : years > 1.5 ? 6 : years > 0.6 ? 3 : 1;
  if (stepMonths === 12) d.setMonth(0);
  while (d.getTime() <= t1) {
    if (d.getTime() >= t0 && x(d.getTime()) < W - 40) ticks.push(d.getTime());
    d.setMonth(d.getMonth() + stepMonths);
  }
  const base = series[0].points;
  const idx = hover != null ? nearest(base, hover) : null;
  const onMove = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const tx = t0 + ((clientX - r.left) / r.width * W - pad.l) / (W - pad.l - pad.r) * (t1 - t0);
    setHover(tx);
  };
  return (
    <div className={cn("relative select-none", className)}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-pan-y"
        style={{ height }}
        preserveAspectRatio="none"
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="var(--inv-line)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => {
          const pts = s.points;
          if (pts.length < 2) return null;
          const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
          return (
            <g key={s.name}>
              {s.area && (
                <path d={`${line}L${x(pts[pts.length - 1][0])},${y(Math.max(v0, 0))}L${x(pts[0][0])},${y(Math.max(v0, 0))}Z`} fill={s.color} opacity={0.12} />
              )}
              <path d={line} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2.2} strokeDasharray={s.dashed ? "5 5" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          );
        })}
        {idx != null && <line x1={x(base[idx][0])} x2={x(base[idx][0])} y1={pad.t} y2={H - pad.b} stroke="var(--inv-muted)" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="inv-faint pointer-events-none absolute inset-x-0 bottom-0 h-5 text-[11px]">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(x(t) / W) * 100}%` }}>
            {stepMonths === 12 ? new Date(t).getFullYear() : `${monthAxis(new Date(t).getMonth() + 1)} ${String(new Date(t).getFullYear()).slice(2)}`}
          </span>
        ))}
      </div>
      <div className="inv-faint pointer-events-none absolute right-1 top-0 text-[11px]">макс. {format(vmax)}</div>
      {idx != null && (
        <div className="inv-chart-tip" style={{ left: `${Math.min(85, Math.max(15, (x(base[idx][0]) / W) * 100))}%`, top: 8 }}>
          <div className="inv-muted mb-1">{fmtDate(base[idx][0], { year: "always" })}</div>
          {series.map((s) => {
            const j = nearest(s.points, base[idx][0]);
            return j == null ? null : (
              <div key={s.name} className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                <span className="inv-muted">{s.name}</span>
                <span className="inv-num ml-auto pl-3 font-bold">{format(s.points[j][1])}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function nearest(pts: [number, number][], t: number): number | null {
  if (!pts.length) return null;
  let best = 0;
  for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - t) < Math.abs(pts[best][0] - t)) best = i;
  return best;
}

export function Legend({ items, className }: { items: { color: string; label: ReactNode; dashed?: boolean; pale?: boolean }[]; className?: string }) {
  return (
    <div className={cn("inv-muted flex flex-wrap gap-x-4 gap-y-1 text-xs", className)}>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color, opacity: it.pale ? 0.4 : 1, border: it.dashed ? `1px dashed ${it.color}` : undefined }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ── столбики: годы, месяцы ── */

export interface Column {
  key: string;
  label: string;
  sub?: string;
  segments: { value: number; color: string; pale?: boolean; hatch?: boolean }[];
  range?: [number, number];
  top?: string;
}

export function Columns({ cols, height = 180, selected, onSelect, format = short }: { cols: Column[]; height?: number; selected?: string | null; onSelect?: (key: string) => void; format?: (v: number) => string }) {
  const max = Math.max(1, ...cols.map((c) => Math.max(c.segments.reduce((a, s) => a + s.value, 0), c.range?.[1] ?? 0)));
  return (
    <div className="flex items-end gap-1 sm:gap-2" style={{ height: height + 34 }}>
      {cols.map((c) => {
        const total = c.segments.reduce((a, s) => a + s.value, 0);
        const active = selected == null || selected === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect?.(c.key)}
            disabled={!onSelect}
            className={cn("group flex min-w-0 flex-1 flex-col items-center justify-end transition-opacity", !active && "opacity-40")}
            style={{ height: height + 34 }}
          >
            <div className="inv-num mb-1 h-4 text-[10.5px] font-bold text-[var(--inv-muted)] sm:text-xs">{total > 0 ? c.top ?? format(total) : ""}</div>
            <div className="relative flex w-full max-w-12 flex-col-reverse overflow-visible rounded-t-md" style={{ height: (total / max) * height }}>
              {c.segments.map((s, i) => (
                <div
                  key={i}
                  style={{
                    height: total > 0 ? `${(s.value / total) * 100}%` : 0,
                    background: s.hatch ? `repeating-linear-gradient(135deg, ${s.color} 0 4px, transparent 4px 8px)` : s.color,
                    opacity: s.pale ? 0.38 : 1,
                  }}
                  className={cn(i === c.segments.length - 1 && "rounded-t-md")}
                />
              ))}
              {c.range && (
                <div className="absolute left-1/2 w-px -translate-x-1/2 bg-[var(--inv-fg)] opacity-60" style={{ bottom: `${(c.range[0] / Math.max(total, 1)) * 100}%`, height: `${((c.range[1] - c.range[0]) / Math.max(total, 1)) * 100}%` }}>
                  <div className="absolute -left-1.5 top-0 h-px w-3 bg-[var(--inv-fg)]" />
                  <div className="absolute -left-1.5 bottom-0 h-px w-3 bg-[var(--inv-fg)]" />
                </div>
              )}
            </div>
            <div className="mt-1.5 w-full truncate text-center text-[10.5px] font-semibold text-[var(--inv-muted)] sm:text-xs">{c.label}</div>
            {c.sub && <div className="w-full truncate text-center text-[10px] text-[var(--inv-faint)]">{c.sub}</div>}
          </button>
        );
      })}
    </div>
  );
}

/* ── водопад «почему изменилось» ── */

export function Waterfall({ steps, format = shortRub }: { steps: { title: string; value: number; total: boolean; hint?: string }[]; format?: (v: number) => string }) {
  let run = 0;
  const bars = steps.map((s) => {
    if (s.total) {
      run = s.value;
      return { ...s, from: 0, to: s.value };
    }
    const from = run;
    run += s.value;
    return { ...s, from, to: run };
  });
  const max = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  return (
    <div className="space-y-2">
      {bars.map((b, i) => {
        const lo = Math.min(b.from, b.to);
        const hi = Math.max(b.from, b.to);
        const color = b.total ? "var(--inv-blue)" : b.value >= 0 ? "var(--inv-green)" : "var(--inv-red)";
        return (
          <div key={i} className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-2 text-[13px] sm:grid-cols-[13rem_1fr_6rem]" title={b.hint}>
            <div className={cn("truncate", b.total ? "font-extrabold" : "inv-muted font-semibold")}>{b.title}</div>
            <div className="relative h-5 rounded bg-[var(--inv-panel-2)]">
              <div className="absolute inset-y-0 rounded" style={{ left: `${(lo / max) * 100}%`, width: `${Math.max(0.6, ((hi - lo) / max) * 100)}%`, background: color }} />
            </div>
            <div className={cn("inv-num text-right font-bold", !b.total && (b.value >= 0 ? "inv-up" : "inv-down"))}>{b.total ? format(b.value) : (b.value >= 0 ? "+" : "−") + format(Math.abs(b.value))}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── кольцо оценки ── */

export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? "var(--inv-green)" : score >= 70 ? "#9be15d" : score >= 50 ? "var(--inv-orange)" : "var(--inv-red)";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="flex-none">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--inv-panel-3)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="57" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--inv-fg)">
        {score}
      </text>
    </svg>
  );
}

/* ── горизонтальные доли ── */

export const PALETTE = ["#5aa9ff", "#2fd99a", "#f3c35a", "#a78bfa", "#ff9f43", "#ff6b9a", "#4dd4e6", "#9be15d", "#c084fc", "#8a99ab"];

export function ShareBars({ rows, format = shortRub, limit = 10 }: { rows: { name: string; value: number; share: number; color?: string; extra?: ReactNode }[]; format?: (v: number) => string; limit?: number }) {
  const top = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const list = rest.length ? [...top, { name: `Остальное (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0), share: rest.reduce((a, r) => a + r.share, 0) }] : top;
  const max = Math.max(...list.map((r) => r.share), 0.0001);
  return (
    <div className="space-y-3">
      {list.map((r, i) => (
        <div key={r.name}>
          <div className="mb-1 flex items-baseline gap-2 text-[13.5px]">
            <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
            {"extra" in r && r.extra}
            <span className="inv-num inv-muted">{format(r.value)}</span>
            <span className="inv-num w-12 text-right font-extrabold">{(r.share * 100).toFixed(r.share < 0.1 ? 1 : 0).replace(".", ",")} %</span>
          </div>
          <div className="inv-bar">
            <div style={{ width: `${(r.share / max) * 100}%`, background: ("color" in r && r.color) || PALETTE[i % PALETTE.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}
