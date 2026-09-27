export type ExportColumnType = 'text' | 'number' | 'code' | 'date';

export interface ExportColumn {
  key: string;
  label: string;
  type: ExportColumnType;
}

export type ExportCell = string | number | null;

const SEP = ';';

function quote(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function cell(value: ExportCell, type: ExportColumnType): string {
  if (value == null || value === '') return '';
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  let s = String(value);
  if (type === 'code' && /^\d+$/.test(s) && (s.length > 11 || s.startsWith('0'))) {
    // Excel ar transforma codurile lungi în 5.9E+12 și ar tăia zerourile din față
    return quote(`="${s}"`);
  }
  if (type === 'text' && /^[=+\-@\t\r]/.test(s) && s.length > 1) {
    // protecție la „CSV injection” (formule executate de Excel)
    s = `'${s}`;
  }
  return quote(s);
}

/**
 * CSV pentru Excel (setări regionale RO): UTF-8 cu BOM (diacritice corecte),
 * separator `;`, câmpuri text între ghilimele, rânduri CRLF.
 */
export function toCsv(columns: ExportColumn[], rows: ExportCell[][]): string {
  const lines = [columns.map((c) => quote(c.label)).join(SEP)];
  for (const r of rows) {
    lines.push(columns.map((c, i) => cell(r[i] ?? null, c.type)).join(SEP));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
