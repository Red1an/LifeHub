// Monophonic pitch detection — McLeod Pitch Method (normalized square
// difference function), autocorrelation computed through an FFT.
// Pure DSP so it can be tested outside the browser.
//
// Why MPM: the NSDF peak height is a real 0..1 "how periodic" score, and
// picking the *first* peak above 93% of the highest one avoids the classic
// octave-too-low errors. The FFT keeps a 4096-sample window under ~0.3 ms,
// so phones no longer drop frames (which used to make the readout jump).

export interface PitchResult {
  frequency: number;
  clarity: number; // 0..1, how periodic the window looked
  rms: number;
}

const MIN_FREQ = 60; // below low E of a bass-ish voice
const MAX_FREQ = 1400; // above the top of a guitar's 24th fret
const MAX_WINDOW = 4096; // longer windows add latency without helping accuracy
const PEAK_THRESHOLD = 0.93;

interface Scratch {
  size: number;
  re: Float64Array;
  im: Float64Array;
  nsdf: Float64Array;
  x: Float64Array;
}
let scratch: Scratch | null = null;

function getScratch(n: number): Scratch {
  let size = 1;
  while (size < 2 * n) size <<= 1;
  if (!scratch || scratch.size !== size || scratch.x.length !== n) {
    scratch = { size, re: new Float64Array(size), im: new Float64Array(size), nsdf: new Float64Array(n), x: new Float64Array(n) };
  }
  return scratch;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  rmsThreshold = 0.001
): PitchResult | null {
  const n = Math.min(buf.length, MAX_WINDOW);
  const offset = buf.length - n;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[offset + i];
  mean /= n;

  const s = getScratch(n);
  const { re, im, nsdf, x } = s;
  let sumSquares = 0;
  for (let i = 0; i < n; i++) {
    const v = buf[offset + i] - mean;
    x[i] = v;
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / n);
  if (rms < rmsThreshold) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / MIN_FREQ));
  if (maxLag <= minLag) return null;

  // Autocorrelation r(τ) = IFFT(|FFT(x)|²). The power spectrum is real and
  // symmetric, so a forward FFT of it equals the inverse up to scale.
  re.fill(0);
  im.fill(0);
  re.set(x);
  fft(re, im);
  for (let i = 0; i < s.size; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im);
  const scale = 1 / s.size;

  // NSDF n(τ) = 2·r(τ) / m(τ), m(τ) = Σ x[j]² + x[j+τ]² (updated incrementally).
  let m = 2 * sumSquares;
  nsdf[0] = 1;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau];
    nsdf[tau] = m > 1e-12 ? (2 * re[tau] * scale) / m : 0;
  }

  // Key maxima: the highest point between each positive-going zero crossing
  // and the next negative-going one.
  const peaks: number[] = [];
  let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++; // leave the central lobe
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau < maxLag && nsdf[tau] > 0) {
      if (tau >= minLag && (best < 0 || nsdf[tau] > nsdf[best])) best = tau;
      tau++;
    }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return null;

  let highest = 0;
  for (const p of peaks) highest = Math.max(highest, nsdf[p]);
  if (highest < 0.5) return null;
  const chosen = peaks.find((p) => nsdf[p] >= PEAK_THRESHOLD * highest) ?? peaks[0];

  // Parabolic interpolation around the peak for sub-sample lag accuracy.
  let lag = chosen;
  let clarity = nsdf[chosen];
  const prev = nsdf[chosen - 1];
  const next = nsdf[chosen + 1];
  const denom = prev - 2 * nsdf[chosen] + next;
  if (denom < 0) {
    const shift = (prev - next) / (2 * denom);
    if (Math.abs(shift) < 1) {
      lag = chosen + shift;
      clarity = Math.min(1, nsdf[chosen] - 0.25 * (prev - next) * shift);
    }
  }

  const frequency = sampleRate / lag;
  if (frequency < MIN_FREQ || frequency > MAX_FREQ) return null;
  return { frequency, clarity, rms };
}
