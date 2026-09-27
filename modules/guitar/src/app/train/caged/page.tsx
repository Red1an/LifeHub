import { useMemo, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { InteractiveFretboard, FretMarker } from "../../../components/train/InteractiveFretboard";
import { playGuitarNote, strumChord } from "../../../lib/audio/guitar-synth";
import { unlockAudio } from "@modules/audio";
import { GUITAR_OPEN_STRINGS_MIDI, SHARP_NOTES, noteIndex } from "../../../lib/music-theory";
import { markPractice } from "../../../lib/train-stats";

// Open-position shapes, low E first; each names the note its root sits on.
const MAJOR_SHAPES = [
  { name: "C", root: "C", frets: [-1, 3, 2, 0, 1, 0] },
  { name: "A", root: "A", frets: [-1, 0, 2, 2, 2, 0] },
  { name: "G", root: "G", frets: [3, 2, 0, 0, 0, 3] },
  { name: "E", root: "E", frets: [0, 2, 2, 1, 0, 0] },
  { name: "D", root: "D", frets: [-1, -1, 0, 2, 3, 2] },
];
const MINOR_SHAPES = [
  { name: "Cm", root: "C", frets: [-1, 3, 1, 0, 1, -1] },
  { name: "Am", root: "A", frets: [-1, 0, 2, 2, 1, 0] },
  { name: "Gm", root: "G", frets: [3, 1, 0, 0, 3, 3] },
  { name: "Em", root: "E", frets: [0, 2, 2, 0, 0, 0] },
  { name: "Dm", root: "D", frets: [-1, -1, 0, 2, 3, 1] },
];

interface Placed {
  name: string;
  frets: number[];
  low: number;
}

/** Slides each open shape up the neck so it spells the chosen chord. */
function placeShapes(root: string, minor: boolean): Placed[] {
  const shapes = minor ? MINOR_SHAPES : MAJOR_SHAPES;
  return shapes
    .map((shape) => {
      const shift = (noteIndex(root) - noteIndex(shape.root) + 12) % 12;
      let frets = shape.frets.map((f) => (f < 0 ? -1 : f + shift));
      const sounding = frets.filter((f) => f >= 0);
      if (Math.min(...sounding) >= 12) frets = frets.map((f) => (f < 0 ? -1 : f - 12));
      return { name: shape.name, frets, low: Math.min(...frets.filter((f) => f >= 0)) };
    })
    .sort((a, b) => a.low - b.low);
}

const DEGREE: Record<number, string> = { 0: "R", 3: "♭3", 4: "3", 7: "5" };

export default function CagedExplorer() {
  const [root, setRoot] = useState("C");
  const [minor, setMinor] = useState(false);
  const [selected, setSelected] = useState(0);
  const [allTones, setAllTones] = useState(false);

  const shapes = useMemo(() => placeShapes(root, minor), [root, minor]);
  const current = shapes[Math.min(selected, shapes.length - 1)];
  const rootPc = noteIndex(root);
  const chordTones = new Set([0, minor ? 3 : 4, 7].map((i) => (rootPc + i) % 12));

  const markers: FretMarker[] = [];
  current.frets.forEach((fret, string) => {
    if (fret < 0) return;
    const pc = (GUITAR_OPEN_STRINGS_MIDI[string] + fret) % 12;
    const interval = (pc - rootPc + 12) % 12;
    markers.push({ string, fret, tone: interval === 0 ? "root" : "target", label: DEGREE[interval] });
  });
  if (allTones) {
    GUITAR_OPEN_STRINGS_MIDI.forEach((open, string) => {
      for (let fret = 0; fret <= 15; fret++) {
        const pc = (open + fret) % 12;
        if (chordTones.has(pc) && !markers.some((m) => m.string === string && m.fret === fret)) {
          markers.push({ string, fret, tone: "muted", label: DEGREE[(pc - rootPc + 12) % 12] });
        }
      }
    });
  }

  return (
    <ExerciseShell
      title="Аккорды по всему грифу (CAGED)"
      description="Любой аккорд можно взять в пяти местах грифа — это пять знакомых открытых форм C, A, G, E, D, сдвинутых вверх. Знаешь их — не упираешься в первые лады и видишь аккорд везде."
    >
      <div className="flex flex-wrap gap-1.5">
        {SHARP_NOTES.map((note) => (
          <button key={note} onClick={() => setRoot(note)} className={`h-9 w-11 rounded-lg text-sm font-medium ${root === note ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {note}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {[false, true].map((m) => (
          <button key={String(m)} onClick={() => setMinor(m)} className={`rounded-lg px-3 py-1.5 ${minor === m ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {m ? "Минор" : "Мажор"}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5">
          <input type="checkbox" checked={allTones} onChange={(e) => setAllTones(e.target.checked)} />
          все ноты аккорда на грифе
        </label>
      </div>

      <div className="my-4 flex flex-wrap gap-2">
        {shapes.map((shape, i) => (
          <button
            key={shape.name}
            onClick={() => {
              setSelected(i);
              void unlockAudio();
              strumChord(shape.frets);
              markPractice("caged");
            }}
            className={`flex flex-col items-center rounded-xl border-2 px-3 py-2 text-sm ${i === selected ? "border-emerald-500" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            <span className="font-semibold">Форма {shape.name}</span>
            <span className="text-xs text-zinc-500">{shape.low === 0 ? "открытая" : `с ${shape.low} лада`}</span>
          </button>
        ))}
      </div>

      <InteractiveFretboard
        startFret={0}
        fretCount={15}
        markers={markers}
        onSelect={(p) => {
          void unlockAudio();
          playGuitarNote(p.midi);
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => { void unlockAudio(); strumChord(current.frets); }} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
          ▶ Сыграть {root}{minor ? "m" : ""} формой {current.name}
        </button>
        <button
          onClick={() => {
            void unlockAudio();
            shapes.forEach((shape, i) => strumChord(shape.frets, { when: i * 0.9 }));
          }}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm dark:bg-zinc-800"
        >
          ▶ Все пять подряд
        </button>
      </div>

      <div className="mt-4 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        <p className="mb-1 font-medium text-zinc-800 dark:text-zinc-200">Как учить</p>
        Формы идут по грифу по кругу C → A → G → E → D и соприкасаются краями.
        Выучи порядок, потом играй один аккорд всеми пятью формами подряд
        снизу вверх. Зелёная R — тоника: по ней находишь форму на любом ладу.
      </div>
    </ExerciseShell>
  );
}
