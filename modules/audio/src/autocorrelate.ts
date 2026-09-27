// Monophonic pitch detection (ACF2+ style normalized autocorrelation).
// Pure DSP so it can be tested outside the browser.

export interface PitchResult {
  frequency: number;
  clarity: number; // 0..1, how periodic the window looked
  rms: number;
}

const MIN_FREQ = 60; // below low E of a bass-ish voice
const MAX_FREQ = 1400; // above the top of a guitar's 24th fret

export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  rmsThreshold = 0.001
): PitchResult | null {
  const size = buf.length;

  let sumSquares = 0;
  for (let i = 0; i < size; i++) sumSquares += buf[i] * buf[i];
  const rms = Math.sqrt(sumSquares / size);
  if (rms < rmsThreshold) return null;

  // Trim leading/trailing near-silence so the window is mostly signal.
  const threshold = 0.2 * rms;
  let start = 0;
  let end = size - 1;
  while (start < size / 2 && Math.abs(buf[start]) < threshold) start++;
  while (end > size / 2 && Math.abs(buf[end]) < threshold) end--;
  const trimmed = buf.subarray(start, end + 1);
  const n = trimmed.length;
  if (n < 128) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / MIN_FREQ));
  if (maxLag <= minLag) return null;

  // Normalized autocorrelation: dividing by the energy of both windows keeps
  // the peak height comparable across lags, so `clarity` means something.
  const correlations = new Float32Array(maxLag + 1);
  let bestLag = -1;
  let bestValue = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = trimmed[i];
      const b = trimmed[i + lag];
      sum += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const norm = Math.sqrt(energyA * energyB);
    const value = norm > 0 ? sum / norm : 0;
    correlations[lag] = value;
    if (value > bestValue) {
      bestValue = value;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestValue < 0.5) return null;

  // Prefer the first strong peak over a later, slightly stronger one —
  // otherwise a clean tone often reads an octave (or two) too low. Only start
  // hunting after the correlation has dipped: near lag 0 it is still inside
  // the central lobe, which is not a periodicity peak.
  const acceptable = bestValue * 0.9;
  let dipped = false;
  for (let lag = minLag + 1; lag < bestLag; lag++) {
    if (!dipped) {
      if (correlations[lag] < 0.5 * bestValue) dipped = true;
      continue;
    }
    if (
      correlations[lag] >= acceptable &&
      correlations[lag] > correlations[lag - 1] &&
      correlations[lag] >= correlations[lag + 1]
    ) {
      bestLag = lag;
      bestValue = correlations[lag];
      break;
    }
  }

  // Parabolic interpolation around the peak for sub-sample lag accuracy.
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const prev = correlations[bestLag - 1];
    const cur = correlations[bestLag];
    const next = correlations[bestLag + 1];
    const denom = 2 * (2 * cur - prev - next);
    if (denom !== 0) refinedLag = bestLag + (next - prev) / denom;
  }

  const frequency = sampleRate / refinedLag;
  if (frequency < MIN_FREQ || frequency > MAX_FREQ) return null;

  return { frequency, clarity: bestValue, rms };
}
