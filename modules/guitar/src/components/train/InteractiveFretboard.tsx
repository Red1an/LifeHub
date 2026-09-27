import { GUITAR_OPEN_STRINGS_MIDI } from "../../lib/music-theory";

export type MarkerTone = "root" | "scale" | "target" | "correct" | "wrong" | "muted";

export interface FretMarker {
  string: number; // 0 = low E
  fret: number; // 0 = open
  label?: string;
  tone?: MarkerTone;
}

const TONE_FILL: Record<MarkerTone, string> = {
  root: "#10b981",
  scale: "#71717a",
  target: "#f59e0b",
  correct: "#10b981",
  wrong: "#ef4444",
  muted: "#3f3f46",
};

const STRING_LABELS = ["E", "A", "D", "G", "B", "e"]; // low to high

interface Props {
  startFret?: number;
  fretCount?: number;
  markers?: FretMarker[];
  onSelect?: (position: { string: number; fret: number; midi: number }) => void;
  highlightFretNumbers?: boolean;
}

const LEFT = 42;
const RIGHT = 16;
const TOP = 18;
const BOTTOM = 26;
const FRET_GAP = 56;
const STRING_GAP = 28;

export function InteractiveFretboard({
  startFret = 0,
  fretCount = 12,
  markers = [],
  onSelect,
  highlightFretNumbers = true,
}: Props) {
  const stringCount = GUITAR_OPEN_STRINGS_MIDI.length;
  const width = LEFT + fretCount * FRET_GAP + RIGHT;
  const height = TOP + (stringCount - 1) * STRING_GAP + BOTTOM;

  // Visual row 0 is the high e string, so the board reads like a guitar held up.
  const rowForString = (stringIndex: number) => stringCount - 1 - stringIndex;
  const yForString = (stringIndex: number) => TOP + rowForString(stringIndex) * STRING_GAP;
  const xForFret = (fret: number) =>
    fret === 0 ? LEFT - 22 : LEFT + (fret - startFret - 0.5) * FRET_GAP;

  const markerAt = (stringIndex: number, fret: number) =>
    markers.find((m) => m.string === stringIndex && m.fret === fret);

  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="max-w-none text-zinc-700 dark:text-zinc-300"
        role="img"
        aria-label="Гриф гитары"
      >
        {/* fretboard surface */}
        <rect
          x={LEFT}
          y={TOP - 8}
          width={fretCount * FRET_GAP}
          height={(stringCount - 1) * STRING_GAP + 16}
          rx={4}
          className="fill-zinc-100 dark:fill-zinc-900"
        />

        {/* inlay dots */}
        {[3, 5, 7, 9, 15, 17, 19, 21].map((fret) =>
          fret > startFret && fret <= startFret + fretCount ? (
            <circle
              key={`inlay-${fret}`}
              cx={LEFT + (fret - startFret - 0.5) * FRET_GAP}
              cy={TOP + ((stringCount - 1) * STRING_GAP) / 2}
              r={7}
              className="fill-zinc-300 dark:fill-zinc-700"
            />
          ) : null
        )}
        {[12, 24].map((fret) =>
          fret > startFret && fret <= startFret + fretCount
            ? [0.3, 0.7].map((offset) => (
                <circle
                  key={`inlay-${fret}-${offset}`}
                  cx={LEFT + (fret - startFret - 0.5) * FRET_GAP}
                  cy={TOP + (stringCount - 1) * STRING_GAP * offset}
                  r={7}
                  className="fill-zinc-300 dark:fill-zinc-700"
                />
              ))
            : null
        )}

        {/* frets */}
        {Array.from({ length: fretCount + 1 }).map((_, i) => (
          <line
            key={`fret-${i}`}
            x1={LEFT + i * FRET_GAP}
            y1={TOP - 8}
            x2={LEFT + i * FRET_GAP}
            y2={TOP + (stringCount - 1) * STRING_GAP + 8}
            stroke="currentColor"
            strokeWidth={i === 0 && startFret === 0 ? 5 : 1.5}
            opacity={i === 0 && startFret === 0 ? 0.9 : 0.35}
          />
        ))}

        {/* strings + labels */}
        {GUITAR_OPEN_STRINGS_MIDI.map((_, stringIndex) => {
          const y = yForString(stringIndex);
          return (
            <g key={`string-${stringIndex}`}>
              <line
                x1={LEFT}
                y1={y}
                x2={LEFT + fretCount * FRET_GAP}
                y2={y}
                stroke="currentColor"
                strokeWidth={0.7 + (stringCount - 1 - stringIndex) * 0.35}
                opacity={0.65}
              />
              <text
                x={10}
                y={y + 4}
                fontSize={12}
                fill="currentColor"
                opacity={0.75}
              >
                {STRING_LABELS[stringIndex]}
              </text>
            </g>
          );
        })}

        {/* fret numbers */}
        {highlightFretNumbers &&
          Array.from({ length: fretCount }).map((_, i) => {
            const fret = startFret + i + 1;
            return (
              <text
                key={`num-${fret}`}
                x={LEFT + (i + 0.5) * FRET_GAP}
                y={height - 8}
                fontSize={11}
                textAnchor="middle"
                fill="currentColor"
                opacity={0.55}
              >
                {fret}
              </text>
            );
          })}

        {/* hit areas */}
        {onSelect &&
          GUITAR_OPEN_STRINGS_MIDI.map((openMidi, stringIndex) =>
            Array.from({ length: fretCount + 1 }).map((_, i) => {
              const fret = i === 0 ? 0 : startFret + i;
              const x = i === 0 ? LEFT - 34 : LEFT + (i - 1) * FRET_GAP;
              const w = i === 0 ? 26 : FRET_GAP;
              return (
                <rect
                  key={`hit-${stringIndex}-${fret}-${i}`}
                  x={x}
                  y={yForString(stringIndex) - STRING_GAP / 2}
                  width={w}
                  height={STRING_GAP}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() =>
                    onSelect({ string: stringIndex, fret, midi: openMidi + fret })
                  }
                />
              );
            })
          )}

        {/* markers */}
        {GUITAR_OPEN_STRINGS_MIDI.map((_, stringIndex) =>
          Array.from({ length: fretCount + 1 }).map((_, i) => {
            const fret = i === 0 ? 0 : startFret + i;
            const marker = markerAt(stringIndex, fret);
            if (!marker) return null;
            const tone = marker.tone ?? "scale";
            return (
              <g key={`marker-${stringIndex}-${fret}`} className="pointer-events-none">
                <circle
                  cx={xForFret(fret)}
                  cy={yForString(stringIndex)}
                  r={11}
                  fill={TONE_FILL[tone]}
                  stroke={fret === 0 ? TONE_FILL[tone] : "none"}
                  fillOpacity={fret === 0 ? 0.25 : 1}
                  strokeWidth={2}
                />
                {marker.label && (
                  <text
                    x={xForFret(fret)}
                    y={yForString(stringIndex) + 4}
                    fontSize={10}
                    fontWeight={600}
                    textAnchor="middle"
                    fill={fret === 0 ? TONE_FILL[tone] : "#fff"}
                  >
                    {marker.label}
                  </text>
                )}
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}
