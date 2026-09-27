import { useCallback, useEffect, useRef, useState } from "react";
import { LivePitch, startPitchTracking } from "../mic";

export type MicState = "idle" | "starting" | "listening" | "denied" | "error";

export function micErrorState(error: unknown): MicState {
  const denied =
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError");
  return denied ? "denied" : "error";
}

interface Options {
  fftSize?: number;
  /** Raw, unsmoothed detector output for every frame — for recording and analysis. */
  onFrame?: (pitch: LivePitch | null, time: number) => void;
}

/**
 * Mic access plus a smoothed live pitch reading.
 *
 * The raw detector output jumps around between frames; smoothing in the
 * frequency domain (not cents) keeps the needle readable without lagging.
 */
export function useMicPitch(options: Options = {}) {
  const { fftSize = 8192 } = options;
  const [state, setState] = useState<MicState>("idle");
  const [pitch, setPitch] = useState<LivePitch | null>(null);
  const [level, setLevel] = useState(0);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const frameRef = useRef(0);
  const smoothedRef = useRef<number | null>(null);
  const missesRef = useRef(0);
  const onFrameRef = useRef(options.onFrame);

  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    smoothedRef.current = null;
    setPitch(null);
    setLevel(0);
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setState("starting");
    try {
      const session = await startPitchTracking((next, time, rms) => {
        onFrameRef.current?.(next, time);
        if (++frameRef.current % 4 === 0) setLevel(rms);
        if (!next || next.clarity < 0.9) {
          // Tolerate a few dropped frames so the readout does not flicker.
          missesRef.current += 1;
          if (missesRef.current > 6) {
            smoothedRef.current = null;
            setPitch(null);
          }
          return;
        }
        missesRef.current = 0;
        const previous = smoothedRef.current;
        const jumped = previous === null || Math.abs(next.frequency / previous - 1) > 0.06;
        const smoothed = jumped ? next.frequency : previous * 0.72 + next.frequency * 0.28;
        smoothedRef.current = smoothed;
        setPitch({ ...next, frequency: smoothed });
      }, fftSize);
      sessionRef.current = session;
      setState("listening");
    } catch (error) {
      setState(micErrorState(error));
    }
  }, [fftSize]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  return { state, pitch, level, start, stop };
}
