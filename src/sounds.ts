// Short synthesized sounds: bubble pops for the coloring station and a splash for the tank.
// Browsers keep a page silent until it gets a touch or click, so `enableSound` waits for one.

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Turns sound on at the first touch, click or key press. Call once when the page starts. */
export function enableSound() {
  const unlock = () => {
    if (!context) {
      // Media playback rather than the default ringtone-like audio, so iPhones play it on silent too.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
      context = new AudioContext();
      // Starting a sound inside the gesture is what unlocks output on older iOS versions.
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.connect(context.destination);
      source.start();
    }
    if (context.state !== "running") context.resume().catch(() => {});
  };
  for (const type of ["pointerdown", "pointerup", "touchend", "click", "keydown"]) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

/**
 * A bubble pop: a quick rising chirp. `pitch` scales its frequency, `volume` is 0..1, and `delay` is seconds
 * from now. Sounds asked for before the first touch are dropped.
 */
export function pop(pitch = 1, volume = 0.35, delay = 0) {
  if (!context || context.state === "closed") return;
  const t = context.currentTime + delay;
  const tone = context.createOscillator();
  tone.frequency.setValueAtTime(380 * pitch, t);
  tone.frequency.exponentialRampToValueAtTime(1150 * pitch, t + 0.07);
  tone.connect(envelope(context, t, volume, 0.004, 0.09)).connect(context.destination);
  tone.start(t);
  tone.stop(t + 0.1);
}

/** Water splash: a low plunge, a burst of spray, then a few bubbles. */
export function splash() {
  if (!context || context.state === "closed") return;
  const t = context.currentTime;

  const plunge = context.createOscillator();
  plunge.frequency.setValueAtTime(140, t);
  plunge.frequency.exponentialRampToValueAtTime(55, t + 0.18);
  plunge.connect(envelope(context, t, 0.5, 0.01, 0.22)).connect(context.destination);
  plunge.start(t);
  plunge.stop(t + 0.25);

  noise ??= whiteNoise(context);
  const spray = context.createBufferSource();
  spray.buffer = noise;
  const muffle = context.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.Q.value = 0.7;
  muffle.frequency.setValueAtTime(5000, t);
  muffle.frequency.exponentialRampToValueAtTime(400, t + 0.6);
  spray.connect(muffle).connect(envelope(context, t, 0.45, 0.015, 0.7)).connect(context.destination);
  spray.start(t);
  spray.stop(t + 0.75);

  for (let i = 0; i < 5; i++) pop(0.7 + Math.random() * 0.9, 0.12 + Math.random() * 0.1, 0.25 + Math.random() * 0.7);
}

/** A gain that rises to `peak` over `attack` seconds, then fades out by `length` seconds. */
function envelope(ctx: AudioContext, t: number, peak: number, attack: number, length: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  return gain;
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
