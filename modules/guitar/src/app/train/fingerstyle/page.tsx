import { useEffect, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { ChordDiagram } from "../../../components/ChordDiagram";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { getAudioContext, unlockAudio } from "@modules/audio";
import { resolveChordShape } from "../../../lib/resolve-chord";
import { GUITAR_OPEN_STRINGS_MIDI } from "../../../lib/music-theory";
import { markPractice } from "../../../lib/train-stats";

// Roles: B = bass (lowest sounding string), A = alternate bass, g/b/e = treble strings.
const PATTERNS = [
  { id: "pima", label: "Арпеджио p-i-m-a", steps: ["B", "g", "b", "e", "A", "g", "b", "e"], beatsPerBar: 4, fingers: "p i m a p i m a" },
  { id: "travis", label: "Трэвис", steps: ["B+e", "b", "A", "g", "B", "b", "A", "g"], beatsPerBar: 4, fingers: "p+a m p i p m p i" },
  { id: "ballad", label: "Баллада", steps: ["B", "g", "b", "g", "e", "g", "b", "g"], beatsPerBar: 4, fingers: "p i m i a i m i" },
  { id: "waltz", label: "Вальс 3/4", steps: ["B", "", "g+b+e", "", "g+b+e", ""], beatsPerBar: 3, fingers: "p · (i m a) · (i m a) ·" },
];

const PROGRESSIONS = [
  ["C", "Am", "F", "G"],
  ["Am", "F", "C", "G"],
  ["G", "Em", "C", "D"],
  ["Em", "C", "G", "D"],
];

const STRING_LABELS = ["E", "A", "D", "G", "B", "e"];

function stringsFor(role: string, frets: number[]): number[] {
  const bass = frets.findIndex((f) => f >= 0);
  const alternate = bass < 2 ? 2 : bass + 1;
  return role
    .split("+")
    .filter(Boolean)
    .map((r) => ({ B: bass, A: alternate, g: 3, b: 4, e: 5 })[r as "B" | "A" | "g" | "b" | "e"])
    .filter((s): s is number => s !== undefined && frets[s] >= 0);
}

export default function FingerstyleTrainer() {
  const [pattern, setPattern] = useState(PATTERNS[0]);
  const [progression, setProgression] = useState(PROGRESSIONS[0]);
  const [bpm, setBpm] = useState(70);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState({ bar: 0, step: -1 });
  const bpmRef = useRef(bpm);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    if (!playing) return;
    const audio = getAudioContext();
    let next = audio.currentTime + 0.15;
    let index = 0;
    let stopped = false;
    const steps = pattern.steps.length;

    const interval = window.setInterval(() => {
      while (next < audio.currentTime + 0.12) {
        const bar = Math.floor(index / steps) % progression.length;
        const step = index % steps;
        const shape = resolveChordShape(progression[bar]);
        const when = Math.max(0, next - audio.currentTime);
        if (shape) {
          stringsFor(pattern.steps[step], shape.frets).forEach((s) =>
            playGuitarNote(GUITAR_OPEN_STRINGS_MIDI[s] + shape.frets[s], { when, gain: s < 3 ? 0.6 : 0.5 })
          );
        }
        window.setTimeout(() => {
          if (!stopped) setPosition({ bar, step });
        }, when * 1000);
        // Eighth notes in 4/4; the waltz pattern is written in eighths of 3/4.
        next += 60 / bpmRef.current / 2;
        index++;
      }
    }, 25);
    markPractice("fingerstyle");
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [playing, pattern, progression]);

  const chord = progression[position.bar] ?? progression[0];
  const shape = resolveChordShape(chord);

  return (
    <ExerciseShell
      title="Переборы"
      description="Разбери перебор по сетке: какая струна на какой доле и каким пальцем. Включи и играй вместе — подсветка показывает, где ты сейчас."
    >
      <div className="flex flex-wrap gap-2">
        {PATTERNS.map((p) => (
          <button key={p.id} onClick={() => setPattern(p)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${pattern.id === p.id ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {PROGRESSIONS.map((p) => (
          <button key={p.join()} onClick={() => setProgression(p)} className={`rounded-lg px-3 py-1.5 ${progression === p ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {p.join(" – ")}
          </button>
        ))}
      </div>

      <div className="my-4 flex items-center gap-4">
        <ChordDiagram chord={chord} size={90} />
        <div className="flex gap-2 text-sm">
          {progression.map((c, i) => (
            <span key={i} className={`rounded-lg px-2.5 py-1 ${playing && position.bar === i ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
        <table className="font-mono text-sm">
          <tbody>
            {[5, 4, 3, 2, 1, 0].map((s) => (
              <tr key={s}>
                <td className="pr-2 text-zinc-500">{STRING_LABELS[s]}</td>
                {pattern.steps.map((role, i) => {
                  const hit = shape ? stringsFor(role, shape.frets).includes(s) : false;
                  const active = playing && position.step === i;
                  return (
                    <td key={i} className={`h-7 w-9 text-center ${active ? "bg-emerald-100 dark:bg-emerald-950" : ""}`}>
                      {hit ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">{shape!.frets[s]}</span> : <span className="text-zinc-300 dark:text-zinc-700">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td />
              {pattern.steps.map((_, i) => (
                <td key={i} className="pt-1 text-center text-[10px] text-zinc-500">
                  {i % 2 === 0 ? i / 2 + 1 : "и"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-zinc-500">Пальцы: {pattern.fingers} (p — большой, i — указательный, m — средний, a — безымянный)</p>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold tabular-nums">{bpm} BPM</span>
          <button
            onClick={async () => {
              if (!playing) await unlockAudio();
              setPlaying((p) => !p);
            }}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white ${playing ? "bg-red-600" : "bg-emerald-600"}`}
          >
            {playing ? "Стоп" : "Играть"}
          </button>
        </div>
        <input type="range" min={40} max={140} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
      </div>
    </ExerciseShell>
  );
}
