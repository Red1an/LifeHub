import { disconnectSafely, getAudioContext } from "./context";
import { detectPitch } from "./autocorrelate";

export interface LivePitch {
  frequency: number;
  clarity: number;
  rms: number;
}

export interface MicHandle {
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
  close: () => void;
}

export async function openMic(): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const audio = getAudioContext();
  if (audio.state === "suspended") await audio.resume();
  const source = audio.createMediaStreamSource(stream);
  return {
    source,
    stream,
    close: () => {
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

/**
 * Reports detected pitch every animation frame, stamped with audio-clock time.
 * Use 8192 samples to resolve low notes; use 2048 when fast pitch movement
 * matters (vibrato, bends) — a long window averages the wobble away.
 */
export function trackPitch(
  source: AudioNode,
  onPitch: (pitch: LivePitch | null, time: number, level: number) => void,
  fftSize = 8192
): () => void {
  const audio = source.context as AudioContext;
  const analyser = audio.createAnalyser();
  analyser.fftSize = fftSize;
  source.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);
  let raf = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    onPitch(detectPitch(buffer, audio.sampleRate), audio.currentTime, Math.sqrt(sum / buffer.length));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    disconnectSafely(source, analyser);
  };
}

export async function startPitchTracking(
  onPitch: (pitch: LivePitch | null, time: number, level: number) => void,
  fftSize = 8192
): Promise<{ stop: () => void }> {
  const mic = await openMic();
  const stopTracking = trackPitch(mic.source, onPitch, fftSize);
  return {
    stop: () => {
      stopTracking();
      mic.close();
    },
  };
}
