import { useEffect, useState } from "react";
import { createOnsetDetector, getLatencyMs, hasCalibration, setLatencyMs } from "@modules/audio";
import { startMetronome } from "@modules/audio";
import { analyzeTiming, type Onset } from "@modules/audio";

const CLICKS = 8;
const BPM = 90;

/**
 * Measures the full round trip — speaker, your reaction, the mic and the
 * analysis — by asking you to play along with a few clicks. Without it every
 * note would look late by however long that chain takes on this device.
 */
export function LatencyCalibration({ source }: { source: AudioNode | null }) {
  const [latency, setLatency] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "failed">("idle");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the stored calibration after mount
    setLatency(hasCalibration() ? getLatencyMs() : null);
  }, []);

  async function calibrate() {
    if (!source) return;
    setStatus("running");
    const current = getLatencyMs() / 1000;
    const onsets: Onset[] = [];
    // The detector subtracts the stored latency; add it back to measure afresh.
    const detector = await createOnsetDetector(source, (o) =>
      onsets.push({ time: o.time + current, strength: o.strength })
    );
    const clicks: number[] = [];
    const metronome = startMetronome({
      getBpm: () => BPM,
      sound: "blip",
      startDelay: 0.6,
      onTick: (time, index) => {
        // First bar is a count-in; play along with the clicks after it.
        if (index >= 4 && index < 4 + CLICKS) clicks.push(time);
      },
    });
    const totalSeconds = 0.6 + ((4 + CLICKS) * 60) / BPM + 0.6;
    await new Promise((resolve) => setTimeout(resolve, totalSeconds * 1000));
    metronome.stop();
    detector.disconnect();

    const summary = analyzeTiming(clicks, onsets, 0.3, 1000);
    const errors = summary.matches.flatMap((m) => (m.errorMs === null ? [] : [m.errorMs]));
    if (errors.length < CLICKS - 2) {
      setStatus("failed");
      return;
    }
    const sorted = [...errors].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    setLatencyMs(median);
    setLatency(Math.round(median));
    setStatus("idle");
  }

  return (
    <div
      className={`rounded-2xl border p-4 text-sm ${
        latency === null
          ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            {latency === null ? "Нужна калибровка" : `Калибровка: задержка ${latency} мс`}
          </p>
          <p className="text-zinc-500">
            {status === "running"
              ? "Слушай 4 щелчка отсчёта, потом играй глухой удар по струнам точно с каждым из 8 щелчков."
              : status === "failed"
                ? "Не расслышал удары — играй погромче, ближе к микрофону, и попробуй ещё раз."
                : "Микрофон и динамики вносят задержку. Один раз сыграй вместе с щелчками — и анализ станет точным."}
          </p>
        </div>
        <button
          onClick={calibrate}
          disabled={!source || status === "running"}
          className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {status === "running" ? "Слушаю…" : latency === null ? "Откалибровать" : "Заново"}
        </button>
      </div>
    </div>
  );
}
