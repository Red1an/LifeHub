import { useCallback, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { PitchGraph, GraphSample } from "../../../components/train/PitchGraph";
import { useMicPitch } from "@modules/audio";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { playBlip } from "@modules/audio";
import { getAudioContext, unlockAudio } from "@modules/audio";
import { freqToMidiFloat, midiToName, midiToSolfege } from "../../../lib/music-theory";
import { MAJOR_STEPS, VOICE_RANGES, judgeNote, NoteVerdict, SungNote } from "../../../lib/vocal";
import { randomInt } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

const NOTE_S = 1.2;
const FFT = 4096;

const MODES = [
  { id: "above", label: "Терция выше", offset: 2 },
  { id: "below", label: "Терция ниже", offset: -2 },
  { id: "sixth", label: "Секста ниже", offset: -5 },
];

function degreeToMidi(root: number, degree: number): number {
  return root + Math.floor(degree / 7) * 12 + MAJOR_STEPS[((degree % 7) + 7) % 7];
}

function makeMelody(): number[] {
  const out = [randomInt(2, 4)];
  while (out.length < 6) {
    const step = [-1, -1, 1, 1, 2, -2][randomInt(0, 5)];
    out.push(Math.max(1, Math.min(6, out[out.length - 1] + step)));
  }
  return out;
}

export default function HarmonyTrainer() {
  const [range, setRange] = useState(VOICE_RANGES[1]);
  const [mode, setMode] = useState(MODES[0]);
  const [melody, setMelody] = useState<number[]>([2, 3, 4, 3, 2, 1]);
  const [samples, setSamples] = useState<GraphSample[]>([]);
  const [phase, setPhase] = useState<"idle" | "countin" | "singing" | "done">("idle");
  const [verdicts, setVerdicts] = useState<NoteVerdict[]>([]);
  const [now, setNow] = useState<number | undefined>(undefined);
  const recordingRef = useRef<{ start: number } | null>(null);
  const bufferRef = useRef<GraphSample[]>([]);
  const frameRef = useRef(0);

  const onFrame = useCallback((pitch: { frequency: number; clarity: number } | null, time: number) => {
    const rec = recordingRef.current;
    if (!rec) return;
    const t = time - rec.start - FFT / 2 / getAudioContext().sampleRate;
    if (t < 0) return;
    bufferRef.current.push({ t, midi: pitch && pitch.clarity > 0.9 ? freqToMidiFloat(pitch.frequency) : null });
    if (++frameRef.current % 3 === 0) {
      setSamples([...bufferRef.current]);
      setNow(t);
    }
  }, []);

  const mic = useMicPitch({ fftSize: FFT, onFrame });

  // The harmony part is the same melody shifted along the scale, so it stays in key.
  const harmonyRoot = range.root;
  const melodyNotes = melody.map((d) => degreeToMidi(harmonyRoot, d));
  const harmonyNotes: SungNote[] = melody.map((d, i) => ({
    start: i * NOTE_S,
    end: (i + 1) * NOTE_S,
    midi: degreeToMidi(harmonyRoot, d + mode.offset),
  }));
  const total = melody.length * NOTE_S;

  function playMelody(when = 0, gain = 0.6) {
    melodyNotes.forEach((m, i) => playGuitarNote(m, { when: when + i * NOTE_S, gain, duration: NOTE_S }));
  }

  async function sing() {
    await unlockAudio();
    const audio = getAudioContext();
    const countStart = audio.currentTime + 0.2;
    for (let i = 0; i < 4; i++) playBlip(i === 0, 0.2 + i * NOTE_S);
    playGuitarNote(harmonyNotes[0].midi, { when: 0.2, gain: 0.45, duration: NOTE_S * 2 });
    const start = countStart + 4 * NOTE_S;
    playMelody(start - audio.currentTime, 0.55);

    bufferRef.current = [];
    setSamples([]);
    setVerdicts([]);
    setPhase("countin");
    recordingRef.current = { start };
    window.setTimeout(() => setPhase("singing"), (start - audio.currentTime) * 1000);
    window.setTimeout(() => {
      recordingRef.current = null;
      const recorded = [...bufferRef.current];
      const results = harmonyNotes.map((n) => judgeNote(recorded, n, 45));
      setVerdicts(results);
      setSamples(recorded);
      setPhase("done");
      setNow(undefined);
      recordScore("harmony", Math.round((results.filter((r) => r.hit).length / results.length) * 100));
    }, (start - audio.currentTime + total + 0.3) * 1000);
  }

  function reset(nextRange = range, nextMode = mode) {
    setRange(nextRange);
    setMode(nextMode);
    setMelody(makeMelody());
    setSamples([]);
    setVerdicts([]);
    setPhase("idle");
  }

  const busy = phase === "countin" || phase === "singing";

  return (
    <ExerciseShell
      title="Второй голос"
      description="Гитара играет мелодию, а ты поёшь партию второго голоса — на терцию выше или ниже, как в дуэте. Так учатся подпевать и не «съезжать» на основную мелодию."
      accent="rose"
    >
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop} level={mic.level}>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button key={m.id} disabled={busy} onClick={() => reset(range, m)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode.id === m.id ? "bg-rose-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
              {m.label}
            </button>
          ))}
          {VOICE_RANGES.map((r) => (
            <button key={r.id} disabled={busy} onClick={() => reset(r)} className={`rounded-lg px-3 py-1.5 text-sm ${range.id === r.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center text-sm">
            <tbody>
              <tr className="text-zinc-500">
                <td className="pr-2 text-left text-xs">Мелодия</td>
                {melodyNotes.map((m, i) => (
                  <td key={i} className="px-1 py-1">{midiToSolfege(m)}</td>
                ))}
              </tr>
              <tr className="font-semibold">
                <td className="pr-2 text-left text-xs font-normal text-zinc-500">Твой голос</td>
                {harmonyNotes.map((n, i) => {
                  const v = verdicts[i];
                  return (
                    <td key={i} className="px-1 py-1">
                      <span className={`rounded px-1.5 py-0.5 ${!v ? "" : v.hit ? "bg-emerald-100 dark:bg-emerald-950" : "bg-red-100 dark:bg-red-950"}`}>
                        {midiToSolfege(n.midi)}
                      </span>
                      <div className="text-[10px] font-normal text-zinc-500">{midiToName(n.midi)}</div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        <PitchGraph samples={samples} duration={total} now={now} toleranceCents={45} targets={harmonyNotes.map((n, i) => ({ ...n, hit: verdicts[i] ? verdicts[i].hit : null }))} />

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { void unlockAudio(); playMelody(); }} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium dark:bg-zinc-800">
            ▶ Мелодия
          </button>
          <button
            onClick={() => {
              void unlockAudio();
              harmonyNotes.forEach((n) => playGuitarNote(n.midi, { when: n.start, gain: 0.6, duration: NOTE_S }));
            }}
            disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium dark:bg-zinc-800"
          >
            ▶ Моя партия
          </button>
          <button onClick={sing} disabled={busy} className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-60">
            {phase === "countin" ? "Отсчёт…" : phase === "singing" ? "Пой!" : "● Петь вместе с мелодией"}
          </button>
          {!busy && (
            <button onClick={() => reset()} className="text-sm text-zinc-500 hover:underline">новая мелодия</button>
          )}
        </div>

        {phase === "done" && (
          <p className="rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
            <b>{verdicts.filter((v) => v.hit).length} из {verdicts.length}</b> нот второго голоса точно.
            {" "}Если голос тянет на мелодию — сначала спой свою партию отдельно («▶ Моя партия»), потом вместе.
          </p>
        )}
        <p className="text-xs text-zinc-500">Пой в наушниках: иначе микрофон слышит гитару вместо тебя.</p>
      </MicGate>
    </ExerciseShell>
  );
}
