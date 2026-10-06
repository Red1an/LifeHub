import { midiToName, midiToSolfege } from "../../lib/music-theory";

interface Props {
  /** Cents away from the target note; null when nothing is being heard. */
  cents: number | null;
  /** Note the meter is currently judging (detected note, or the drill target). */
  midi: number | null;
  tolerance?: number; // cents counted as "in tune"
  caption?: string;
}

const RANGE = 50; // meter spans ±50 cents

export function PitchMeter({ cents, midi, tolerance = 15, caption }: Props) {
  const inTune = cents !== null && Math.abs(cents) <= tolerance;
  const clamped = cents === null ? 0 : Math.max(-RANGE, Math.min(RANGE, cents));
  const position = 50 + (clamped / RANGE) * 50;

  return (
    <div className="gt-panel flex flex-col items-center gap-4 p-6">
      <div className="flex flex-col items-center gap-1">
        <span
          className={`gt-num text-6xl font-bold transition-colors ${
            cents === null
              ? "text-[var(--gt-line)]"
              : inTune
                ? "text-[var(--gt-green)]"
                : "text-[var(--gt-fg)]"
          }`}
        >
          {midi === null ? "—" : midiToName(midi)}
        </span>
        <span className="text-sm text-[var(--gt-muted)]">
          {midi === null ? "тишина" : midiToSolfege(midi)}
        </span>
      </div>

      <div className="relative h-14 w-full max-w-sm">
        {/* scale */}
        <div className="absolute inset-x-0 top-6 h-1.5 rounded-full bg-[#2a2420]" />
        <div
          className={`absolute top-6 h-1.5 rounded-full transition-colors ${
            inTune ? "bg-[var(--gt-green)]/30" : "bg-[var(--gt-brass)]/20"
          }`}
          style={{
            left: `${50 - (tolerance / RANGE) * 50}%`,
            width: `${(tolerance / RANGE) * 100}%`,
          }}
        />
        {/* centre line */}
        <div className="absolute left-1/2 top-3 h-8 w-0.5 -translate-x-1/2 bg-[var(--gt-muted)]" />

        {/* needle */}
        {cents !== null && (
          <div
            className="absolute top-1 transition-[left] duration-150 ease-out"
            style={{ left: `${position}%` }}
          >
            <div
              className={`h-12 w-1 -translate-x-1/2 rounded-full ${
                inTune ? "bg-[var(--gt-green)]" : "bg-[var(--gt-brass)]"
              }`}
            />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] text-[var(--gt-muted)]">
          <span>−50¢</span>
          <span>0</span>
          <span>+50¢</span>
        </div>
      </div>

      <div className="h-5 text-sm">
        {cents === null ? (
          <span className="text-[var(--gt-muted)]">{caption ?? "Сыграй или спой ноту"}</span>
        ) : inTune ? (
          <span className="font-bold text-[var(--gt-green)]">Точно в ноту</span>
        ) : (
          <span className="text-[var(--gt-muted)]">
            {cents > 0 ? "Выше на" : "Ниже на"} {Math.abs(Math.round(cents))}¢
          </span>
        )}
      </div>
    </div>
  );
}
