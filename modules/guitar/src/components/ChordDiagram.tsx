import { resolveChordShape } from "../lib/resolve-chord";

const STRING_COUNT = 6;
const FRET_COUNT = 4;
const W = 100;
const H = 120;
const LEFT = 16;
const TOP = 22;
const STRING_GAP = (W - LEFT - 8) / (STRING_COUNT - 1);
const FRET_GAP = (H - TOP - 10) / FRET_COUNT;

export function ChordDiagram({
  chord,
  size = 100,
}: {
  chord: string;
  size?: number;
}) {
  const shape = resolveChordShape(chord);
  if (!shape) return null;
  const baseFret = shape.baseFret ?? 1;

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: size }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={size}
        height={(size * H) / W}
        className="text-zinc-800 dark:text-zinc-100"
      >
        {/* nut or base-fret label */}
        {baseFret === 1 ? (
          <rect x={LEFT} y={TOP - 3} width={STRING_GAP * 5} height={3} fill="currentColor" />
        ) : (
          <text x={LEFT - 10} y={TOP + FRET_GAP * 0.75} fontSize={9} fill="currentColor">
            {baseFret}
          </text>
        )}

        {/* frets */}
        {Array.from({ length: FRET_COUNT + 1 }).map((_, i) => (
          <line
            key={`f${i}`}
            x1={LEFT}
            y1={TOP + i * FRET_GAP}
            x2={LEFT + STRING_GAP * 5}
            y2={TOP + i * FRET_GAP}
            stroke="currentColor"
            strokeWidth={0.75}
            opacity={0.6}
          />
        ))}

        {/* strings */}
        {Array.from({ length: STRING_COUNT }).map((_, i) => (
          <line
            key={`s${i}`}
            x1={LEFT + i * STRING_GAP}
            y1={TOP}
            x2={LEFT + i * STRING_GAP}
            y2={TOP + FRET_GAP * FRET_COUNT}
            stroke="currentColor"
            strokeWidth={0.75}
            opacity={0.6}
          />
        ))}

        {/* barre */}
        {shape.barre && (
          <rect
            x={LEFT + shape.barre.fromString * STRING_GAP - 4}
            y={TOP + (shape.barre.fret - baseFret + 0.5) * FRET_GAP - 4}
            width={
              (shape.barre.toString - shape.barre.fromString) * STRING_GAP + 8
            }
            height={8}
            rx={4}
            fill="currentColor"
            opacity={0.85}
          />
        )}

        {/* dots + open/mute markers */}
        {shape.frets.map((fret, stringIdx) => {
          const x = LEFT + stringIdx * STRING_GAP;
          if (fret === -1) {
            return (
              <text
                key={stringIdx}
                x={x}
                y={TOP - 8}
                fontSize={9}
                textAnchor="middle"
                fill="currentColor"
              >
                ×
              </text>
            );
          }
          if (fret === 0) {
            return (
              <circle
                key={stringIdx}
                cx={x}
                cy={TOP - 8}
                r={3}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
              />
            );
          }
          const relFret = fret - baseFret + 1;
          const y = TOP + (relFret - 0.5) * FRET_GAP;
          return (
            <circle key={stringIdx} cx={x} cy={y} r={4.5} fill="currentColor" />
          );
        })}
      </svg>
      <span className="text-xs font-medium">{chord}</span>
    </div>
  );
}
