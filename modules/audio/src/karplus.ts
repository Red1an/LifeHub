// Karplus-Strong plucked-string synthesis.
// Pure DSP: no Web Audio here, so it can be unit-tested outside the browser.

export interface PluckOptions {
  sampleRate: number;
  frequency: number;
  duration: number; // seconds
  brightness?: number; // 0..1 — how much high end survives the pick attack
  damping?: number; // 0.9..0.9999 — string decay per period
  pickPosition?: number; // 0..0.5 — comb notch position along the string
  seed?: number;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Renders one plucked note into a mono sample buffer.
 *
 * The delay line uses linear interpolation so notes land on the right pitch
 * instead of snapping to the nearest integer sample period, which at guitar
 * range would be off by up to ~10 cents — audible in ear training.
 */
export function renderPluck(opts: PluckOptions): Float32Array {
  const {
    sampleRate,
    frequency,
    duration,
    brightness = 0.5,
    damping = 0.996,
    pickPosition = 0.22,
    seed = 12345,
  } = opts;

  const length = Math.max(1, Math.floor(duration * sampleRate));
  const out = new Float32Array(length);

  // Higher notes decay faster, like a real string.
  const lossCut = 0.5 + 0.45 * Math.min(1, frequency / 1200);
  // The loss filter delays the loop by roughly (1-c)/c samples; subtract that
  // or every note renders flat (~9 cents at 440Hz).
  const filterDelay = (1 - lossCut) / lossCut;
  const delay = Math.max(2, sampleRate / frequency - filterDelay);
  const delayInt = Math.floor(delay);
  const frac = delay - delayInt;
  if (delayInt < 2) return out;

  // --- excitation: noise burst, softened and comb-filtered by pick position
  const rand = lcg(seed);
  const exciteLen = delayInt + 1;
  const excite = new Float32Array(exciteLen);
  let lp = 0;
  const attackCut = 0.25 + 0.7 * brightness; // one-pole coefficient
  for (let i = 0; i < exciteLen; i++) {
    const noise = rand() * 2 - 1;
    lp += attackCut * (noise - lp);
    excite[i] = lp;
  }
  const pickDelay = Math.max(1, Math.round(exciteLen * pickPosition));
  for (let i = exciteLen - 1; i >= pickDelay; i--) {
    excite[i] -= excite[i - pickDelay] * 0.7;
  }

  // normalize the burst so every pitch starts at a comparable level
  let peak = 0;
  for (let i = 0; i < exciteLen; i++) peak = Math.max(peak, Math.abs(excite[i]));
  if (peak > 0) {
    for (let i = 0; i < exciteLen; i++) excite[i] /= peak;
  }

  const seedLen = Math.min(exciteLen, length);
  for (let i = 0; i < seedLen; i++) out[i] = excite[i];

  // --- string loop: fractional delay + one-pole loss filter
  let loop = 0;
  for (let i = seedLen; i < length; i++) {
    const a = out[i - delayInt];
    const b = out[i - delayInt - 1] ?? a;
    const interpolated = a * (1 - frac) + b * frac;
    loop += lossCut * (interpolated - loop);
    out[i] = loop * damping;
  }

  // --- normalize so low and high notes arrive at a comparable level
  let outPeak = 0;
  for (let i = 0; i < length; i++) outPeak = Math.max(outPeak, Math.abs(out[i]));
  if (outPeak > 0) {
    const scale = 0.9 / outPeak;
    for (let i = 0; i < length; i++) out[i] *= scale;
  }

  // --- envelope: de-click the attack, fade the tail to silence
  const attackSamples = Math.min(length, Math.floor(sampleRate * 0.002));
  for (let i = 0; i < attackSamples; i++) out[i] *= i / attackSamples;
  const releaseSamples = Math.min(length, Math.floor(sampleRate * 0.04));
  for (let i = 0; i < releaseSamples; i++) {
    out[length - 1 - i] *= i / releaseSamples;
  }

  return out;
}
