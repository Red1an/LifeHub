import type { ReactNode } from "react";
import type { Muscle } from "../lib/types.ts";

/*
 * Схематичная карта мышц спереди и сзади. Каждой мышце — значение 0..1:
 * в режиме "recovery" 0 = уставшая (оранжевая), 1 = свежая (лаймовая);
 * в режиме "highlight" 1 = основная, 0.5 = вспомогательная, 0 = не работает.
 */
type Part = { m: Muscle; d: string } | { m: Muscle; e: [number, number, number, number] };

const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${100 - Number(x)} ${y}`);
const both = (m: Muscle, d: string): Part[] => [{ m, d }, { m, d: mirror(d) }];
const pair = (m: Muscle, cx: number, cy: number, rx: number, ry: number): Part[] => [{ m, e: [cx, cy, rx, ry] }, { m, e: [100 - cx, cy, rx, ry] }];

const FRONT: Part[] = [
  { m: "neck", d: "M45 26 L55 26 L56 33 L44 33 Z" },
  ...pair("delts", 31.5, 40, 6.5, 6.5),
  ...both("chest", "M49 36 L38 37 Q34 44 37.5 52 Q44 55 49 53 Z"),
  ...pair("biceps", 27.5, 56, 4.3, 9),
  ...pair("forearms", 24.5, 77, 3.8, 10),
  { m: "abs", d: "M43 56 L57 56 L57.5 84 Q50 90 42.5 84 Z" },
  ...both("obliques", "M41.5 56 L37 58 Q35.5 72 39.5 86 L42 85 Z"),
  ...pair("quads", 42.5, 113, 7, 20),
  ...pair("calves", 42, 153, 4.6, 13),
];

const BACK: Part[] = [
  { m: "upperback", d: "M42 28 L58 28 L67 38 L60 50 L50 54 L40 50 L33 38 Z" },
  ...pair("delts", 31.5, 40, 6.5, 6.5),
  ...both("lats", "M38.5 47 Q34 58 42 77 L49 70 L49 56 L41 51 Z"),
  { m: "lowerback", d: "M43.5 72 L56.5 72 L57 86 L43 86 Z" },
  ...pair("triceps", 27.5, 56, 4.3, 9),
  ...pair("forearms", 24.5, 77, 3.8, 10),
  ...pair("glutes", 43, 95, 8, 8.5),
  ...pair("hams", 42.5, 121, 6.8, 16),
  ...pair("calves", 41.5, 152, 5.5, 12),
];

function Silhouette() {
  const c = "#1d2026";
  return (
    <g fill={c}>
      <circle cx="50" cy="15" r="10" />
      <rect x="44" y="23" width="12" height="11" rx="3" />
      <rect x="33" y="31" width="34" height="60" rx="11" />
      <rect x="21" y="34" width="12" height="36" rx="6" />
      <rect x="67" y="34" width="12" height="36" rx="6" />
      <rect x="19.5" y="64" width="10" height="30" rx="5" />
      <rect x="70.5" y="64" width="10" height="30" rx="5" />
      <circle cx="24.5" cy="97" r="4.5" />
      <circle cx="75.5" cy="97" r="4.5" />
      <rect x="34.5" y="84" width="15" height="54" rx="7.5" />
      <rect x="50.5" y="84" width="15" height="54" rx="7.5" />
      <rect x="36" y="134" width="12" height="40" rx="6" />
      <rect x="52" y="134" width="12" height="40" rx="6" />
      <ellipse cx="42" cy="178" rx="6.5" ry="3.5" />
      <ellipse cx="58" cy="178" rx="6.5" ry="3.5" />
    </g>
  );
}

function colorFor(v: number | undefined, mode: "recovery" | "highlight") {
  if (mode === "highlight") {
    if (!v) return { fill: "#2b2f37", opacity: 1 };
    return { fill: "#c8f031", opacity: v >= 1 ? 1 : 0.45 };
  }
  const x = v ?? 1;
  // оранжевый → жёлтый → лайм
  const hue = 20 + x * 55;
  return { fill: `hsl(${hue} 95% ${55 - x * 5}%)`, opacity: 0.35 + (1 - Math.abs(x - 0.5)) * 0.3 + x * 0.3 };
}

function Figure({ parts, values, mode, label }: { parts: Part[]; values: Partial<Record<Muscle, number>>; mode: "recovery" | "highlight"; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center">
      <svg viewBox="12 2 76 182" className="h-full max-h-64 w-full">
        <Silhouette />
        {parts.map((p, i) => {
          const { fill, opacity } = colorFor(values[p.m], mode);
          return "d" in p ? (
            <path key={i} d={p.d} fill={fill} opacity={opacity} className="ft-body-part" />
          ) : (
            <ellipse key={i} cx={p.e[0]} cy={p.e[1]} rx={p.e[2]} ry={p.e[3]} fill={fill} opacity={opacity} className="ft-body-part" />
          );
        })}
      </svg>
      <div className="mt-1 text-[11px] uppercase tracking-widest text-[var(--ft-muted)]">{label}</div>
    </div>
  );
}

export function BodyMap({ values, mode = "highlight", className, children }: { values: Partial<Record<Muscle, number>>; mode?: "recovery" | "highlight"; className?: string; children?: ReactNode }) {
  return (
    <div className={className}>
      <div className="flex gap-2">
        <Figure parts={FRONT} values={values} mode={mode} label="спереди" />
        <Figure parts={BACK} values={values} mode={mode} label="сзади" />
      </div>
      {children}
    </div>
  );
}
