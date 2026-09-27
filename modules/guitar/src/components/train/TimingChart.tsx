import type { OnsetMatch } from "@modules/audio";

const W = 640;
const H = 170;
const RANGE = 100; // ms either side

/** One bar per expected note: up = late, down = early, red cross = missed. */
export function TimingChart({ matches, goodMs = 40 }: { matches: OnsetMatch[]; goodMs?: number }) {
  const n = Math.max(1, matches.length);
  const slot = (W - 40) / n;
  const mid = H / 2;
  const scale = (H / 2 - 12) / RANGE;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-zinc-50 dark:bg-zinc-900">
      <rect x={34} width={W - 40} y={mid - goodMs * scale} height={goodMs * 2 * scale} className="fill-emerald-400/15" />
      <line x1={34} x2={W - 6} y1={mid} y2={mid} className="stroke-zinc-400" strokeWidth={1} />
      <text x={2} y={14} fontSize={9} className="fill-zinc-400">+{RANGE}</text>
      <text x={2} y={mid + 3} fontSize={9} className="fill-zinc-400">0 мс</text>
      <text x={2} y={H - 4} fontSize={9} className="fill-zinc-400">−{RANGE}</text>
      <text x={W - 6} y={12} fontSize={9} textAnchor="end" className="fill-zinc-400">поздно ↑</text>
      <text x={W - 6} y={H - 4} fontSize={9} textAnchor="end" className="fill-zinc-400">рано ↓</text>
      {matches.map((m, i) => {
        const cx = 34 + slot * (i + 0.5);
        if (m.errorMs === null) {
          return (
            <text key={i} x={cx} y={mid + 4} fontSize={12} textAnchor="middle" className="fill-red-500">
              ×
            </text>
          );
        }
        const value = Math.max(-RANGE, Math.min(RANGE, m.errorMs));
        const good = Math.abs(m.errorMs) <= goodMs;
        return (
          <rect
            key={i}
            x={cx - Math.max(1, slot * 0.3)}
            width={Math.max(2, slot * 0.6)}
            y={value > 0 ? mid - value * scale : mid}
            height={Math.max(1.5, Math.abs(value) * scale)}
            rx={1}
            className={good ? "fill-emerald-500" : "fill-amber-500"}
          />
        );
      })}
    </svg>
  );
}

export function timingAdvice(meanMs: number, spreadMs: number, missed: number, total: number): string[] {
  const tips: string[] = [];
  if (meanMs < -15) tips.push(`Ты спешишь — в среднем на ${Math.round(-meanMs)} мс раньше щелчка. Расслабься и «слушай» щелчок, а не беги к нему.`);
  else if (meanMs > 15) tips.push(`Ты тянешь — в среднем на ${Math.round(meanMs)} мс позже щелчка. Готовь руку заранее, удар должен совпасть со щелчком.`);
  else tips.push("По среднему — ровно в долю. Отличная привязка к метроному.");
  if (spreadMs > 30) tips.push(`Разброс ±${Math.round(spreadMs)} мс — ноты «гуляют». Снизь темп на 10–15 BPM и добейся ровности.`);
  else if (spreadMs > 15) tips.push(`Разброс ±${Math.round(spreadMs)} мс — неплохо, но можно ровнее.`);
  else tips.push(`Разброс ±${Math.round(spreadMs)} мс — очень стабильно.`);
  if (missed > total * 0.1) tips.push(`Пропущено нот: ${missed}. Если играл их — играй отрывистее и ближе к микрофону.`);
  return tips;
}
