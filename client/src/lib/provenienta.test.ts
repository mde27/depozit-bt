import { describe, expect, it } from 'vitest';
import { provenientaLabel } from './labels';

describe('provenientaLabel', () => {
  it('shows the SMISS location as Proveniență', () => {
    expect(provenientaLabel('TE_0_0_0')).toBe('Proveniență: TE_0_0_0');
  });

  it('hides an empty location', () => {
    expect(provenientaLabel(null)).toBeNull();
    expect(provenientaLabel(undefined)).toBeNull();
    expect(provenientaLabel('   ')).toBeNull();
  });

  it('keeps several locations when the source row was duplicated', () => {
    expect(provenientaLabel('DR_0_0_0 / TE_0_0_0')).toBe('Proveniență: DR_0_0_0 / TE_0_0_0');
  });
});
