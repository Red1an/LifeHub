import { useMemo, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { InteractiveFretboard, FretMarker } from "../../../components/train/InteractiveFretboard";
import { playGuitarNote, playSequence } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { GUITAR_OPEN_STRINGS_MIDI, SHARP_NOTES, noteIndex } from "../../../lib/music-theory";
import { markPractice } from "../../../lib/train-stats";

const SCALES = [
  { id: "pent-min", label: "Минорная пентатоника", intervals: [0, 3, 5, 7, 10] },
  { id: "pent-maj", label: "Мажорная пентатоника", intervals: [0, 2, 4, 7, 9] },
  { id: "blues", label: "Блюзовая", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "minor", label: "Натуральный минор", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major", label: "Мажор (ионийский)", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "dorian", label: "Дорийский", intervals: [0, 2, 3, 5, 7, 9, 10] },
];

const DEGREE_LABEL: Record<number, string> = {
  0: "1", 2: "2", 3: "♭3", 4: "3", 5: "4", 6: "♭5", 7: "5", 8: "♭6", 9: "6", 10: "♭7", 11: "7",
};

export default function ScalesExplorer() {
  const [root, setRoot] = useState("A");
  const [scale, setScale] = useState(SCALES[0]);
  const [startFret, setStartFret] = useState(0);
  const [fretCount, setFretCount] = useState(12);
  const [showDegrees, setShowDegrees] = useState(true);

  const rootPc = noteIndex(root);

  const markers: FretMarker[] = useMemo(() => {
    const pcToInterval = new Map<number, number>();
    scale.intervals.forEach((interval) => {
      pcToInterval.set(((rootPc + interval) % 12 + 12) % 12, interval);
    });

    const result: FretMarker[] = [];
    GUITAR_OPEN_STRINGS_MIDI.forEach((openMidi, stringIndex) => {
      for (let i = 0; i <= fretCount; i++) {
        const fret = i === 0 ? 0 : startFret + i;
        const midi = openMidi + fret;
        const pc = ((midi % 12) + 12) % 12;
        const interval = pcToInterval.get(pc);
        if (interval === undefined) continue;
        result.push({
          string: stringIndex,
          fret,
          tone: interval === 0 ? "root" : "scale",
          label: showDegrees ? DEGREE_LABEL[interval] : SHARP_NOTES[pc],
        });
      }
    });
    return result;
  }, [rootPc, scale, startFret, fretCount, showDegrees]);

  function playScale() {
    void unlockAudio();
    markPractice("scales");
    // One octave up from the root on the low E string, then back down.
    const base = 40 + ((rootPc - noteIndex("E") + 12) % 12);
    const up = scale.intervals.map((interval) => base + interval);
    const full = [...up, base + 12, ...up.slice().reverse()];
    playSequence(full, 0.34, { gain: 0.6 });
  }

  return (
    <ExerciseShell
      title="Гаммы и боксы"
      description="Выбери тонику и гамму — гриф покажет все её ноты. Тыкай по ладам, чтобы услышать каждую, или проиграй гамму целиком."
    >
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {SHARP_NOTES.map((note) => (
            <button
              key={note}
              onClick={() => setRoot(note)}
              className={`h-9 w-11 rounded-lg text-sm font-medium transition-colors ${
                root === note
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {note}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {SCALES.map((item) => (
            <button
              key={item.id}
              onClick={() => setScale(item)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                scale.id === item.id
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <InteractiveFretboard
        startFret={startFret}
        fretCount={fretCount}
        markers={markers}
        onSelect={(position) => {
          void unlockAudio();
          playGuitarNote(position.midi);
        }}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 text-sm">
        <button
          onClick={playScale}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
        >
          ▶ Проиграть гамму
        </button>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showDegrees}
            onChange={(event) => setShowDegrees(event.target.checked)}
          />
          ступени вместо нот
        </label>

        <div className="flex items-center gap-2">
          <span className="text-zinc-500">Окно:</span>
          {[
            { label: "Весь гриф", start: 0, count: 12 },
            { label: "Бокс 5-8", start: 4, count: 5 },
            { label: "Бокс 7-10", start: 6, count: 5 },
          ].map((view) => (
            <button
              key={view.label}
              onClick={() => {
                setStartFret(view.start);
                setFretCount(view.count);
              }}
              className={`rounded px-2.5 py-1 ${
                startFret === view.start && fretCount === view.count
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Зелёные точки — тоника: начинай и заканчивай фразы на них, тогда соло
        звучит завершённым.
      </p>
    </ExerciseShell>
  );
}
