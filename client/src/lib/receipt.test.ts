import { describe, expect, it } from 'vitest';
import { buildReceiptDocx, receiptFileName, receiptRows } from './receipt';

const exit = {
  code: 'IES-20261007-001',
  created_at: '2026-10-07 09:05:00',
  predat_de: 'Ida',
  predat_catre: 'Ion Pop',
  destinatie: 'Sucursala Dej',
  observatii: null,
  items: [
    { name: 'SCAUN OPERATIONAL MIRO', mijloc_fix: '000001091229', barcode: '1225859', quantity: 2 },
    { name: 'BIROU', mijloc_fix: null, barcode: null, quantity: 1 },
  ],
};

describe('receipt', () => {
  it('builds table rows and total', () => {
    const { rows, total } = receiptRows(exit);
    expect(rows[0]).toEqual(['1', 'SCAUN OPERATIONAL MIRO', '000001091229', '1225859', '2']);
    expect(rows[1]).toEqual(['2', 'BIROU', '—', '—', '1']);
    expect(total).toBe(3);
    expect(receiptFileName(exit.code)).toBe('Bon-iesire-IES-20261007-001.docx');
  });

  it('produces a .docx (zip) with the Romanian title and Romanian time', async () => {
    const buf = (await buildReceiptDocx(exit)) as Uint8Array;
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Proces-verbal de predare / Bon de ieșire');
    expect(xml).toContain('IES-20261007-001');
    expect(xml).toContain('Ora: 12:05'); // 09:05 UTC = 12:05 ora României (EEST)
    expect(xml).toContain('Ion Pop');
  });
});

describe('observații pe bon', () => {
  const ex = {
    code: 'IES-20261007-001',
    created_at: '2026-10-07 12:26:05',
    predat_de: 'Mutantii',
    predat_catre: 'Rares Herman',
    destinatie: 'Traian Mosoiu Corp B',
    observatii: 'Predare parțială',
    items: [
      { name: 'NECUNOSCUT 1214275', mijloc_fix: null, barcode: '1214275', quantity: 1, observatii: 'Scaun Miro fără cod BT' },
      { name: 'SCAUN OPERATIONAL MIRO', mijloc_fix: null, barcode: '1104826', quantity: 1, observatii: null },
    ],
  };
  it('prints the item note under the name', () => {
    const { rows } = receiptRows(ex);
    expect(rows[0][1]).toBe('NECUNOSCUT 1214275\nObs.: Scaun Miro fără cod BT');
    expect(rows[1][1]).toBe('SCAUN OPERATIONAL MIRO');
  });
  it('builds a docx containing both notes', async () => {
    const buf = (await buildReceiptDocx(ex)) as Uint8Array;
    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    expect(xml).toContain('Predare parțială');
    expect(xml).toContain('Obs.: Scaun Miro fără cod BT');
  });
});
