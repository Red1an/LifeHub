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

const NOTE_S = 0.8;
const FFT = 4096;

const PHRASES = [
  { id: "up", label: "Гамма вверх", degrees: [0, 1, 2, 3, 4] },
  { id: "down", label: "Гамма вниз", degrees: [4, 3, 2, 1, 0] },
  { id: "arp", label: "Арпеджио", degrees: [0, 2, 4, 7, 4, 2, 0] },
  { id: "random", label: "Случайная фраза", degrees: [] as number[] },
];

function degreesToMidi(root: number, degrees: number[]): number[] {
  return degrees.map((d) => root + Math.floor(d / 7) * 12 + MAJOR_STEPS[((d % 7) + 7) % 7]);
}

function randomDegrees(): number[] {
  const out = [0];
  while (out.length < 6) {
    const step = [-2, -1, 1, 1, 2][randomInt(0, 4)];
    out.push(Math.max(-2, Math.min(7, out[out.length - 1] + step)));
  }
  return out;
}

export default function PitchGraphTrainer() {
  const [range, setRange] = useState(VOICE_RANGES[1]);
  const [phraseId, setPhraseId] = useState("up");
  const [notes, setNotes] = useState<SungNote[]>(() =>
    degreesToMidi(VOICE_RANGES[1].root, PHRASES[0].degrees).map((midi, i) => ({ start: i * NOTE_S, end: (i + 1) * NOTE_S, midi }))
  );
  const [samples, setSamples] = useState<GraphSample[]>([]);
  const [phase, setPhase] = useState<"idle" | "countin" | "recording" | "done">("idle");
  const [verdicts, setVerdicts] = useState<NoteVerdict[]>([]);
  const [guide, setGuide] = useState(false);
  const [now, setNow] = useState<number | undefined>(undefined);

  const recordingRef = useRef<{ start: number; end: number } | null>(null);
  const bufferRef = useRef<GraphSample[]>([]);
  const frameRef = useRef(0);

  const onFrame = useCallback((pitch: { frequency: number; clarity: number } | null, time: number) => {
    const rec = recordingRef.current;
    if (!rec) return;
    // The analysis window lags the voice by half its length.
    const t = time - rec.start - FFT / 2 / getAudioContext().sampleRate;
    if (t < 0) return;
    const midi = pitch && pitch.clarity > 0.9 ? freqToMidiFloat(pitch.frequency) : null;
    bufferRef.current.push({ t, midi });
    if (++frameRef.current % 3 === 0) {
      setSamples([...bufferRef.current]);
      setNow(t);
    }
  }, []);

  const mic = useMicPitch({ fftSize: FFT, onFrame });

  function buildNotes(nextRange = range, nextPhrase = phraseId): SungNote[] {
    const phrase = PHRASES.find((p) => p.id === nextPhrase)!;
    const degrees = phrase.id === "random" ? randomDegrees() : phrase.degrees;
    return degreesToMidi(nextRange.root, degrees).map((midi, i) => ({ start: i * NOTE_S, end: (i + 1) * NOTE_S, midi }));
  }

  function reset(nextRange = range, nextPhrase = phraseId) {
    setRange(nextRange);
    setPhraseId(nextPhrase);
    setNotes(buildNotes(nextRange, nextPhrase));
    setSamples([]);
    setVerdicts([]);
    setPhase("idle");
    setNow(undefined);
  }

  function listen() {
    void unlockAudio();
    notes.forEach((n) => playGuitarNote(n.midi, { when: n.start, gain: 0.7, duration: NOTE_S }));
  }

  async function sing() {
    await unlockAudio();
    const audio = getAudioContext();
    const beat = NOTE_S;
    const countStart = audio.currentTime + 0.2;
    for (let i = 0; i < 4; i++) playBlip(i === 0, countStart - audio.currentTime + i * beat);
    // Sound the first note during the count-in so the voice has a reference.
    playGuitarNote(notes[0].midi, { when: 0.2, gain: 0.5, duration: beat * 2 });
    const start = countStart + 4 * beat;
    const total = notes[notes.length - 1].end;
    if (guide) notes.forEach((n) => playGuitarNote(n.midi, { when: start - audio.currentTime + n.start, gain: 0.25, duration: NOTE_S }));

    bufferRef.current = [];
    setSamples([]);
    setVerdicts([]);
    setPhase("countin");
    recordingRef.current = { start, end: start + total };
    window.setTimeout(() => setPhase("recording"), (start - audio.currentTime) * 1000);
    window.setTimeout(() => {
      recordingRef.current = null;
      const recorded = [...bufferRef.current];
      const results = notes.map((n) => judgeNote(recorded, n));
      setSamples(recorded);
      setVerdicts(results);
      setPhase("done");
      setNow(undefined);
      recordScore("pitch-graph", Math.round((results.filter((r) => r.hit).length / results.length) * 100));
    }, (start - audio.currentTime + total + 0.3) * 1000);
  }

  const total = notes[notes.length - 1].end;
  const busy = phase === "countin" || phase === "recording";
  const hits = verdicts.filter((v) => v.hit).length;

  return (
    <ExerciseShell
      title="График голоса"
      description="Послушай фразу, затем спой её после отсчёта. Линия твоего голоса ляжет поверх нужных нот — сразу видно, где ты фальшивишь, «подъезжаешь» снизу или не держишь ноту."
      accent="rose"
    >
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop} level={mic.level}>
        <div className="flex flex-wrap gap-2">
          {VOICE_RANGES.map((item) => (
            <button
              key={item.id}
              disabled={busy}
              onClick={() => reset(item)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${range.id === item.id ? "bg-rose-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {PHRASES.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => reset(range, p.id)}
              className={`rounded-lg px-3 py-1.5 text-sm ${phraseId === p.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 text-sm">
          {notes.map((n, i) => {
            const v = verdicts[i];
            return (
              <span
                key={i}
                className={`rounded-lg border px-2 py-1 ${
                  !v ? "border-zinc-200 dark:border-zinc-800" : v.hit ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : "border-red-400 bg-red-50 dark:bg-red-950"
                }`}
              >
                {midiToSolfege(n.midi)} <span className="text-zinc-500">{midiToName(n.midi)}</span>
                {v && v.medianCents !== null && (
                  <span className="ml-1 text-xs text-zinc-500">
                    {v.medianCents > 0 ? "+" : ""}
                    {Math.round(v.medianCents)}¢
                  </span>
                )}
                {v && v.medianCents === null && <span className="ml-1 text-xs text-red-500">нет звука</span>}
              </span>
            );
          })}
        </div>

        <PitchGraph
          samples={samples}
          duration={total}
          now={now}
          targets={notes.map((n, i) => ({ ...n, hit: verdicts[i] ? verdicts[i].hit : null }))}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={listen} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium dark:bg-zinc-800">
            ▶ Послушать
          </button>
          <button onClick={sing} disabled={busy} className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">
            {phase === "countin" ? "Отсчёт…" : phase === "recording" ? "Пой!" : "● Спеть"}
          </button>
          {phraseId === "random" && !busy && (
            <button onClick={() => reset()} className="text-sm text-zinc-500 hover:underline">
              новая фраза
            </button>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} />
            тихая подсказка (в наушниках)
          </label>
        </div>

        {phase === "done" && (
          <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-900 p-4 text-sm">
            <p className="mb-1 text-lg font-semibold">
              {hits} из {notes.length} нот точно
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">
              {(() => {
                const off = verdicts.flatMap((v) => (v.medianCents === null ? [] : [v.medianCents]));
                const mean = off.length ? off.reduce((a, b) => a + b, 0) / off.length : 0;
                if (!off.length) return "Голоса почти не слышно — пой громче или ближе к микрофону.";
                if (mean < -20) return `В среднем поёшь ниже на ${Math.round(-mean)}¢ — поддержи звук дыханием и думай о ноте «сверху».`;
                if (mean > 20) return `В среднем поёшь выше на ${Math.round(mean)}¢ — не зажимай горло на высоких нотах.`;
                return "В среднем интонация точная. Смотри на красные ноты — там и нужно поработать.";
              })()}
            </p>
          </div>
        )}
      </MicGate>
    </ExerciseShell>
  );
}
