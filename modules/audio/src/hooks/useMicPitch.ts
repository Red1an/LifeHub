import { useCallback, useEffect, useRef, useState } from "react";
import { LivePitch, startPitchTracking } from "../mic";
import { PitchStabilizer } from "../stabilizer";

export type MicState = "idle" | "starting" | "listening" | "denied" | "error";

export function micErrorState(error: unknown): MicState {
  const denied =
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError");
  return denied ? "denied" : "error";
}

interface Options {
  fftSize?: number;
  /** "stable" (по умолчанию для окна ≥ 4096) или "fast" — для бендов и вибрато. */
  mode?: "stable" | "fast";
  /** Raw, unsmoothed detector output for every frame — for recording and analysis. */
  onFrame?: (pitch: LivePitch | null, time: number) => void;
}

/**
 * Mic access plus a stable live pitch reading (see PitchStabilizer): the
 * displayed note does not flicker, jump octaves or vanish between frames.
 * `level` is a peak-hold meter value, so the level bar does not shake either.
 */
export function useMicPitch(options: Options = {}) {
  const { fftSize = 8192 } = options;
  const mode = options.mode ?? (fftSize >= 4096 ? "stable" : "fast");
  const [state, setState] = useState<MicState>("idle");
  const [pitch, setPitch] = useState<LivePitch | null>(null);
  const [level, setLevel] = useState(0);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const frameRef = useRef(0);
  const meterRef = useRef(0);
  const onFrameRef = useRef(options.onFrame);

  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setPitch(null);
    setLevel(0);
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setState("starting");
    const stabilizer = new PitchStabilizer({ mode });
    let lastShown: number | null = null;
    try {
      const session = await startPitchTracking((next, time, rms) => {
        onFrameRef.current?.(next, time);
        // Peak meter: rises instantly, falls slowly.
        meterRef.current = Math.max(rms, meterRef.current * 0.92);
        if (++frameRef.current % 3 === 0) setLevel(meterRef.current);
        const shown = stabilizer.push(next, rms, performance.now());
        if (shown === null) {
          if (lastShown !== null) setPitch(null);
          lastShown = null;
          return;
        }
        lastShown = shown;
        setPitch({ frequency: shown, clarity: next?.clarity ?? 1, rms });
      }, fftSize);
      sessionRef.current = session;
      setState("listening");
    } catch (error) {
      setState(micErrorState(error));
    }
  }, [fftSize, mode]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  return { state, pitch, level, start, stop };
}
