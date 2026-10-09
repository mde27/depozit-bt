import { describe, expect, it } from 'vitest';
import { descriereLabel } from './descriere';

describe('descriereLabel', () => {
  it('hides empty, "-" and repeats of the name', () => {
    expect(descriereLabel(null, 'X')).toBeNull();
    expect(descriereLabel(' - ', 'X')).toBeNull();
    expect(descriereLabel('SCAUN OPERATIONAL MIRO', 'Scaun operational  miro')).toBeNull();
    expect(descriereLabel('Masa bucătărie', 'NECUNOSCUT 001218', 'masa bucatarie')).toBeNull();
  });
  it('keeps real descriptions', () => {
    expect(descriereLabel('rollbox', 'NECUNOSCUT 011963')).toBe('rollbox');
    expect(descriereLabel('  BT   CAMPUS ', 'Scaun birou Hendrix', 'SCAUN BIROU HENDRIX')).toBe('BT CAMPUS');
  });
});
