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
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex flex-col items-center gap-1">
        <span
          className={`text-5xl font-bold tabular-nums transition-colors ${
            cents === null
              ? "text-zinc-300 dark:text-zinc-700"
              : inTune
                ? "text-emerald-500"
                : "text-zinc-900 dark:text-zinc-100"
          }`}
        >
          {midi === null ? "—" : midiToName(midi)}
        </span>
        <span className="text-sm text-zinc-500">
          {midi === null ? "тишина" : midiToSolfege(midi)}
        </span>
      </div>

      <div className="relative h-14 w-full max-w-sm">
        {/* scale */}
        <div className="absolute inset-x-0 top-6 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div
          className={`absolute top-6 h-1.5 rounded-full transition-colors ${
            inTune ? "bg-emerald-500/30" : "bg-amber-500/20"
          }`}
          style={{
            left: `${50 - (tolerance / RANGE) * 50}%`,
            width: `${(tolerance / RANGE) * 100}%`,
          }}
        />
        {/* centre line */}
        <div className="absolute left-1/2 top-3 h-8 w-0.5 -translate-x-1/2 bg-zinc-400 dark:bg-zinc-600" />

        {/* needle */}
        {cents !== null && (
          <div
            className="absolute top-1 transition-[left] duration-75"
            style={{ left: `${position}%` }}
          >
            <div
              className={`h-12 w-1 -translate-x-1/2 rounded-full ${
                inTune ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] text-zinc-400">
          <span>−50¢</span>
          <span>0</span>
          <span>+50¢</span>
        </div>
      </div>

      <div className="h-5 text-sm">
        {cents === null ? (
          <span className="text-zinc-500">{caption ?? "Сыграй или спой ноту"}</span>
        ) : inTune ? (
          <span className="font-medium text-emerald-500">Точно в ноту</span>
        ) : (
          <span className="text-zinc-500">
            {cents > 0 ? "Выше на" : "Ниже на"} {Math.abs(Math.round(cents))}¢
          </span>
        )}
      </div>
    </div>
  );
}
