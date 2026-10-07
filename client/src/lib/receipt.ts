/**
 * Bon de ieșire (.docx) generat în browser cu pachetul `docx`.
 * Se încarcă doar la cerere (import dinamic) ca să nu mărească pagina principală.
 */
import { formatRoTime } from './time';

export interface ReceiptExit {
  code: string;
  created_at: string;
  predat_de: string;
  predat_catre: string;
  destinatie: string;
  observatii: string | null;
  created_by?: string;
  items: { name: string; mijloc_fix: string | null; barcode: string | null; quantity: number; observatii?: string | null }[];
}

export function receiptFileName(code: string): string {
  return `Bon-iesire-${code.replace(/[^A-Za-z0-9-]/g, '')}.docx`;
}

/** Rândurile tabelului (Nr., Denumire, Mijloc fix, Cod scanat, Cantitate) + total. */
export function receiptRows(exit: ReceiptExit) {
  const rows = exit.items.map((it, i) => [
    String(i + 1),
    it.observatii?.trim() ? `${it.name || ''}\nObs.: ${it.observatii.trim()}` : it.name || '',
    it.mijloc_fix || '—',
    it.barcode || '—',
    String(it.quantity),
  ]);
  const total = exit.items.reduce((a, it) => a + Number(it.quantity || 0), 0);
  return { rows, total };
}

export async function buildReceiptDocx(exit: ReceiptExit): Promise<Blob | Uint8Array> {
  const d = await import('docx');
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = d;

  const FONT = 'Calibri';
  const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, font: FONT, size: opts.size ?? 21, bold: opts.bold, color: opts.color });
  const p = (
    children: InstanceType<typeof TextRun>[],
    opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number } = {}
  ) =>
    new Paragraph({
      children,
      alignment: opts.align,
      spacing: { after: opts.after ?? 60, before: opts.before ?? 0 },
    });

  const border = { style: BorderStyle.SINGLE, size: 4, color: '94A3B8' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

  const widths = [7, 43, 17, 21, 12];
  const cell = (
    text: string,
    i: number,
    o: { bold?: boolean; shade?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}
  ) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      borders,
      shading: o.shade ? { fill: 'E2E8F0', color: 'auto', type: d.ShadingType.CLEAR } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      // al doilea rând („Obs.: …”) = nota articolului, scrisă cursiv
      children: text.split('\n').map((t, k) =>
        k === 0
          ? p([run(t, { bold: o.bold, size: 19 })], { after: 0, align: o.align })
          : p([new TextRun({ text: t, font: FONT, size: 18, italics: true, color: '334155' })], { after: 0, align: o.align })
      ),
    });

  const { rows, total } = receiptRows(exit);
  const right = AlignmentType.RIGHT;
  const center = AlignmentType.CENTER;
  const header = new TableRow({
    tableHeader: true,
    children: ['Nr.', 'Denumire', 'Mijloc fix', 'Cod scanat', 'Cantitate'].map((h, i) =>
      cell(h, i, { bold: true, shade: true, align: i === 0 ? center : i === 4 ? right : undefined })
    ),
  });
  const body = rows.map(
    (r) =>
      new TableRow({
        children: r.map((v, i) => cell(v, i, { align: i === 0 ? center : i === 4 ? right : undefined })),
      })
  );
  const totalRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        borders,
        shading: { fill: 'F1F5F9', color: 'auto', type: d.ShadingType.CLEAR },
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
        children: [p([run('Total bucăți', { bold: true, size: 19 })], { after: 0, align: right })],
      }),
      cell(String(total), 4, { bold: true, align: right }),
    ],
  });

  const info = (label: string, value: string) =>
    p([run(`${label}: `, { bold: true }), run(value || '—')], { after: 40 });

  const sign = (role: string, name: string) =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: noBorders,
      children: [
        p([run(role, { bold: true })], { after: 40 }),
        p([run(`Nume: ${name}`)], { after: 360 }),
        p([run('Semnătura: ______________________')], { after: 0 }),
      ],
    });

  const when = formatRoTime(exit.created_at);
  const doc = new Document({
    creator: 'Depozit BT',
    title: `Bon de ieșire ${exit.code}`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
        children: [
          p([run('DEPOZIT BT', { bold: true, size: 18, color: '047857' })], { after: 120 }),
          p([run('Proces-verbal de predare / Bon de ieșire', { bold: true, size: 30 })], {
            align: center,
            after: 60,
          }),
          p([run(`Nr. ${exit.code}`, { bold: true, size: 24 })], { align: center, after: 40 }),
          p([run(`Data: ${when.slice(0, 10)}   Ora: ${when.slice(11, 16)} (ora României)`)], {
            align: center,
            after: 280,
          }),
          info('Predat de', exit.predat_de),
          info('Predat către', exit.predat_catre),
          info('Destinație', exit.destinatie),
          ...(exit.observatii?.trim()
            ? [
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [
                    new TableRow({
                      children: [
                        new TableCell({
                          borders,
                          shading: { fill: 'FEF3C7', color: 'auto', type: d.ShadingType.CLEAR },
                          margins: { top: 80, bottom: 80, left: 120, right: 120 },
                          children: [p([run('Observații: ', { bold: true }), run(exit.observatii.trim())], { after: 0 })],
                        }),
                      ],
                    }),
                  ],
                }),
              ]
            : []),
          p([run('')], { after: 120 }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body, totalRow] }),
          p([run(`Subsemnații confirmăm predarea și primirea articolelor de mai sus, în total ${total} buc.`)], {
            before: 200,
            after: 480,
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorders,
            rows: [new TableRow({ children: [sign('Am predat', exit.predat_de), sign('Am primit', exit.predat_catre)] })],
          }),
        ],
      },
    ],
  });
  if (typeof window === 'undefined') return Packer.toBuffer(doc) as Promise<Uint8Array>;
  return Packer.toBlob(doc);
}

export async function downloadReceipt(exit: ReceiptExit) {
  const blob = (await buildReceiptDocx(exit)) as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = receiptFileName(exit.code);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
