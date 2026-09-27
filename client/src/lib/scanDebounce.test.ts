import { describe, expect, it } from 'vitest';
import { createScanDebouncer, normalizeScannedCode } from './scanDebounce';

describe('createScanDebouncer', () => {
  it('accepts the first read of a code', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('123', 0)).toBe(true);
  });

  it('ignores the same code inside the window', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('123', 0)).toBe(true);
    expect(d.accept('123', 500)).toBe(false);
    expect(d.accept('123', 2499 + 500)).toBe(false); // window slid to 500
  });

  it('accepts the same code again after it was out of view for the window', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('123', 0)).toBe(true);
    expect(d.accept('123', 2500)).toBe(true);
  });

  it('keeps ignoring while the code is continuously in view (sliding window)', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('A', 0)).toBe(true);
    for (let t = 125; t <= 10_000; t += 125) {
      expect(d.accept('A', t)).toBe(false);
    }
    expect(d.accept('A', 10_000 + 2500)).toBe(true);
  });

  it('accepts a different code immediately', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('A', 0)).toBe(true);
    expect(d.accept('B', 100)).toBe(true);
    // A again after B counts as new (A -> B -> A = 3 items)
    expect(d.accept('A', 200)).toBe(true);
  });

  it('touch() extends the window only for the last accepted code', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('A', 0)).toBe(true);
    d.touch('A', 2000); // seen while a save was in flight
    expect(d.accept('A', 4000)).toBe(false);
    d.touch('B', 4100); // unrelated code does not change anything
    expect(d.accept('B', 4200)).toBe(true);
  });

  it('touch() does not "consume" a code that was never accepted', () => {
    const d = createScanDebouncer(2500);
    d.touch('A', 0);
    expect(d.accept('A', 10)).toBe(true);
  });

  it('trims input, strips Excel apostrophe and ignores empty reads', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('   ', 0)).toBe(false);
    expect(d.accept(" '00123 ", 0)).toBe(true);
    expect(d.accept('00123', 100)).toBe(false);
  });

  it('reset() forgets the last code', () => {
    const d = createScanDebouncer(2500);
    expect(d.accept('A', 0)).toBe(true);
    d.reset();
    expect(d.accept('A', 10)).toBe(true);
  });

  it('uses the injected clock when no timestamp is given', () => {
    let now = 1000;
    const d = createScanDebouncer(2500, () => now);
    expect(d.accept('A')).toBe(true);
    now = 2000;
    expect(d.accept('A')).toBe(false);
    now = 5000;
    expect(d.accept('A')).toBe(true);
  });
});

describe('normalizeScannedCode', () => {
  it('handles null/undefined', () => {
    expect(normalizeScannedCode(null)).toBe('');
    expect(normalizeScannedCode(undefined)).toBe('');
  });
});
