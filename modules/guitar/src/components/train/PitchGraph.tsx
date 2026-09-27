import { SHARP_NOTES } from "../../lib/music-theory";

export interface GraphSample {
  t: number; // seconds from the start of the graph
  midi: number | null; // fractional midi, null when silent
}

export interface GraphTarget {
  start: number;
  end: number;
  midi: number;
  hit?: boolean | null;
}

const W = 640;
const H = 220;
const LEFT = 34;
const RIGHT = 8;
const TOP = 8;
const BOTTOM = 18;

/** Pitch over time: your voice as a line, target notes as bands. */
export function PitchGraph({
  samples,
  targets = [],
  duration,
  toleranceCents = 35,
  range,
  now,
}: {
  samples: GraphSample[];
  targets?: GraphTarget[];
  duration: number;
  toleranceCents?: number;
  range?: [number, number];
  now?: number;
}) {
  const voiced = samples.flatMap((s) => (s.midi === null ? [] : [s.midi]));
  const targetMidis = targets.map((t) => t.midi);
  const all = [...targetMidis, ...voiced];
  const low = range ? range[0] : Math.floor((all.length ? Math.min(...all) : 57) - 2);
  const high = range ? range[1] : Math.ceil((all.length ? Math.max(...all) : 64) + 2);
  const span = Math.max(4, high - low);

  const x = (t: number) => LEFT + (Math.min(Math.max(t, 0), duration) / duration) * (W - LEFT - RIGHT);
  const y = (midi: number) => TOP + (1 - (midi - low) / span) * (H - TOP - BOTTOM);
  const band = toleranceCents / 100;

  // Break the line wherever the voice stops, instead of drawing across gaps.
  const segments: string[] = [];
  let current = "";
  let lastT = -1;
  for (const sample of samples) {
    if (sample.midi === null || sample.t - lastT > 0.15) {
      if (current) segments.push(current);
      current = "";
    }
    if (sample.midi !== null) {
      current += `${current ? "L" : "M"}${x(sample.t).toFixed(1)},${y(sample.midi).toFixed(1)}`;
      lastT = sample.t;
    }
  }
  if (current) segments.push(current);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-zinc-50 dark:bg-zinc-900">
      {Array.from({ length: span + 1 }).map((_, i) => {
        const midi = low + i;
        const natural = !SHARP_NOTES[((midi % 12) + 12) % 12].includes("#");
        return (
          <g key={midi}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={y(midi)}
              y2={y(midi)}
              className="stroke-zinc-300 dark:stroke-zinc-700"
              strokeWidth={natural ? 0.8 : 0.4}
              strokeDasharray={natural ? undefined : "2 3"}
            />
            {natural && span <= 30 && (
              <text x={4} y={y(midi) + 3} fontSize={9} className="fill-zinc-400">
                {SHARP_NOTES[((midi % 12) + 12) % 12]}
                {Math.floor(midi / 12) - 1}
              </text>
            )}
          </g>
        );
      })}

      {targets.map((target, i) => (
        <rect
          key={i}
          x={x(target.start)}
          width={Math.max(2, x(target.end) - x(target.start))}
          y={y(target.midi + band)}
          height={y(target.midi - band) - y(target.midi + band)}
          rx={3}
          className={
            target.hit === true
              ? "fill-emerald-400/40"
              : target.hit === false
                ? "fill-red-400/35"
                : "fill-sky-400/30"
          }
        />
      ))}

      {now !== undefined && (
        <line x1={x(now)} x2={x(now)} y1={TOP} y2={H - BOTTOM} className="stroke-zinc-400" strokeWidth={1} />
      )}

      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" className="stroke-rose-500" strokeWidth={2.2} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
