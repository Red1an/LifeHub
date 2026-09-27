import type { Onset } from "./rhythm-analysis";
import { disconnectSafely } from "./context";

const WORKLET_URL = "/worklets/onset-processor.js";
const LATENCY_KEY = "lifehub-audio:latency-ms";
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

function ensureWorklet(context: BaseAudioContext): Promise<void> {
  let promise = loaded.get(context);
  if (!promise) {
    promise = context.audioWorklet.addModule(WORKLET_URL);
    loaded.set(context, promise);
  }
  return promise;
}

/**
 * Streams note-onset candidates from `source`, in audio-clock seconds with the
 * calibrated round-trip latency already subtracted. Candidates include faint
 * ones on purpose — `analyzeTiming` decides which are notes.
 */
export async function createOnsetDetector(
  source: AudioNode,
  onOnset: (onset: Onset) => void
): Promise<{ disconnect: () => void }> {
  const context = source.context;
  await ensureWorklet(context);

  const node = new AudioWorkletNode(context, "onset-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const latency = getLatencyMs() / 1000;
  node.port.onmessage = (event: MessageEvent<{ time: number; strength: number }>) =>
    onOnset({ time: event.data.time - latency, strength: event.data.strength });

  // Some browsers only run nodes that reach the destination; route through silence.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute).connect(context.destination);

  return {
    disconnect: () => {
      node.port.onmessage = null;
      disconnectSafely(source, node);
      disconnectSafely(node);
      disconnectSafely(mute);
    },
  };
}

/** Round trip (speaker → ear → hand → mic → analysis), measured by calibration. */
export function getLatencyMs(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(LATENCY_KEY);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function setLatencyMs(value: number) {
  window.localStorage.setItem(LATENCY_KEY, String(Math.round(value)));
}

export function hasCalibration(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(LATENCY_KEY) !== null;
}
