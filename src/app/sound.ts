/**
 * The "your move" chime. Made with Web Audio rather than a sound file, so there is nothing to
 * download. Browsers only allow sound after the page has been touched, so the audio is switched on
 * at the first tap or key press; after that the chime can play whenever a turn comes round.
 */
const KEY = "bullrun.sound";
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
}

/** Call once at start-up: the first tap or key press unlocks audio for the rest of the visit. */
export function unlockSoundOnFirstTouch() {
  const unlock = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx ??= new AC();
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      /* no audio on this device */
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** A short rising two-note chime, like a trading-floor bell. Silent if sound is off or locked. */
export function chime(force = false) {
  if (!ctx || (!force && !soundOn())) return;
  if (ctx.state === "suspended") void ctx.resume();
  const t0 = ctx.currentTime + 0.02;
  const notes: [number, number][] = [
    [784, 0], // G5
    [1175, 0.14], // D6
  ];
  for (const [freq, at] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.65);
  }
}
