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

/* ───── Голос ─────
 * speechSynthesis умеет и «живые» нейросетевые голоса: в Edge — Microsoft Svetlana/Dmitry Online (Natural),
 * в Chrome — Google русский, на телефоне — голоса Google или Samsung. Выбираем лучший из доступных
 * или тот, что выбран в настройках. */
let voiceName = "";
let rate = 1;

export function setVoice(opts: { name?: string; rate?: number }) {
  voiceName = opts.name ?? "";
  rate = opts.rate ?? 1;
}

const score = (v: SpeechSynthesisVoice) =>
  (/natural|neural|online/i.test(v.name) ? 40 : 0) + (/google/i.test(v.name) ? 20 : 0) + (/svetlana|dariya|dmitry|milena|yandex/i.test(v.name) ? 10 : 0) +
  (v.localService ? 0 : 5) + (v.lang.toLowerCase() === "ru-ru" ? 2 : 0);

/** Русские голоса, лучшие — первыми. */
export function ruVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ru")).sort((a, b) => score(b) - score(a));
}

/** Список голосов приходит асинхронно — подписка для настроек. */
export function onVoices(fn: () => void) {
  if (!("speechSynthesis" in window)) return () => {};
  speechSynthesis.addEventListener("voiceschanged", fn);
  return () => speechSynthesis.removeEventListener("voiceschanged", fn);
}

export const isNatural = (v: SpeechSynthesisVoice) => score(v) >= 20;

function pick() {
  const list = ruVoices();
  return list.find((v) => v.name === voiceName) ?? list[0] ?? null;
}

/** Сказать фразу. queue — не перебивать то, что уже говорится. */
export function say(text: string, opts: { queue?: boolean; force?: boolean } = {}) {
  if ((!voice && !opts.force) || !text || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    const v = pick();
    if (v) u.voice = v;
    // Нейросетевые голоса и так звучат естественно, обычные чуть ускоряем.
    u.rate = rate * (v && isNatural(v) ? 1 : 1.05);
    if (!opts.queue) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}

export function hush() {
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch {}
}
