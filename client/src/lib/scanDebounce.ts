/**
 * Pure (DOM-free) duplicate-scan filter for continuous camera scanning.
 *
 * The camera decodes the same barcode many times per second while it stays in
 * view. A code is accepted once, then ignored until it has been out of view for
 * `windowMs` ("sliding" window: every repeated sighting pushes the window
 * forward). A different code is accepted immediately.
 *
 * `touch()` records a sighting without accepting it — used while a previous
 * scan is still being saved, so a code held in front of the camera during a
 * slow request is not added twice once the request finishes.
 */
export const DEFAULT_SCAN_DEBOUNCE_MS = 2500;

export interface ScanDebouncer {
  /** true = new scan, process it; false = duplicate, ignore it. */
  accept(code: string, now?: number): boolean;
  /** Refresh the window for the last accepted code (no-op for other codes). */
  touch(code: string, now?: number): void;
  /** Forget the last code (e.g. when a new session starts). */
  reset(): void;
}

export function normalizeScannedCode(raw: unknown): string {
  let s = String(raw ?? '').trim();
  if (s.startsWith("'")) s = s.slice(1).trim();
  return s;
}

export function createScanDebouncer(
  windowMs: number = DEFAULT_SCAN_DEBOUNCE_MS,
  clock: () => number = () => Date.now()
): ScanDebouncer {
  let lastCode = '';
  let lastSeenAt = Number.NEGATIVE_INFINITY;

  return {
    accept(raw, now = clock()) {
      const code = normalizeScannedCode(raw);
      if (!code) return false;
      if (code === lastCode && now - lastSeenAt < windowMs) {
        lastSeenAt = now; // still in view -> keep ignoring
        return false;
      }
      lastCode = code;
      lastSeenAt = now;
      return true;
    },
    touch(raw, now = clock()) {
      const code = normalizeScannedCode(raw);
      if (code && code === lastCode) lastSeenAt = now;
    },
    reset() {
      lastCode = '';
      lastSeenAt = Number.NEGATIVE_INFINITY;
    },
  };
}
