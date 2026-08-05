"use client";

// Short two-note chime synthesized with the Web Audio API — no audio
// file to host/ship. A single shared AudioContext is reused across
// calls (creating one per play would leak and most browsers cap how
// many can exist).
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

function playTone(ctx: AudioContext, frequency: number, startAt: number, duration: number, peakGain: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Plays a short, gentle two-note chime. Fails silently if audio is unavailable (autoplay policy, unsupported browser, etc). */
export function playNotificationChime() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    playTone(ctx, 880, now, 0.14, 0.12);
    playTone(ctx, 1318.5, now + 0.09, 0.16, 0.12);
  } catch {
    // Ignore — notification sound is a nice-to-have, never worth surfacing an error for.
  }
}
