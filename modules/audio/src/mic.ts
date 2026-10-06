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

/*
 * Один поток микрофона на всю страницу. Упражнения берут его и отпускают;
 * поток закрывается через несколько секунд после последнего — переход между
 * упражнениями не запрашивает доступ заново и индикатор микрофона не мигает.
 */
let shared: { stream: MediaStream; users: number; closeTimer: number } | null = null;
let opening: Promise<MediaStream> | null = null;
const RELEASE_DELAY_MS = 4000;

function liveStream(): MediaStream | null {
  if (!shared) return null;
  if (shared.stream.getAudioTracks().some((t) => t.readyState === "live")) return shared.stream;
  shared = null;
  return null;
}

async function acquireStream(): Promise<MediaStream> {
  const live = liveStream();
  if (live) return live;
  opening ??= navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    .then((stream) => {
      shared = { stream, users: 0, closeTimer: 0 };
      return stream;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

export async function openMic(): Promise<MicHandle> {
  const stream = await acquireStream();
  if (shared) {
    window.clearTimeout(shared.closeTimer);
    shared.users++;
  }
  const audio = getAudioContext();
  if (audio.state === "suspended") await audio.resume();
  const source = audio.createMediaStreamSource(stream);
  let closed = false;
  return {
    source,
    stream,
    close: () => {
      if (closed) return;
      closed = true;
      source.disconnect();
      const s = shared;
      if (!s || s.stream !== stream) return;
      s.users = Math.max(0, s.users - 1);
      if (s.users === 0) {
        s.closeTimer = window.setTimeout(() => {
          if (shared === s && s.users === 0) {
            s.stream.getTracks().forEach((track) => track.stop());
            shared = null;
          }
        }, RELEASE_DELAY_MS);
      }
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
