import { describe, expect, it } from 'vitest';
import { filterStock, matchesFields, matchesStock, normalizeSearch, resultsLabel, searchTokens } from './stockSearch';

const chair = {
  id: 1,
  sku: 'SKU-1',
  barcode: '000001225859',
  name: 'SCAUN OPERAȚIONAL MIRO',
  name2: 'Birou etaj 2',
  company: 'BT',
  place: 'Raft Ă3',
  mijloc_fix: '1091229',
  mijloc_fix_orig: '000001225859',
  provenienta: 'TE_0_0_0',
  quantity: 2,
};

describe('normalizeSearch', () => {
  it('drops diacritics (comma and cedilla) and case', () => {
    expect(normalizeSearch('ȘŞșş ȚŢțţ ĂăÂâ Îî')).toBe('ssss tttt aaaa ii');
    expect(normalizeSearch('  Ieșire   Stoc ')).toBe('iesire stoc');
    expect(normalizeSearch(null)).toBe('');
  });
});

describe('searchTokens', () => {
  it('splits words and strips leading zeros from numeric codes', () => {
    expect(searchTokens('Scaun 0001225859')).toEqual(['scaun', '1225859']);
    expect(searchTokens('000')).toEqual(['0']);
    expect(searchTokens('   ')).toEqual([]);
  });
});

describe('matchesStock', () => {
  it('matches without diacritics or with the other spelling', () => {
    expect(matchesStock(chair, 'operational')).toBe(true);
    expect(matchesStock(chair, 'OPERAŢIONAL')).toBe(true);
    expect(matchesStock(chair, 'raft a3')).toBe(true);
  });
  it('matches a code with or without leading zeros, and partially', () => {
    expect(matchesStock(chair, '1225859')).toBe(true);
    expect(matchesStock(chair, '000001225859')).toBe(true);
    expect(matchesStock(chair, '0001091229')).toBe(true);
    expect(matchesStock(chair, '22585')).toBe(true);
  });
  it('requires every word (AND) across any field', () => {
    expect(matchesStock(chair, 'miro bt te_0')).toBe(true);
    expect(matchesStock(chair, 'miro masa')).toBe(false);
  });
  it('empty search matches everything', () => {
    expect(matchesStock(chair, '')).toBe(true);
    expect(filterStock([chair], ' ')).toHaveLength(1);
  });
  it('ignores empty fields', () => {
    expect(matchesFields([null, undefined, ''], 'x')).toBe(false);
  });
});

describe('resultsLabel', () => {
  it('Romanian singular/plural', () => {
    expect(resultsLabel(1)).toBe('1 rezultat');
    expect(resultsLabel(3)).toBe('3 rezultate');
  });
});
