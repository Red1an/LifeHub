/* Звуки таймера (WebAudio) и голосовые подсказки (speechSynthesis). Без файлов и разрешений. */
let ctx: AudioContext | null = null;
let sound = true;
let voice = true;

export function setAudio(opts: { sound: boolean; voice: boolean }) {
  sound = opts.sound;
  voice = opts.voice;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.12) {
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
  if (!sound) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    fn();
  } catch {}
}

/** Вызвать из обработчика нажатия, чтобы браузер разрешил звук дальше. */
export function unlockAudio() {
  play(() => tone(1, 0, 0.01, "sine", 0.0001));
}

export const sfx = {
  tick: () => play(() => tone(880, 0, 0.09, "square", 0.05)),
  go: () => play(() => { tone(1320, 0, 0.25, "square", 0.07); }),
  done: () => play(() => { tone(660, 0, 0.12, "triangle"); tone(990, 0.1, 0.2, "triangle"); }),
  side: () => play(() => { tone(740, 0, 0.1, "triangle"); tone(740, 0.15, 0.1, "triangle"); }),
  win: () => play(() => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, "triangle"))),
  tap: () => play(() => tone(520, 0, 0.05, "sine", 0.05)),
};

let ruVoice: SpeechSynthesisVoice | null | undefined;

export function say(text: string) {
  if (!voice || !("speechSynthesis" in window)) return;
  try {
    ruVoice ??= speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("ru")) ?? null;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    if (ruVoice) u.voice = ruVoice;
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}
