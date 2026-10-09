import { describe, expect, it } from 'vitest';
import {
  addScan,
  draftPayload,
  draftProblems,
  draftTotal,
  emptyDraft,
  loadDraft,
  removeLine,
  saveDraft,
  setLineQuantity,
} from './stockExit';

const chair = { id: 7, name: 'SCAUN OPERATIONAL MIRO', mijloc_fix: '000001091229', quantity: 2 };
const desk = { id: 9, name: 'BIROU', mijloc_fix: null, quantity: 5 };

describe('stock exit draft', () => {
  it('adds a new line, then increments the same item up to the stock', () => {
    let d = emptyDraft('Ida');
    let r = addScan(d, '1225859', chair);
    expect(r.result).toBe('added');
    d = r.draft;
    r = addScan(d, '1225859', chair);
    expect(r.result).toBe('incremented');
    expect(r.draft.lines[0].quantity).toBe(2);
    r = addScan(r.draft, '1225859', chair);
    expect(r.result).toBe('max');
    expect(r.draft.lines[0].quantity).toBe(2);
    expect(r.draft.lines).toHaveLength(1);
  });

  it('refuses an item with zero stock', () => {
    const r = addScan(emptyDraft(), 'X', { ...chair, quantity: 0 });
    expect(r.result).toBe('empty');
    expect(r.draft.lines).toHaveLength(0);
  });

  it('clamps quantity to 1..stock, removes lines and totals', () => {
    let d = addScan(emptyDraft(), 'A', chair).draft;
    d = addScan(d, 'B', desk).draft;
    expect(d.lines[0].stock_item_id).toBe(9); // newest first
    d = setLineQuantity(d, 9, 99);
    expect(d.lines[0].quantity).toBe(5);
    d = setLineQuantity(d, 9, 0);
    expect(d.lines[0].quantity).toBe(1);
    d = setLineQuantity(d, 9, 3);
    expect(draftTotal(d)).toBe(4);
    d = removeLine(d, 9);
    expect(d.lines.map((l) => l.stock_item_id)).toEqual([7]);
  });

  it('requires lines and the four handover fields', () => {
    const d = emptyDraft('');
    expect(draftProblems(d)).toEqual([
      'Scanează cel puțin un articol.',
      'Completează „Predat de”.',
      'Completează „Predat către”.',
      'Completează „Solicitant”.',
      'Completează „Destinație”.',
    ]);
    const ok = {
      ...addScan(d, 'A', chair).draft,
      predat_de: 'Ida',
      predat_catre: 'Ion Pop',
      solicitant: '  BT Sucursala Dej ',
      destinatie: 'Sucursala Dej',
    };
    expect(draftProblems(ok)).toEqual([]);
    expect(draftPayload(ok).solicitant).toBe('BT Sucursala Dej');
    const p = draftPayload({ ...ok, observatii: '  ' });
    expect(p).toMatchObject({
      client_key: ok.key,
      predat_catre: 'Ion Pop',
      observatii: '',
      items: [{ stock_item_id: 7, code: 'A', quantity: 1 }],
    });
  });

  it('survives a refresh through storage and ignores garbage', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const d = { ...addScan(emptyDraft('Ida'), 'A', chair).draft, destinatie: 'Dej' };
    saveDraft(storage, d);
    expect(loadDraft(storage)).toEqual(d);
    saveDraft(storage, null);
    expect(loadDraft(storage)).toBeNull();
    mem.set('depozitbt.exitDraft', '{bad');
    expect(loadDraft(storage)).toBeNull();
  });
});

describe('new exit after confirm', () => {
  it('starts with no recipient, destination or lines (only Predat de)', () => {
    const d = emptyDraft('Ida');
    expect(d).toMatchObject({ predat_de: 'Ida', predat_catre: '', destinatie: '', observatii: '', lines: [] });
    expect(emptyDraft('Ida').key).not.toBe(d.key);
  });
});

describe('notă pe articol', () => {
  it('is kept per line and sent only when filled', async () => {
    const { setLineNote } = await import('./stockExit');
    let d = addScan(emptyDraft('Ida'), 'A1', { id: 1, name: 'A', mijloc_fix: null, quantity: 2 }).draft;
    d = addScan(d, 'B1', { id: 2, name: 'B', mijloc_fix: null, quantity: 2 }).draft;
    d = setLineNote(d, 1, '  Scaun Miro fără cod BT ');
    const items = draftPayload({ ...d, predat_catre: 'x', destinatie: 'y' }).items;
    expect(items.find((i) => i.stock_item_id === 1)).toMatchObject({ observatii: 'Scaun Miro fără cod BT' });
    expect(items.find((i) => i.stock_item_id === 2)).not.toHaveProperty('observatii');
  });
});

describe('Predat de implicit', () => {
  it('replaces empty or the old username „Ida”, keeps anything else', async () => {
    const { DEFAULT_PREDAT_DE, withDefaultPredatDe } = await import('./stockExit');
    expect(DEFAULT_PREDAT_DE).toBe('Ida Bereczki');
    expect(withDefaultPredatDe(emptyDraft('')).predat_de).toBe('Ida Bereczki');
    expect(withDefaultPredatDe(emptyDraft('Ida')).predat_de).toBe('Ida Bereczki');
    expect(withDefaultPredatDe(emptyDraft(' ida ')).predat_de).toBe('Ida Bereczki');
    const custom = emptyDraft('Mutantii');
    expect(withDefaultPredatDe(custom)).toBe(custom);
    expect(emptyDraft(DEFAULT_PREDAT_DE)).toMatchObject({ predat_de: 'Ida Bereczki', predat_catre: '', solicitant: '', destinatie: '' });
  });
});
