import { useState, type ReactNode } from "react";
import { cn } from "./format.ts";

/* Простые SVG-графики без внешних библиотек. Цвета берутся из темы. */

export const CHART_COLORS = ["var(--lh-accent)", "#06b6d4", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#64748b", "#84cc16"];

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export function BarChart({ data, height = 180, format = String, className }: { data: BarDatum[]; height?: number; format?: (v: number) => string; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={cn("w-full", className)}>
      <div className="relative flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="group relative flex h-full flex-1 flex-col justify-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onTouchStart={() => setHover(i)}
          >
            {hover === i && (
              <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-fg px-2 py-1 text-xs text-bg shadow">
                {d.label}: {format(d.value)}
              </div>
            )}
            <div
              className="min-h-[2px] rounded-t-md transition-all"
              style={{ height: `${(d.value / max) * 100}%`, background: d.color ?? "var(--lh-accent)", opacity: hover === null || hover === i ? 1 : 0.5 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 truncate text-center text-[11px] text-muted">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface LineSeries {
  name: string;
  points: number[];
  color?: string;
}

export function LineChart({
  labels, series, height = 200, format = String, className,
}: { labels: string[]; series: LineSeries[]; height?: number; format?: (v: number) => string; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const pad = 8;
  const all = series.flatMap((s) => s.points);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => pad + (i / n) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  return (
    <div className={cn("relative w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * n));
        }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="var(--lh-line)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, si) => {
          const color = s.color ?? CHART_COLORS[si % CHART_COLORS.length];
          const d = s.points.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
          return (
            <g key={s.name}>
              {series.length === 1 && <path d={`${d} L${x(s.points.length - 1)},${H} L${x(0)},${H} Z`} fill={color} opacity={0.12} />}
              <path d={d} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hover !== null && hover >= 0 && hover < labels.length && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--lh-muted)" vectorEffect="non-scaling-stroke" opacity={0.5} />
        )}
      </svg>
      {hover !== null && hover >= 0 && hover < labels.length && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-fg px-2 py-1 text-xs text-bg shadow" style={{ left: `${(x(hover) / W) * 100}%`, transform: "translateX(-50%)" }}>
          <div className="font-medium">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name}>{series.length > 1 ? `${s.name}: ` : ""}{format(s.points[hover] ?? 0)}</div>
          ))}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

export function DonutChart({
  data, size = 160, center, format = String, className,
}: { data: BarDatum[]; size?: number; center?: ReactNode; format?: (v: number) => string; className?: string }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="-rotate-90" width={size} height={size}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--lh-surface-2)" strokeWidth="14" />
          {data.map((d, i) => {
            const len = (Math.max(0, d.value) / total) * c;
            const el = (
              <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} strokeWidth="14"
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
            );
            offset += len;
            return el;
          })}
        </svg>
        {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="tabular-nums text-muted">{format(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ points, width = 100, height = 28, color = "var(--lh-accent)" }: { points: number[]; width?: number; height?: number; color?: string }) {
  if (points.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const d = points
    .map((v, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * width},${height - 2 - ((v - min) / (max - min || 1)) * (height - 4)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Календарная сетка активности (как на GitHub): значения по дням. */
export function Heatmap({ values, weeks = 17, className }: { values: Record<string, number>; weeks?: number; className?: string }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
  const max = Math.max(1, ...Object.values(values));
  const pad = (x: number) => String(x).padStart(2, "0");
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const v = values[key] ?? 0;
      const future = date > today;
      cells.push(
        <div key={d} title={`${key}: ${v}`} className="aspect-square rounded-[3px]"
          style={{ background: future ? "transparent" : v ? `color-mix(in oklab, var(--lh-accent) ${25 + (v / max) * 75}%, transparent)` : "var(--lh-surface-2)" }} />,
      );
    }
    cols.push(<div key={w} className="grid flex-1 gap-[3px]">{cells}</div>);
  }
  return <div className={cn("flex gap-[3px]", className)}>{cols}</div>;
}
