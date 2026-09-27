/**
 * Audio + vibration feedback for barcode scans.
 *
 * - Sound: short tones generated with the Web Audio API (no audio files).
 *   iOS/Safari only allow audio after a user gesture, so call `unlockScanAudio()`
 *   synchronously inside a tap/click handler (e.g. the "start camera" button).
 * - Vibration: `navigator.vibrate` where supported (Android Chrome/Firefox).
 *   Not available on iOS Safari — silently skipped there.
 * - Mute: sound only (vibration stays), remembered in localStorage.
 */

export type ScanFeedbackKind = 'ok' | 'warn' | 'error';

type Tone = { freq: number; ms: number; gapMs?: number; type?: OscillatorType };

/** ok = short high beep; warn (necatalogat) = lower, longer; error = two low buzzes. */
export const FEEDBACK_PATTERNS: Record<
  ScanFeedbackKind,
  { tones: Tone[]; vibrate: number | number[] }
> = {
  ok: { tones: [{ freq: 1760, ms: 90, type: 'square' }], vibrate: 60 },
  warn: { tones: [{ freq: 520, ms: 260, type: 'triangle' }], vibrate: 250 },
  error: {
    tones: [
      { freq: 260, ms: 180, gapMs: 90, type: 'sawtooth' },
      { freq: 220, ms: 220, type: 'sawtooth' },
    ],
    vibrate: [220, 100, 220],
  },
};

const MUTE_KEY = 'depozitbt.scanSoundMuted';

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getAudioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext || w.webkitAudioContext || null;
}

export function isScanSoundMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setScanSoundMuted(muted: boolean): void {
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, '1');
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    /* private mode / storage disabled — keep default */
  }
}

/**
 * Create or resume the AudioContext. MUST be called from a user gesture
 * (click/touchend) the first time, otherwise iOS keeps it suspended.
 * Also plays a 1-sample silent buffer, which is what actually unlocks
 * output on older iOS versions.
 */
export function unlockScanAudio(): void {
  try {
    const Ctor = getAudioCtor();
    if (!Ctor) return;
    if (!ctx || ctx.state === 'closed') ctx = new Ctor();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* audio not available — feedback falls back to visual/vibration */
  }
}

function playTones(tones: Tone[]): void {
  if (!ctx) return; // never unlocked by a gesture -> stay silent
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  let t = ctx.currentTime + 0.01;
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type || 'sine';
    osc.frequency.setValueAtTime(tone.freq, t);
    const dur = tone.ms / 1000;
    // quick attack/release envelope avoids clicks
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.008);
    gain.gain.setValueAtTime(0.25, t + Math.max(0.01, dur - 0.02));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    t += dur + (tone.gapMs ?? 0) / 1000;
  }
}

export function vibrateSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function vibrate(pattern: number | number[]): void {
  if (!vibrateSupported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when not triggered by a gesture — ignore */
  }
}

/** Play the feedback for a scan result. Safe to call anywhere; never throws. */
export function scanFeedback(kind: ScanFeedbackKind): void {
  const p = FEEDBACK_PATTERNS[kind];
  try {
    if (!isScanSoundMuted()) playTones(p.tones);
  } catch {
    /* ignore */
  }
  vibrate(p.vibrate);
}
