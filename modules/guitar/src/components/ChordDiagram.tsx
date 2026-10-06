import type { ChordShape } from "../lib/chord-shapes";
import { bestShape, parseChord } from "../lib/chords";
import { GUITAR_OPEN_STRINGS_MIDI } from "../lib/music-theory";

const FRETS = 5;
const W = 110;
const H = 138;
const LEFT = 20;
const RIGHT = 10;
const TOP = 26;
const BOTTOM = 8;
const SG = (W - LEFT - RIGHT) / 5;
const FG = (H - TOP - BOTTOM) / FRETS;

/** Диаграмма аккорда: лады, пальцы, баррэ; тоника подсвечена. */
export function ChordDiagram({
  chord,
  shape: given,
  size = 100,
  label = true,
  fingers = true,
}: {
  chord: string;
  shape?: ChordShape | null;
  size?: number;
  label?: boolean;
  fingers?: boolean;
}) {
  const shape = given ?? bestShape(chord);
  const root = parseChord(chord)?.root ?? -1;
  if (!shape) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-center text-xs text-[var(--gt-muted)]" style={{ width: size, height: (size * H) / W }}>
        <span className="text-lg">?</span>
        {label && <span className="font-bold text-[var(--gt-fg)]">{chord}</span>}
      </div>
    );
  }
  const pressed = shape.frets.filter((f) => f > 0);
  const maxFret = pressed.length ? Math.max(...pressed) : 0;
  const base = shape.baseFret && shape.baseFret > 1 ? shape.baseFret : maxFret > FRETS ? Math.min(...pressed) : 1;
  const y = (fret: number) => TOP + (fret - base + 0.5) * FG;
  const x = (s: number) => LEFT + s * SG;
  const isRoot = (s: number, f: number) => (GUITAR_OPEN_STRINGS_MIDI[s] + f) % 12 === root;

  return (
    <div className="gt-diagram flex flex-col items-center gap-0.5" style={{ width: size }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} aria-label={`Аккорд ${chord}`}>
        {base === 1 ? (
          <rect x={LEFT - 1} y={TOP - 4} width={SG * 5 + 2} height={4} rx={1} fill="currentColor" />
        ) : (
          <text x={LEFT - 6} y={TOP + FG * 0.62} fontSize={11} fontWeight={700} textAnchor="end" fill="var(--gt-brass)">
            {base}
          </text>
        )}
        {Array.from({ length: FRETS + 1 }).map((_, i) => (
          <line key={`f${i}`} x1={LEFT} y1={TOP + i * FG} x2={LEFT + SG * 5} y2={TOP + i * FG} stroke="currentColor" strokeWidth={0.8} opacity={0.35} />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`s${i}`} x1={x(i)} y1={TOP} x2={x(i)} y2={TOP + FG * FRETS} stroke="currentColor" strokeWidth={0.6 + (5 - i) * 0.18} opacity={0.55} />
        ))}
        {shape.barre && (
          <rect
            x={x(shape.barre.fromString) - 6}
            y={y(shape.barre.fret) - 6.5}
            width={(shape.barre.toString - shape.barre.fromString) * SG + 12}
            height={13}
            rx={6.5}
            fill="var(--gt-fg)"
          />
        )}
        {shape.frets.map((fret, s) => {
          if (fret === -1)
            return (
              <text key={s} x={x(s)} y={TOP - 9} fontSize={11} textAnchor="middle" fill="var(--gt-muted)">
                ×
              </text>
            );
          if (fret === 0)
            return <circle key={s} cx={x(s)} cy={TOP - 12} r={3.6} fill="none" stroke={isRoot(s, 0) ? "var(--gt-brass)" : "currentColor"} strokeWidth={1.4} />;
          const onBarre = shape.barre && shape.barre.fret === fret && s >= shape.barre.fromString && s <= shape.barre.toString;
          const finger = shape.fingers?.[s] ?? 0;
          const root = isRoot(s, fret);
          if (onBarre && !root) return null;
          return (
            <g key={s}>
              <circle cx={x(s)} cy={y(fret)} r={7} fill={root ? "var(--gt-brass)" : "var(--gt-fg)"} />
              {fingers && finger > 0 && (
                <text x={x(s)} y={y(fret) + 3.6} fontSize={9.5} fontWeight={800} textAnchor="middle" fill="#1a1006">
                  {finger}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {label && <span className="text-sm font-bold">{chord}</span>}
    </div>
  );
}
