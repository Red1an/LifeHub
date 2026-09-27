import { getAudioContext } from "./context";

/**
 * High, pure blip for exercises that listen through the mic: it sits above the
 * onset detector's band, so it does not register as a played note.
 */
export function playBlip(accent: boolean, when: number, gain = 1) {
  const audio = getAudioContext();
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = accent ? 3200 : 2600;
  const startAt = audio.currentTime + Math.max(0, when);
  amp.gain.setValueAtTime(0.0001, startAt);
  amp.gain.linearRampToValueAtTime((accent ? 0.35 : 0.22) * gain, startAt + 0.002);
  amp.gain.exponentialRampToValueAtTime(0.0005, startAt + 0.035);
  osc.connect(amp).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + 0.05);
}

/** Short percussive click for the metronome. `when` is seconds from now. */
export function playClick(accent: boolean, when: number, gain = 1) {
  const audio = getAudioContext();
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  const tone = audio.createBiquadFilter();

  tone.type = "bandpass";
  tone.frequency.value = accent ? 2000 : 1300;
  tone.Q.value = 1.4;

  osc.type = "square";
  osc.frequency.value = accent ? 2000 : 1300;

  const startAt = audio.currentTime + Math.max(0, when);
  const level = (accent ? 0.32 : 0.18) * gain;
  amp.gain.setValueAtTime(level, startAt);
  amp.gain.exponentialRampToValueAtTime(0.0005, startAt + 0.045);

  osc.connect(tone).connect(amp).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + 0.06);
}
