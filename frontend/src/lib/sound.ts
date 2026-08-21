// Tiny Web Audio beep generator — no audio file needed, and it works on
// iOS Safari (unlike navigator.vibrate, which iOS doesn't support at all).
//
// Browsers only allow an AudioContext to actually produce sound once it has
// been created/resumed as a direct result of a user gesture. We can't
// guarantee the shot-timer's setInterval callback counts as one, so
// `unlockAudio` is called from real click handlers (reveal, advance) to
// create/resume the context early; by the time the timer fires later, the
// same context is already unlocked and just needs a new oscillator.

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

export function unlockAudio(): void {
  const ctx = getContext();
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
}

function beep(ctx: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  // Short attack/decay envelope so the tone doesn't click at the edges.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.2, startAt + 0.01);
  gain.gain.linearRampToValueAtTime(0, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

export function playShotAlert(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  // Two quick rising tones — reads as "alert", not a generic notification.
  beep(ctx, 660, now, 0.14);
  beep(ctx, 990, now + 0.16, 0.18);
}
