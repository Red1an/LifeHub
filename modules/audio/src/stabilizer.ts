// Turns the per-frame detector output into a readout that does not jump:
// noise gate that adapts to the room, median of recent frames, octave-error
// rejection, note-change hysteresis and a short hold after the sound stops.
// Pure logic so it can be tested outside the browser.

export interface StabilizerOptions {
  /** "stable" — tuner and sung notes; "fast" — bends and vibrato, where lag matters more. */
  mode?: "stable" | "fast";
  /** Minimal clarity of a frame (0..1). */
  minClarity?: number;
  /** How long to keep the last note after the sound stops, ms. */
  holdMs?: number;
}

const toMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
const toFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class PitchStabilizer {
  private readonly fast: boolean;
  private readonly minClarity: number;
  private readonly holdMs: number;
  private recent: number[] = [];
  private shown: number | null = null;
  private candidate: number | null = null;
  private candidateFrames = 0;
  private lastHeard = 0;
  private noiseFloor = 0.002;

  constructor(opts: StabilizerOptions = {}) {
    this.fast = opts.mode === "fast";
    this.minClarity = opts.minClarity ?? (this.fast ? 0.85 : 0.88);
    this.holdMs = opts.holdMs ?? (this.fast ? 150 : 350);
  }

  reset() {
    this.recent = [];
    this.shown = null;
    this.candidate = null;
    this.candidateFrames = 0;
  }

  /** Returns the frequency to show, or null for silence. `now` — ms. */
  push(frame: { frequency: number; clarity: number; rms: number } | null, rms: number, now: number): number | null {
    // Room noise: follow quiet frames quickly, loud ones very slowly.
    const k = rms < this.noiseFloor ? 0.2 : 0.002;
    this.noiseFloor += (rms - this.noiseFloor) * k;
    const gate = Math.max(0.0015, this.noiseFloor * 2.2);

    const voiced = frame && frame.clarity >= this.minClarity && frame.rms >= gate;
    if (!voiced) {
      if (this.shown !== null && now - this.lastHeard > this.holdMs) this.reset();
      return this.shown === null ? null : toFreq(this.shown);
    }
    this.lastHeard = now;

    const midi = toMidi(frame.frequency);
    this.recent.push(midi);
    const size = this.fast ? 3 : 5;
    if (this.recent.length > size) this.recent.shift();
    const median = [...this.recent].sort((a, b) => a - b)[this.recent.length >> 1];

    if (this.shown === null) {
      // Start only once a couple of frames agree — a single click is not a note.
      if (this.recent.length < (this.fast ? 1 : 2)) return null;
      this.shown = median;
      return toFreq(this.shown);
    }

    const diff = median - this.shown;
    if (Math.abs(diff) < (this.fast ? 1.5 : 0.6)) {
      // Same note: smooth in the pitch domain, keeping small moves visible.
      const alpha = this.fast ? 0.6 : 0.3;
      this.shown += diff * alpha;
      this.candidate = null;
      this.candidateFrames = 0;
      return toFreq(this.shown);
    }

    // A different note (or an octave slip): switch only when it persists.
    const octaveSlip = Math.abs(Math.abs(diff) - 12) < 0.5;
    const need = this.fast ? 2 : octaveSlip ? 6 : 3;
    if (this.candidate !== null && Math.abs(median - this.candidate) < 0.6) this.candidateFrames++;
    else {
      this.candidate = median;
      this.candidateFrames = 1;
    }
    if (this.candidateFrames >= need) {
      this.shown = median;
      this.recent = [midi];
      this.candidate = null;
      this.candidateFrames = 0;
    }
    return toFreq(this.shown);
  }
}
