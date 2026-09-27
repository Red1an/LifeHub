let ctx: AudioContext | null = null;
let guitarBus: AudioNode | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * Shared tone-shaping for plucked notes: a little body resonance and a gentle
 * top-end roll-off, so raw Karplus-Strong output sounds like an instrument
 * rather than a test tone.
 */
export function getGuitarBus(): AudioNode {
  const audio = getAudioContext();
  if (!guitarBus) {
    const body = audio.createBiquadFilter();
    body.type = "peaking";
    body.frequency.value = 120;
    body.Q.value = 1.1;
    body.gain.value = 4;

    const presence = audio.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2200;
    presence.Q.value = 0.9;
    presence.gain.value = 2.5;

    const tame = audio.createBiquadFilter();
    tame.type = "lowpass";
    tame.frequency.value = 6500;

    const out = audio.createGain();
    out.gain.value = 0.9;

    body.connect(presence).connect(tame).connect(out).connect(audio.destination);
    guitarBus = body;
  }
  return guitarBus;
}

/**
 * Disconnects `from` → `to`, tolerating a link that is already gone. When the
 * mic is switched off the source node is disconnected from everything first,
 * and a component cleaning up its own analyser afterwards would otherwise
 * throw InvalidAccessError.
 */
export function disconnectSafely(from: AudioNode, to?: AudioNode) {
  try {
    if (to) from.disconnect(to);
    else from.disconnect();
  } catch {
    // already disconnected
  }
}

/** Call from a user gesture before scheduling audio (browser autoplay rules). */
export async function unlockAudio(): Promise<void> {
  const audio = getAudioContext();
  if (audio.state === "suspended") await audio.resume();
}
