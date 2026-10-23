/**
 * Comenzi — un rând per articol de tichet. Filtrare, grupare și numărători în pagină.
 * Căutarea folosește aceeași logică ca în rest (fără diacritice / majuscule).
 */
import { matchesFields, normalizeSearch, searchTokens } from './stockSearch';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from './labels';
import { APP_TIME_ZONE } from './dates';
import { parseDbTimestamp } from './time';
import type { ExportColumn, ExportCell } from './csv';

export interface ComandaRow {
  ticket_id: number;
  ticket_code: string;
  status: string;
  client_name: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  line_id: number;
  ordered_qty: number;
  sent_qty?: number;
  delivered_qty?: number;
  name: string;
  barcode: string | null;
  mijloc_fix: string | null;
  sku?: string | null;
  delivery_address: string | null;
  delivery_locality: string | null;
  delivery_county?: string | null;
  recipient: string | null;
}

export type GroupBy = 'status' | 'ticket';

export interface ComenziFilter {
  statuses: string[];
  destination: string;
  query: string;
}

/** Destinația afișată: adresa de livrare + localitatea (fără repetări). */
export function destinationLabel(r: Pick<ComandaRow, 'delivery_address' | 'delivery_locality'>): string {
  const addr = String(r.delivery_address ?? '').trim();
  const loc = String(r.delivery_locality ?? '').trim();
  if (addr && loc && !normalizeSearch(addr).includes(normalizeSearch(loc))) return `${addr}, ${loc}`;
  return addr || loc || '—';
}

/** Cine a cerut: numele clientului (+ utilizatorul, dacă diferă). */
export function requesterLabel(r: Pick<ComandaRow, 'client_name' | 'created_by'>): string {
  const c = String(r.client_name ?? '').trim();
  const u = String(r.created_by ?? '').trim();
  if (!c) return u || '—';
  return u && normalizeSearch(u) !== normalizeSearch(c) ? `${c} (${u})` : c;
}

/** Cod afișat: codul scanat, altfel mijlocul fix. */
export function productCode(r: Pick<ComandaRow, 'barcode' | 'mijloc_fix'>): string {
  return String(r.barcode || r.mijloc_fix || '').trim() || '—';
}

export function statusLabel(s: string): string {
  return TICKET_STATUS_LABELS[s] || s;
}

const dateFmt = new Intl.DateTimeFormat('ro-RO', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data (fără oră) în ora României, ex. 23.10.2026. */
export function roDate(value: string | null | undefined): string {
  const d = parseDbTimestamp(value ?? null);
  return d ? dateFmt.format(d) : '—';
}

export function searchFields(r: ComandaRow): unknown[] {
  return [
    r.ticket_code,
    r.name,
    r.barcode,
    r.mijloc_fix,
    r.sku,
    r.delivery_address,
    r.delivery_locality,
    r.client_name,
    r.created_by,
    r.recipient,
  ];
}

/** Toate filtrele în afară de status (folosit și pentru numărători). */
export function filterBase(rows: ComandaRow[], f: Omit<ComenziFilter, 'statuses'>): ComandaRow[] {
  const tokens = searchTokens(f.query);
  return rows.filter(
    (r) =>
      (!f.destination || destinationLabel(r) === f.destination) &&
      (tokens.length === 0 || matchesFields(searchFields(r), tokens))
  );
}

export function filterComenzi(rows: ComandaRow[], f: ComenziFilter): ComandaRow[] {
  const base = filterBase(rows, f);
  return f.statuses.length ? base.filter((r) => f.statuses.includes(r.status)) : base;
}

/** Tichete și articole per status (în ordinea fluxului; statusurile necunoscute la final). */
export function statusCounts(rows: ComandaRow[]) {
  const map = new Map<string, { tickets: Set<number>; lines: number }>();
  for (const r of rows) {
    const m = map.get(r.status) ?? { tickets: new Set<number>(), lines: 0 };
    m.tickets.add(r.ticket_id);
    m.lines += 1;
    map.set(r.status, m);
  }
  const order = [...TICKET_STATUSES, ...[...map.keys()].filter((s) => !TICKET_STATUSES.includes(s))];
  return order.map((status) => ({
    status,
    label: statusLabel(status),
    tickets: map.get(status)?.tickets.size ?? 0,
    lines: map.get(status)?.lines ?? 0,
  }));
}

/** Destinațiile distincte, sortate (pentru meniul de filtrare). */
export function destinations(rows: ComandaRow[]): string[] {
  const set = new Set(rows.map(destinationLabel).filter((d) => d !== '—'));
  return [...set].sort((a, b) => a.localeCompare(b, 'ro'));
}

export interface ComenziGroup {
  key: string;
  title: string;
  status?: string;
  ticketId?: number;
  rows: ComandaRow[];
  tickets: number;
}

/** Grupare pe status (ordinea fluxului) sau pe tichet (cele mai noi întâi; ordinea primită). */
export function groupComenzi(rows: ComandaRow[], by: GroupBy): ComenziGroup[] {
  const groups = new Map<string, ComenziGroup>();
  for (const r of rows) {
    const key = by === 'status' ? r.status : String(r.ticket_id);
    let g = groups.get(key);
    if (!g) {
      g =
        by === 'status'
          ? { key, title: statusLabel(r.status), status: r.status, rows: [], tickets: 0 }
          : { key, title: r.ticket_code, status: r.status, ticketId: r.ticket_id, rows: [], tickets: 1 };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  const list = [...groups.values()];
  if (by === 'status') {
    for (const g of list) g.tickets = new Set(g.rows.map((r) => r.ticket_id)).size;
    const idx = (s?: string) => {
      const i = TICKET_STATUSES.indexOf(s ?? '');
      return i < 0 ? 99 : i;
    };
    list.sort((a, b) => idx(a.status) - idx(b.status));
  }
  return list;
}

export const COMENZI_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'ticket_code', label: 'Tichet', type: 'code' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'name', label: 'Produs', type: 'text' },
  { key: 'code', label: 'Cod', type: 'code' },
  { key: 'qty', label: 'Cantitate', type: 'number' },
  { key: 'created', label: 'Creat', type: 'date' },
  { key: 'destination', label: 'Destinație', type: 'text' },
  { key: 'requester', label: 'Solicitant / client', type: 'text' },
  { key: 'closed', label: 'Închis', type: 'date' },
];

export function exportRows(rows: ComandaRow[]): ExportCell[][] {
  return rows.map((r) => [
    r.ticket_code,
    statusLabel(r.status),
    r.name,
    productCode(r) === '—' ? '' : productCode(r),
    Number(r.ordered_qty || 0),
    roDate(r.created_at),
    destinationLabel(r) === '—' ? '' : destinationLabel(r),
    requesterLabel(r),
    r.closed_at ? roDate(r.closed_at) : '',
  ]);
}
