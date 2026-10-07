/**
 * Căutare în stoc — aceeași logică pe toate ecranele.
 * - fără diferență între majuscule / diacritice (ș/ş/s, ț/ţ/t, ă/â/a, î/i)
 * - mai multe cuvinte: toate trebuie să se potrivească (ȘI)
 * - un cod numeric se potrivește cu sau fără zerouri în față
 */
import type { StockItem } from './types';

export function normalizeSearch(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // ă â î ș ț (și ş ţ cu sedilă) → a a i s t
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Împarte căutarea în cuvinte normalizate; codurile numerice pierd zerourile din față. */
export function searchTokens(query: string): string[] {
  const n = normalizeSearch(query);
  if (!n) return [];
  return n.split(' ').map((t) => (/^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t));
}

/** True dacă fiecare cuvânt apare în cel puțin un câmp. */
export function matchesFields(fields: unknown[], query: string | string[]): boolean {
  const tokens = Array.isArray(query) ? query : searchTokens(query);
  if (tokens.length === 0) return true;
  const hay = fields.map(normalizeSearch).filter(Boolean);
  return tokens.every((t) => hay.some((h) => h.includes(t)));
}

export function stockSearchFields(it: Partial<StockItem>): unknown[] {
  return [
    it.name,
    it.name2,
    it.description,
    it.barcode,
    it.sku,
    it.mijloc_fix,
    it.mijloc_fix_orig,
    it.company,
    it.place,
    it.provenienta,
  ];
}

export function matchesStock(it: Partial<StockItem>, query: string | string[]): boolean {
  return matchesFields(stockSearchFields(it), query);
}

export function filterStock<T extends Partial<StockItem>>(items: T[], query: string): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return items;
  return items.filter((it) => matchesStock(it, tokens));
}

export function resultsLabel(n: number): string {
  return n === 1 ? '1 rezultat' : `${n.toLocaleString('ro-RO')} rezultate`;
}
