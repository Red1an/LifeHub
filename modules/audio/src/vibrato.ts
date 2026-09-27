// Analysis of a sustained sung note: tuning, drift and vibrato.
// Pure DSP so it can be tested outside the browser.

export interface PitchSample {
  t: number; // seconds
  midi: number; // fractional midi note
}

export interface SustainAnalysis {
  duration: number;
  nearestMidi: number;
  offsetCents: number; // average distance from the nearest note
  driftCents: number; // slow wander of the pitch centre (std of the trend)
  vibratoRate: number | null; // Hz
  vibratoExtent: number | null; // ± cents
}

const GRID_HZ = 100;

/**
 * `detectionWindow` is the analysis window used by the pitch detector, in
 * seconds. A window that long partly averages the vibrato away, so the
 * measured extent is scaled back up by the matching sinc loss.
 */
export function analyzeSustain(
  samples: PitchSample[],
  detectionWindow = 0
): SustainAnalysis | null {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  if (sorted.length < 20) return null;
  const start = sorted[0].t;
  const duration = sorted[sorted.length - 1].t - start;
  if (duration < 1) return null;

  // Resample onto a uniform grid so rate estimates do not depend on frame jitter.
  const count = Math.floor(duration * GRID_HZ);
  const series = new Float64Array(count);
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const t = start + i / GRID_HZ;
    while (cursor < sorted.length - 2 && sorted[cursor + 1].t < t) cursor++;
    const a = sorted[cursor];
    const b = sorted[cursor + 1];
    const span = b.t - a.t;
    series[i] = span > 0 ? a.midi + ((t - a.t) / span) * (b.midi - a.midi) : a.midi;
  }

  const mid = [...series].sort((x, y) => x - y)[Math.floor(count / 2)];
  const cents = series.map((m) => (m - mid) * 100);

  // Moving average over ~2 vibrato cycles leaves the slow pitch centre.
  const half = Math.round(0.18 * GRID_HZ);
  const trend = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(count - 1, i + half); j++) {
      sum += cents[j];
      n++;
    }
    trend[i] = sum / n;
  }
  const oscillation = cents.map((c, i) => c - trend[i]);

  const trendMean = trend.reduce((s, v) => s + v, 0) / count;
  const driftCents = Math.sqrt(trend.reduce((s, v) => s + (v - trendMean) ** 2, 0) / count);
  const centreMidi = mid + trendMean / 100;
  const nearestMidi = Math.round(centreMidi);

  // Zero crossings with hysteresis; peak magnitude per half cycle.
  const hysteresis = 3;
  let sign = 0;
  let crossings = 0;
  let firstCrossing = -1;
  let lastCrossing = -1;
  let peak = 0;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = oscillation[i];
    peak = Math.max(peak, Math.abs(value));
    const next = value > hysteresis ? 1 : value < -hysteresis ? -1 : sign;
    if (sign !== 0 && next !== sign) {
      crossings++;
      if (firstCrossing < 0) firstCrossing = i;
      lastCrossing = i;
      peaks.push(peak);
      peak = 0;
    }
    sign = next;
  }

  let vibratoRate: number | null = null;
  let vibratoExtent: number | null = null;
  if (crossings >= 4 && lastCrossing > firstCrossing) {
    const rate = (crossings - 1) / 2 / ((lastCrossing - firstCrossing) / GRID_HZ);
    const extent = peaks.slice(1).reduce((s, p) => s + p, 0) / Math.max(1, peaks.length - 1);
    const x = Math.PI * rate * detectionWindow;
    const attenuation = x > 0 ? Math.max(0.5, Math.sin(x) / x) : 1;
    if (rate >= 3 && rate <= 9 && extent / attenuation >= 10) {
      vibratoRate = rate;
      vibratoExtent = extent / attenuation;
    }
  }

  return {
    duration,
    nearestMidi,
    offsetCents: (centreMidi - nearestMidi) * 100,
    driftCents,
    vibratoRate,
    vibratoExtent,
  };
}
