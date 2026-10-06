import { useEffect, useMemo, useState } from "react";
import { cn, Modal } from "@lifehub/sdk";
import { unlockAudio } from "@modules/audio";
import type { ChordShape } from "../lib/chord-shapes";
import { chordNotes, parseChord, voicings } from "../lib/chords";
import { playSequence, strumChord } from "../lib/audio/guitar-synth";
import { GUITAR_OPEN_STRINGS_MIDI } from "../lib/music-theory";
import { ChordDiagram } from "./ChordDiagram";

export async function playShape(shape: ChordShape, mode: "strum" | "arp" = "strum") {
  await unlockAudio();
  if (mode === "strum") strumChord(shape.frets, { gain: 0.6 });
  else playSequence(shape.frets.flatMap((f, i) => (f < 0 ? [] : [GUITAR_OPEN_STRINGS_MIDI[i] + f])), 0.18);
}

/** Аккорд со всеми аппликатурами: листать, слушать, видеть ноты. */
export function ChordCard({ chord, extra = [], size = 150, compact }: { chord: string; extra?: ChordShape[]; size?: number; compact?: boolean }) {
  const list = useMemo(() => {
    const own = voicings(chord, 8);
    const seen = new Set<string>();
    return [...extra, ...own].filter((v) => {
      const k = v.frets.join();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [chord, extra]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [chord]);
  const shape = list[i] ?? null;
  const parsed = parseChord(chord);
  const notes = chordNotes(chord);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <button className="gt-btn gt-btn-ghost !min-h-10 !px-3" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Предыдущая аппликатура">
          ‹
        </button>
        <button onClick={() => shape && playShape(shape)} aria-label="Сыграть аккорд" className="rounded-2xl p-1 transition active:scale-95">
          <ChordDiagram chord={chord} shape={shape} size={size} label={false} />
        </button>
        <button className="gt-btn gt-btn-ghost !min-h-10 !px-3" disabled={i >= list.length - 1} onClick={() => setI(i + 1)} aria-label="Следующая аппликатура">
          ›
        </button>
      </div>
      {list.length > 1 && (
        <div className="flex gap-1">
          {list.map((_, j) => (
            <button key={j} onClick={() => setI(j)} className={cn("h-1.5 rounded-full transition-all", j === i ? "w-5 bg-[var(--gt-brass)]" : "w-1.5 bg-[var(--gt-line)]")} aria-label={`Вариант ${j + 1}`} />
          ))}
        </div>
      )}
      {!compact && (
        <div className="text-center text-sm">
          <div className="text-[var(--gt-muted)]">
            {parsed?.quality.label}
            {parsed?.bassName ? ` с басом ${parsed.bassName}` : ""}
            {shape?.barre ? " · баррэ" : ""}
          </div>
          {notes.names.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {notes.names.map((n, j) => (
                <span key={j} className="rounded-lg bg-[var(--gt-panel-2)] px-2 py-0.5 text-xs">
                  <b className={j === 0 ? "text-[var(--gt-brass)]" : ""}>{n}</b> <span className="text-[var(--gt-muted)]">{notes.degrees[j]}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {shape && (
        <div className="flex gap-2">
          <button className="gt-btn gt-btn-ghost !min-h-9 text-sm" onClick={() => playShape(shape)}>
            🔊 Удар
          </button>
          <button className="gt-btn gt-btn-ghost !min-h-9 text-sm" onClick={() => playShape(shape, "arp")}>
            🎶 Перебор
          </button>
        </div>
      )}
    </div>
  );
}

/** Окно с аккордом — открывается по нажатию на аккорд в тексте песни. */
export function ChordModal({ chord, extra, onClose }: { chord: string | null; extra?: ChordShape[]; onClose: () => void }) {
  return (
    <Modal open={!!chord} onClose={onClose} title={chord ?? ""}>
      <div className="gt-root -m-4 rounded-[inherit] p-5">{chord && <ChordCard chord={chord} extra={extra} size={170} />}</div>
    </Modal>
  );
}
