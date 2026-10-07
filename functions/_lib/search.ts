/**
 * Căutare text pe server, cu aceeași logică ca în client (client/src/lib/stockSearch.ts):
 * fără majuscule / diacritice, toate cuvintele (ȘI), coduri numerice cu sau fără zerouri în față.
 * Doar interogări parametrizate (LIKE ? ESCAPE '\').
 */

export function normalizeSearch(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTokens(query: unknown): string[] {
  const n = normalizeSearch(query);
  if (!n) return [];
  return n
    .split(' ')
    .slice(0, 8)
    .map((t) => (/^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t));
}

const FOLD: [string, string][] = [
  ['Ș', 's'], ['ș', 's'], ['Ş', 's'], ['ş', 's'],
  ['Ț', 't'], ['ț', 't'], ['Ţ', 't'], ['ţ', 't'],
  ['Ă', 'a'], ['ă', 'a'], ['Â', 'a'], ['â', 'a'],
  ['Î', 'i'], ['î', 'i'],
];

/** Expresie SQL care normalizează o coloană (diacritice românești + LOWER). */
export function sqlFold(column: string): string {
  let e = `COALESCE(${column}, '')`;
  for (const [from, to] of FOLD) e = `REPLACE(${e}, '${from}', '${to}')`;
  return `LOWER(${e})`;
}

function likeEscape(t: string): string {
  return t.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Fragment WHERE: fiecare cuvânt trebuie să apară în cel puțin una din coloane.
 * Returnează null dacă nu e nimic de căutat.
 */
export function searchWhere(
  query: unknown,
  columns: string[]
): { sql: string; params: unknown[] } | null {
  const tokens = searchTokens(query);
  if (!tokens.length || !columns.length) return null;
  const folded = columns.map(sqlFold);
  const params: unknown[] = [];
  const parts = tokens.map((t) => {
    const like = `%${likeEscape(t)}%`;
    return `(${folded
      .map((c) => {
        params.push(like);
        return `${c} LIKE ? ESCAPE '\\'`;
      })
      .join(' OR ')})`;
  });
  return { sql: `(${parts.join(' AND ')})`, params };
}

/** Coloanele stock_items căutate peste tot (alias `s`). */
export const STOCK_SEARCH_COLUMNS = [
  's.name',
  's.name2',
  's.description',
  's.barcode',
  's.sku',
  's.mijloc_fix',
  's.mijloc_fix_orig',
  's.company',
  's.place',
];
