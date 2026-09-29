/* Короткие звуки на WebAudio: без файлов и разрешений. */
let ctx: AudioContext | null = null;
let enabled = true;

export const setSound = (on: boolean) => {
  enabled = on;
};

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

function play(fn: () => void) {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    fn();
  } catch {}
}

export const sfx = {
  right: () => play(() => { tone(660, 0, 0.12, "triangle"); tone(990, 0.08, 0.18, "triangle"); }),
  wrong: () => play(() => { tone(220, 0, 0.18, "sawtooth", 0.05); tone(160, 0.1, 0.22, "sawtooth", 0.05); }),
  tap: () => play(() => tone(520, 0, 0.05, "sine", 0.04)),
  win: () => play(() => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.25, "triangle"))),
  hit: () => play(() => { tone(140, 0, 0.12, "square", 0.06); tone(90, 0.05, 0.2, "square", 0.05); }),
};
