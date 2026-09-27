import { useCallback, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { MicGate } from "../../../components/train/MicGate";
import { PitchGraph, GraphSample } from "../../../components/train/PitchGraph";
import { useMicPitch } from "@modules/audio";
import { getAudioContext } from "@modules/audio";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { analyzeSustain, SustainAnalysis } from "@modules/audio";
import { freqToMidiFloat, midiToName, midiToSolfege } from "../../../lib/music-theory";
import { recordScore } from "../../../lib/train-stats";

// Short window: a long one averages the vibrato wobble away (verified: 8192
// samples read a ±50¢ vibrato as ±12¢; 2048 reads it within ~10%).
const FFT = 2048;
const MAX_S = 12;
const SILENCE_END_S = 0.5;

type Phase = "idle" | "waiting" | "recording" | "done";

function verdicts(a: SustainAnalysis): { label: string; text: string; good: boolean }[] {
  const out: { label: string; text: string; good: boolean }[] = [];
  const off = Math.abs(a.offsetCents);
  out.push({
    label: "Точность",
    good: off <= 15,
    text:
      off <= 10
        ? `Точно в ноту ${midiToName(a.nearestMidi)} (${a.offsetCents > 0 ? "+" : ""}${Math.round(a.offsetCents)}¢)`
        : `${a.offsetCents > 0 ? "Выше" : "Ниже"} ноты ${midiToName(a.nearestMidi)} на ${Math.round(off)}¢`,
  });
  out.push({
    label: "Стабильность",
    good: a.driftCents <= 12,
    text: a.driftCents <= 8 ? `Очень ровно (плавание ${Math.round(a.driftCents)}¢)` : a.driftCents <= 15 ? `Ровно (плавание ${Math.round(a.driftCents)}¢)` : `Нота «плывёт» на ${Math.round(a.driftCents)}¢ — поддержи звук дыханием`,
  });
  if (a.vibratoRate === null || a.vibratoExtent === null) {
    out.push({ label: "Вибрато", good: true, text: "Нет — ровный прямой звук" });
  } else {
    const rate = a.vibratoRate;
    const extent = a.vibratoExtent;
    const natural = rate >= 4.5 && rate <= 7 && extent >= 15 && extent <= 90;
    const text =
      rate > 7
        ? `Частое, ${rate.toFixed(1)} Гц — похоже на дрожь; расслабь гортань`
        : rate < 4.5
          ? `Медленное, ${rate.toFixed(1)} Гц — голос «качается»`
          : extent > 90
            ? `Слишком широкое (±${Math.round(extent)}¢) — сделай его уже`
            : `Естественное: ${rate.toFixed(1)} Гц, ±${Math.round(extent)}¢`;
    out.push({ label: "Вибрато", good: natural, text });
  }
  out.push({ label: "Длительность", good: a.duration >= 5, text: `${a.duration.toFixed(1)} с${a.duration < 5 ? " — старайся тянуть дольше" : ""}` });
  return out;
}

export default function SustainTrainer() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [samples, setSamples] = useState<GraphSample[]>([]);
  const [result, setResult] = useState<SustainAnalysis | null>(null);
  const [reference, setReference] = useState<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const bufferRef = useRef<{ t: number; midi: number }[]>([]);
  const startRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const frameRef = useRef(0);

  const finish = useCallback(() => {
    phaseRef.current = "done";
    setPhase("done");
    const analysis = analyzeSustain(bufferRef.current, FFT / getAudioContext().sampleRate);
    setResult(analysis);
    if (analysis) {
      const score = Math.round(Math.max(0, 100 - Math.abs(analysis.offsetCents) * 1.2 - analysis.driftCents * 2.5));
      recordScore("sustain", score);
    }
  }, []);

  const onFrame = useCallback(
    (pitch: { frequency: number; clarity: number } | null, time: number) => {
      const phaseNow = phaseRef.current;
      const voiced = pitch && pitch.clarity > 0.92;
      if (phaseNow === "waiting" && voiced) {
        phaseRef.current = "recording";
        setPhase("recording");
        startRef.current = time;
        bufferRef.current = [];
      }
      if (phaseRef.current !== "recording") return;
      const t = time - startRef.current;
      if (voiced) {
        lastVoiceRef.current = time;
        bufferRef.current.push({ t, midi: freqToMidiFloat(pitch!.frequency) });
      }
      if (++frameRef.current % 3 === 0) {
        setSamples(bufferRef.current.map((s) => ({ t: s.t, midi: s.midi })));
      }
      if (time - lastVoiceRef.current > SILENCE_END_S || t > MAX_S) finish();
    },
    [finish]
  );

  const mic = useMicPitch({ fftSize: FFT, onFrame });

  function begin() {
    setResult(null);
    setSamples([]);
    lastVoiceRef.current = getAudioContext().currentTime + 5;
    phaseRef.current = "waiting";
    setPhase("waiting");
  }

  const centre = result ? result.nearestMidi : samples.length ? Math.round(samples[samples.length - 1].midi ?? 60) : 60;

  return (
    <ExerciseShell
      title="Удержание и вибрато"
      description="Возьми удобную ноту и тяни её ровно 5–10 секунд на гласной «а». Приложение покажет, насколько точно и стабильно ты держишь звук, и разберёт вибрато — частоту и ширину."
      accent="rose"
    >
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop} level={mic.level}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Опорная нота (необязательно):</span>
          {[48, 53, 57, 60, 64, 67].map((m) => (
            <button
              key={m}
              onClick={() => {
                setReference(m);
                playGuitarNote(m, { gain: 0.7 });
              }}
              className={`rounded-lg px-2.5 py-1 ${reference === m ? "bg-rose-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
            >
              {midiToSolfege(m)} {midiToName(m)}
            </button>
          ))}
        </div>

        <PitchGraph
          samples={samples}
          duration={Math.max(6, samples.length ? samples[samples.length - 1].t + 0.5 : 6)}
          range={[centre - 2, centre + 2]}
          targets={result || reference !== null ? [{ start: 0, end: MAX_S, midi: result ? result.nearestMidi : reference!, hit: null }] : []}
          toleranceCents={15}
        />

        <button
          onClick={phase === "waiting" || phase === "recording" ? finish : begin}
          className={`w-full rounded-2xl py-5 text-lg font-semibold text-white ${
            phase === "recording" ? "bg-red-600" : phase === "waiting" ? "bg-zinc-500" : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          {phase === "waiting" ? "Жду голос… начинай петь" : phase === "recording" ? "Тяни! (стоп)" : "Начать"}
        </button>

        {phase === "done" && !result && (
          <p className="text-center text-sm text-zinc-500">Слишком коротко — тяни ноту хотя бы пару секунд.</p>
        )}

        {result && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {verdicts(result).map((v) => (
              <div
                key={v.label}
                className={`rounded-xl border p-3 text-sm ${v.good ? "border-emerald-300 dark:border-emerald-900" : "border-amber-300 dark:border-amber-900"}`}
              >
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">{v.label}</div>
                <div>{v.text}</div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-zinc-500">
          Норма вибрато у певцов — 5–7 колебаний в секунду шириной ±20–60¢.
          Ровный звук без вибрато тоже правильный — важно, чтобы нота не плыла.
        </p>
      </MicGate>
    </ExerciseShell>
  );
}
