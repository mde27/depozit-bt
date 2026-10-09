import { describe, expect, it } from 'vitest';
import { buildReceiptDocx, imageInfo, receiptFileName, receiptRows } from './receipt';
import { COMPANY, companyHasPlaceholders } from './company';

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

describe('antet, solicitant, semnături', () => {
  const PNG1 = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0)
  );
  const docXml = async (buf: Uint8Array) => {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf);
    return { xml: await zip.file('word/document.xml')!.async('string'), media: Object.keys(zip.files).filter((f) => f.startsWith('word/media/')) };
  };
  it('reads PNG size and rejects non-images (e.g. the HTML fallback page)', () => {
    expect(imageInfo(PNG1)).toMatchObject({ type: 'png', width: 1, height: 1 });
    expect(imageInfo(new TextEncoder().encode('<!doctype html><html>'))).toBeNull();
  });
  it('prints company header, Solicitant and both signature blocks; no images when missing', async () => {
    const company = { ...COMPANY, name: 'FIRMA TEST SRL', cui: 'RO123', regCom: 'J12/1/2020', address: 'Str. A 1', phone: '0700', email: 'a@b.ro' };
    const { xml, media } = await docXml((await buildReceiptDocx({ ...exit, solicitant: 'Maria BT' }, { company })) as Uint8Array);
    for (const t of ['FIRMA TEST SRL', 'CUI: RO123', 'Reg. Com.: J12/1/2020', 'Str. A 1', 'Tel.: 0700', 'Solicitant: ', 'Maria BT', 'Predat de', 'Primit de', 'Semnătură / L.S.:', 'Semnătură:'])
      expect(xml).toContain(t);
    expect(media).toHaveLength(0);
  });
  it('prints the real MUTANȚII header, without an e-mail line', async () => {
    const { xml } = await docXml((await buildReceiptDocx(exit)) as Uint8Array);
    for (const t of ['ECHIPA MUTANȚII', 'SC MUTANTII SRL', 'CUI: RO21947113', 'Reg. Com.: J2007002736124', 'Str. Câmpului 312, Cluj-Napoca', 'Tel.: 0727 240356 / 0746 089696', 'Web: mutantii.ro'])
      expect(xml).toContain(t);
    expect(xml).not.toContain('E-mail');
    expect(xml).not.toContain('[');
  });
  it('older exits without Solicitant show —', async () => {
    const { xml } = await docXml((await buildReceiptDocx({ ...exit })) as Uint8Array);
    expect(xml).toMatch(/Solicitant: <\/w:t>.*?—/);
  });
  it('embeds logo and stamp when given', async () => {
    const img = imageInfo(PNG1)!;
    const { media } = await docXml((await buildReceiptDocx(exit, { logo: img, stamp: img })) as Uint8Array);
    expect(media.length).toBe(2);
  });
  it('company placeholders are detected', () => {
    expect(companyHasPlaceholders(COMPANY)).toBe(false);
    expect(companyHasPlaceholders({ ...COMPANY, email: '[x@y.ro]' })).toBe(true);
    expect(companyHasPlaceholders({ ...COMPANY, name: 'X', cui: 'X', regCom: 'X', address: 'X', phone: '', email: '' })).toBe(false);
  });
});
