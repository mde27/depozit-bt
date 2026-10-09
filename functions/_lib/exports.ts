import type { AuthUser, Role } from './types';
import {
  NO_COMPANY_MESSAGE,
  isCompanyScoped,
  missingCompany,
  normalizeCompany,
  stockCompanyScope,
} from './company';
import { STOCK_SEARCH_COLUMNS, searchWhere } from './search';
import { formatLocal, isIsoDate, localDayStartUtc, todayLocal } from './time';

export const EXPORT_LIMIT = 50000;

export type ExportKind = 'stock' | 'movements' | 'tickets' | 'exits';
type ColType = 'text' | 'number' | 'code' | 'date';
type Col = { key: string; label: string; type: ColType };
type Cell = string | number | null;

export interface ExportResult {
  kind: ExportKind;
  columns: Col[];
  rows: Cell[][];
  total: number;
  truncated: boolean;
  limit: number;
  filename: string;
}

/** Valoare specială pentru filtrul de firmă: articole / useri fără firmă. */
export const NO_COMPANY_FILTER = '__none__';

export const REASON_LABELS: Record<string, string> = {
  INITIAL: 'Stoc inițial',
  RECEIVE: 'Intrare stoc',
  SEND_OUT: 'Trimitere (ieșire)',
  RECEIVE_BACK: 'Retur primit',
  MANUAL_EDIT: 'Corecție manuală (editare)',
  ISSUE: 'Ieșire stoc',
};

export const STATUS_LABELS: Record<string, string> = {
  ORDERED: 'Comandat',
  NEEDS_FIX: 'De corectat',
  SENT: 'Trimis',
  DELIVERED: 'Livrat',
  RETURNING: 'Retur în curs',
  CLOSED: 'Închis',
};

/** Acțiuni din ticket_history care schimbă statusul. */
const STATUS_ACTIONS = [
  'ORDERED',
  'RESUBMIT',
  'SEND',
  'TRIMITERE',
  'SEND_WITH_COMMENT',
  'DELIVER',
  'RETURN_OUT',
  'RECEIVE_BACK',
  'CLOSED',
];

/**
 * Cine ce poate exporta:
 * - admin / user2: tot
 * - user1: stoc + mișcări doar pentru firma proprie, cereri doar proprii
 * - user3 / user4: doar cereri (API-ul de tichete le arată deja toate tichetele;
 *   stocul nu ține de rolul lor)
 */
export function allowedExportKinds(role: Role): ExportKind[] {
  if (role === 'admin' || role === 'user2') return ['stock', 'movements', 'tickets', 'exits'];
  if (role === 'user1') {
    return ['stock', 'movements', 'tickets'];
  }
  return ['tickets'];
}

function httpError(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function assertKind(user: AuthUser, kind: ExportKind) {
  if (!allowedExportKinds(user.role).includes(kind)) {
    httpError('Acces interzis la acest tip de export', 403);
  }
  if (kind !== 'tickets' && missingCompany(user)) httpError(NO_COMPANY_MESSAGE, 403);
}

class Where {
  parts: string[] = [];
  params: unknown[] = [];
  add(sql: string, ...params: unknown[]) {
    this.parts.push(sql);
    this.params.push(...params);
  }
  get sql() {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

/** Filtru firmă: user1 forțat pe firma proprie; ceilalți opțional. */
function addCompanyFilter(w: Where, user: AuthUser, column: string, requested: string | null) {
  if (isCompanyScoped(user)) {
    const scope = stockCompanyScope(user, column);
    w.add(scope.sql, ...scope.params);
    return;
  }
  if (!requested) return;
  if (requested === NO_COMPANY_FILTER) {
    w.add(`(${column} IS NULL OR TRIM(${column}) = '')`);
  } else {
    w.add(`LOWER(TRIM(${column})) = LOWER(TRIM(?))`, requested);
  }
}

/** Perioadă inclusivă pe zile locale (Europe/Bucharest); coloana e UTC. */
function addPeriodFilter(w: Where, column: string, q: URLSearchParams) {
  const from = q.get('from')?.trim() || '';
  const to = q.get('to')?.trim() || '';
  if (from && !isIsoDate(from)) httpError('Data „de la” invalidă (format AAAA-LL-ZZ)');
  if (to && !isIsoDate(to)) httpError('Data „până la” invalidă (format AAAA-LL-ZZ)');
  if (from && to && from > to) httpError('Data „de la” este după data „până la”');
  if (from) w.add(`${column} >= ?`, localDayStartUtc(from));
  if (to) w.add(`${column} < ?`, localDayStartUtc(to, 1));
  return { from, to };
}

function periodSuffix(from: string, to: string) {
  if (from && to) return from === to ? from : `${from}_${to}`;
  if (from) return `de-la-${from}`;
  if (to) return `pana-la-${to}`;
  return todayLocal();
}

async function runLimited(db: D1Database, sql: string, params: unknown[]) {
  const { results } = await db
    .prepare(`${sql} LIMIT ${EXPORT_LIMIT + 1}`)
    .bind(...params)
    .all<Record<string, unknown>>();
  const rows = results || [];
  const truncated = rows.length > EXPORT_LIMIT;
  return { rows: truncated ? rows.slice(0, EXPORT_LIMIT) : rows, truncated };
}

async function countRows(db: D1Database, fromSql: string, params: unknown[]) {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n ${fromSql}`)
    .bind(...params)
    .first<{ n: number }>();
  return Number(r?.n || 0);
}

function build(
  kind: ExportKind,
  columns: Col[],
  raw: Record<string, unknown>[],
  map: (r: Record<string, unknown>) => Cell[]
) {
  return { kind, columns, rows: raw.map(map) };
}

const s = (v: unknown): Cell => (v == null ? null : String(v));
const n = (v: unknown): Cell => (v == null ? 0 : Number(v));

// ---------------------------------------------------------------- Căutare

/** Proveniența (LOCATIE din catalog), dacă tabelul / coloana există. */
let hasCatalogLocatie: boolean | null = null;
async function catalogHasLocatie(db: D1Database): Promise<boolean> {
  if (hasCatalogLocatie !== null) return hasCatalogLocatie;
  try {
    await db.prepare(`SELECT locatie FROM smiss_catalog LIMIT 0`).all();
    hasCatalogLocatie = true;
  } catch {
    hasCatalogLocatie = false;
  }
  return hasCatalogLocatie;
}

async function stockSearchWhere(db: D1Database, query: unknown, extra: string[] = []) {
  const cols = [...STOCK_SEARCH_COLUMNS, ...extra];
  if (await catalogHasLocatie(db)) {
    cols.push(`(SELECT GROUP_CONCAT(c.locatie, ' ') FROM smiss_catalog c WHERE c.mijloc_fix = s.mijloc_fix)`);
  }
  return searchWhere(query, cols);
}

// ---------------------------------------------------------------- Stoc curent

export async function exportStock(
  db: D1Database,
  user: AuthUser,
  q: URLSearchParams
): Promise<ExportResult> {
  assertKind(user, 'stock');
  const w = new Where();
  addCompanyFilter(w, user, 's.company', normalizeCompany(q.get('company')));
  const place = normalizeCompany(q.get('place'));
  if (place === NO_COMPANY_FILTER) w.add(`(s.place IS NULL OR TRIM(s.place) = '')`);
  else if (place) w.add(`TRIM(s.place) = ?`, place);
  if (q.get('uncatalogued') === '1') w.add(`s.is_uncatalogued = 1`);
  if (q.get('in_stock') === '1') w.add(`s.quantity > 0`);
  const search = await stockSearchWhere(db, q.get('q'));
  if (search) w.add(search.sql, ...search.params);

  const from = `FROM stock_items s ${w.sql}`;
  const { rows, truncated } = await runLimited(
    db,
    `SELECT s.sku, s.barcode, s.mijloc_fix, s.mijloc_fix_orig, s.name, s.name2, NULLIF(TRIM(s.description), '-') AS description,
            s.company, s.place, s.quantity, s.source_from, s.is_uncatalogued, s.updated_at
     ${from} ORDER BY s.name COLLATE NOCASE, s.sku`,
    w.params
  );
  const total = truncated ? await countRows(db, from, w.params) : rows.length;
  const columns: Col[] = [
    { key: 'sku', label: 'SKU', type: 'code' },
    { key: 'barcode', label: 'Barcode', type: 'code' },
    { key: 'mijloc_fix', label: 'MIJLOC_FIX', type: 'code' },
    { key: 'mijloc_fix_orig', label: 'MIJLOC_FIX_ORIG', type: 'code' },
    { key: 'name', label: 'Denumire', type: 'text' },
    { key: 'name2', label: 'Denumire 2', type: 'text' },
    { key: 'description', label: 'Descriere', type: 'text' },
    { key: 'company', label: 'Firmă', type: 'text' },
    { key: 'place', label: 'Locație', type: 'text' },
    { key: 'quantity', label: 'Cantitate', type: 'number' },
    { key: 'source_from', label: 'Sursă', type: 'text' },
    { key: 'is_uncatalogued', label: 'Necunoscut', type: 'text' },
    { key: 'updated_at', label: 'Actualizat', type: 'date' },
  ];
  return {
    ...build('stock', columns, rows, (r) => [
      s(r.sku),
      s(r.barcode),
      s(r.mijloc_fix),
      s(r.mijloc_fix_orig),
      s(r.name),
      s(r.name2),
      s(r.description),
      s(r.company),
      s(r.place),
      n(r.quantity),
      s(r.source_from),
      Number(r.is_uncatalogued) ? 'DA' : 'NU',
      formatLocal(r.updated_at),
    ]),
    total,
    truncated,
    limit: EXPORT_LIMIT,
    filename: `stoc_${todayLocal()}.csv`,
  };
}

// ---------------------------------------------------------------- Mișcări stoc

export async function exportMovements(
  db: D1Database,
  user: AuthUser,
  q: URLSearchParams
): Promise<ExportResult> {
  assertKind(user, 'movements');
  const w = new Where();
  addCompanyFilter(w, user, 's.company', normalizeCompany(q.get('company')));
  const { from, to } = addPeriodFilter(w, 'm.created_at', q);
  const reason = q.get('reason')?.trim();
  if (reason) w.add(`m.reason = ?`, reason);
  const search = await stockSearchWhere(db, q.get('q'), ['m.barcode_scanned']);
  if (search) w.add(search.sql, ...search.params);

  const fromSql = `FROM stock_movements m
     JOIN stock_items s ON s.id = m.stock_item_id
     LEFT JOIN tickets t ON t.id = m.ticket_id
     LEFT JOIN stock_exits e ON e.id = m.stock_exit_id
     ${w.sql}`;
  // Clienții (user1) nu văd bonurile de ieșire — doar mișcarea.
  const ref = isCompanyScoped(user) ? 't.ticket_code' : 'COALESCE(t.ticket_code, e.code)';
  const { rows, truncated } = await runLimited(
    db,
    `SELECT m.created_at, s.sku, s.barcode, s.name, NULLIF(TRIM(s.description), '-') AS description, s.company, m.delta, m.reason,
            m.quantity_after, ${ref} AS ticket_code, m.created_by
     ${fromSql} ORDER BY m.created_at, m.id`,
    w.params
  );
  const total = truncated ? await countRows(db, fromSql, w.params) : rows.length;
  const columns: Col[] = [
    { key: 'created_at', label: 'Data', type: 'date' },
    { key: 'sku', label: 'SKU', type: 'code' },
    { key: 'barcode', label: 'Barcode', type: 'code' },
    { key: 'name', label: 'Denumire', type: 'text' },
    { key: 'description', label: 'Descriere', type: 'text' },
    { key: 'company', label: 'Firmă', type: 'text' },
    { key: 'delta', label: 'Delta', type: 'number' },
    { key: 'reason', label: 'Motiv', type: 'text' },
    { key: 'quantity_after', label: 'Cantitate după', type: 'number' },
    { key: 'ticket_code', label: 'Cerere / Bon ieșire', type: 'text' },
    { key: 'created_by', label: 'Utilizator', type: 'text' },
  ];
  return {
    ...build('movements', columns, rows, (r) => [
      formatLocal(r.created_at),
      s(r.sku),
      s(r.barcode),
      s(r.name),
      s(r.description),
      s(r.company),
      n(r.delta),
      REASON_LABELS[String(r.reason)] || s(r.reason),
      n(r.quantity_after),
      s(r.ticket_code),
      s(r.created_by),
    ]),
    total,
    truncated,
    limit: EXPORT_LIMIT,
    filename: `miscari-stoc_${periodSuffix(from, to)}.csv`,
  };
}

// ---------------------------------------------------------------- Ieșiri stoc

/** Ieșiri stoc: un rând pe articol ieșit (admin / user2). */
export async function exportExits(
  db: D1Database,
  user: AuthUser,
  q: URLSearchParams
): Promise<ExportResult> {
  assertKind(user, 'exits');
  const w = new Where();
  const { from, to } = addPeriodFilter(w, 'e.created_at', q);
  const fromSql = `FROM stock_exit_items i JOIN stock_exits e ON e.id = i.exit_id
     LEFT JOIN stock_items s ON s.id = i.stock_item_id ${w.sql}`;
  const { rows, truncated } = await runLimited(
    db,
    `SELECT e.created_at, e.code, e.predat_de, e.predat_catre, e.solicitant, e.destinatie, e.observatii,
            i.name, NULLIF(TRIM(s.description), '-') AS description, i.observatii AS obs_articol,
            i.mijloc_fix, i.barcode, i.quantity, e.created_by
     ${fromSql} ORDER BY e.id, i.id`,
    w.params
  );
  const total = truncated ? await countRows(db, fromSql, w.params) : rows.length;
  const columns: Col[] = [
    { key: 'created_at', label: 'Data', type: 'date' },
    { key: 'code', label: 'Bon ieșire', type: 'text' },
    { key: 'predat_de', label: 'Predat de', type: 'text' },
    { key: 'predat_catre', label: 'Predat către', type: 'text' },
    { key: 'solicitant', label: 'Solicitant', type: 'text' },
    { key: 'destinatie', label: 'Destinație', type: 'text' },
    { key: 'observatii', label: 'Observații', type: 'text' },
    { key: 'name', label: 'Denumire', type: 'text' },
    { key: 'description', label: 'Descriere', type: 'text' },
    { key: 'obs_articol', label: 'Obs. articol', type: 'text' },
    { key: 'mijloc_fix', label: 'Mijloc fix', type: 'code' },
    { key: 'barcode', label: 'Cod scanat', type: 'code' },
    { key: 'quantity', label: 'Cantitate', type: 'number' },
    { key: 'created_by', label: 'Utilizator', type: 'text' },
  ];
  return {
    ...build('exits', columns, rows, (r) => [
      formatLocal(r.created_at),
      s(r.code),
      s(r.predat_de),
      s(r.predat_catre),
      s(r.solicitant),
      s(r.destinatie),
      s(r.observatii),
      s(r.name),
      s(r.description),
      s(r.obs_articol),
      s(r.mijloc_fix),
      s(r.barcode),
      n(r.quantity),
      s(r.created_by),
    ]),
    total,
    truncated,
    limit: EXPORT_LIMIT,
    filename: `iesiri-stoc_${periodSuffix(from, to)}.csv`,
  };
}

// ---------------------------------------------------------------- Cereri

/**
 * Firma unei cereri = firma utilizatorului care a creat-o (users.company).
 * Articolele unei cereri pot fi (istoric) din firme diferite; varianta detaliată
 * arată separat și firma fiecărui articol.
 */
export async function exportTickets(
  db: D1Database,
  user: AuthUser,
  q: URLSearchParams
): Promise<ExportResult> {
  assertKind(user, 'tickets');
  const detailed = q.get('variant') === 'detailed';
  const w = new Where();
  if (user.role === 'user1') {
    w.add(`t.created_by = ?`, user.username);
  } else {
    const company = normalizeCompany(q.get('company'));
    if (company === NO_COMPANY_FILTER) w.add(`(u.company IS NULL OR TRIM(u.company) = '')`);
    else if (company) w.add(`LOWER(TRIM(u.company)) = LOWER(TRIM(?))`, company);
    const creator = q.get('created_by')?.trim();
    if (creator) w.add(`t.created_by = ?`, creator);
  }
  const status = q.get('status')?.trim();
  if (status) w.add(`t.status = ?`, status);
  const { from, to } = addPeriodFilter(w, 't.created_at', q);
  const suffix = periodSuffix(from, to);

  if (!detailed) {
    const fromSql = `FROM tickets t
       LEFT JOIN users u ON u.username = t.created_by
       LEFT JOIN (
         SELECT ticket_id, COUNT(*) AS lines, SUM(ordered_qty) AS ordered,
                SUM(sent_qty) AS sent, SUM(delivered_qty) AS delivered,
                SUM(return_out_qty) AS return_out, SUM(received_back_qty) AS received_back
         FROM ticket_items GROUP BY ticket_id
       ) a ON a.ticket_id = t.id
       ${w.sql}`;
    const { rows, truncated } = await runLimited(
      db,
      `SELECT t.ticket_code, t.client_name, t.status, t.created_by, u.company,
              t.created_at, t.updated_at,
              (SELECT MAX(h.at) FROM ticket_history h
                WHERE h.ticket_id = t.id
                  AND h.action IN (${STATUS_ACTIONS.map(() => '?').join(',')})) AS last_status_at,
              a.lines, a.ordered, a.sent, a.delivered, a.return_out, a.received_back
       ${fromSql} ORDER BY t.created_at, t.id`,
      [...STATUS_ACTIONS, ...w.params]
    );
    const total = truncated ? await countRows(db, fromSql, w.params) : rows.length;
    const columns: Col[] = [
      { key: 'ticket_code', label: 'Cerere', type: 'text' },
      { key: 'client_name', label: 'Client', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'created_by', label: 'Creat de', type: 'text' },
      { key: 'company', label: 'Firmă', type: 'text' },
      { key: 'created_at', label: 'Creată la', type: 'date' },
      { key: 'last_status_at', label: 'Ultima schimbare status', type: 'date' },
      { key: 'updated_at', label: 'Ultima actualizare', type: 'date' },
      { key: 'lines', label: 'Nr. linii', type: 'number' },
      { key: 'ordered', label: 'Total comandat', type: 'number' },
      { key: 'sent', label: 'Total trimis', type: 'number' },
      { key: 'delivered', label: 'Total livrat', type: 'number' },
      { key: 'return_out', label: 'Total retur predat', type: 'number' },
      { key: 'received_back', label: 'Total retur primit', type: 'number' },
    ];
    return {
      ...build('tickets', columns, rows, (r) => [
        s(r.ticket_code),
        s(r.client_name),
        STATUS_LABELS[String(r.status)] || s(r.status),
        s(r.created_by),
        s(r.company),
        formatLocal(r.created_at),
        formatLocal(r.last_status_at),
        formatLocal(r.updated_at),
        n(r.lines),
        n(r.ordered),
        n(r.sent),
        n(r.delivered),
        n(r.return_out),
        n(r.received_back),
      ]),
      total,
      truncated,
      limit: EXPORT_LIMIT,
      filename: `cereri-sumar_${suffix}.csv`,
    };
  }

  const fromSql = `FROM ticket_items ti
     JOIN tickets t ON t.id = ti.ticket_id
     LEFT JOIN stock_items s ON s.id = ti.stock_item_id
     LEFT JOIN users u ON u.username = t.created_by
     ${w.sql}`;
  const { rows, truncated } = await runLimited(
    db,
    `SELECT t.ticket_code, t.client_name, t.status, t.created_by, u.company, t.created_at,
            s.sku, s.barcode, s.name, NULLIF(TRIM(s.description), '-') AS description, s.company AS item_company,
            ti.ordered_qty, ti.sent_qty, ti.delivered_qty, ti.return_out_qty, ti.received_back_qty
     ${fromSql} ORDER BY t.created_at, t.id, ti.id`,
    w.params
  );
  const total = truncated ? await countRows(db, fromSql, w.params) : rows.length;
  const columns: Col[] = [
    { key: 'ticket_code', label: 'Cerere', type: 'text' },
    { key: 'client_name', label: 'Client', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'created_by', label: 'Creat de', type: 'text' },
    { key: 'company', label: 'Firmă cerere', type: 'text' },
    { key: 'created_at', label: 'Creată la', type: 'date' },
    { key: 'sku', label: 'SKU', type: 'code' },
    { key: 'barcode', label: 'Barcode', type: 'code' },
    { key: 'name', label: 'Denumire', type: 'text' },
    { key: 'description', label: 'Descriere', type: 'text' },
    { key: 'item_company', label: 'Firmă articol', type: 'text' },
    { key: 'ordered_qty', label: 'Comandat', type: 'number' },
    { key: 'sent_qty', label: 'Trimis', type: 'number' },
    { key: 'delivered_qty', label: 'Livrat', type: 'number' },
    { key: 'return_out_qty', label: 'Retur predat', type: 'number' },
    { key: 'received_back_qty', label: 'Retur primit', type: 'number' },
  ];
  return {
    ...build('tickets', columns, rows, (r) => [
      s(r.ticket_code),
      s(r.client_name),
      STATUS_LABELS[String(r.status)] || s(r.status),
      s(r.created_by),
      s(r.company),
      formatLocal(r.created_at),
      s(r.sku),
      s(r.barcode),
      s(r.name),
      s(r.description),
      s(r.item_company),
      n(r.ordered_qty),
      n(r.sent_qty),
      n(r.delivered_qty),
      n(r.return_out_qty),
      n(r.received_back_qty),
    ]),
    total,
    truncated,
    limit: EXPORT_LIMIT,
    filename: `cereri-detaliat_${suffix}.csv`,
  };
}

// ---------------------------------------------------------------- Opțiuni filtre

export async function exportOptions(db: D1Database, user: AuthUser) {
  const kinds = allowedExportKinds(user.role);
  const scope = stockCompanyScope(user);
  const scoped = isCompanyScoped(user);

  let companies: string[] = [];
  if (scoped) {
    const own = normalizeCompany(user.company);
    companies = own ? [own] : [];
  } else {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT TRIM(company) AS name FROM (
           SELECT company FROM users UNION ALL SELECT company FROM stock_items
         ) WHERE company IS NOT NULL AND TRIM(company) != ''`
      )
      .all<{ name: string }>();
    const byKey = new Map<string, string>();
    for (const r of results || []) {
      const k = r.name.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, r.name);
    }
    companies = [...byKey.values()].sort((a, b) => a.localeCompare(b, 'ro'));
  }

  let places: string[] = [];
  if (kinds.includes('stock') && !missingCompany(user)) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT TRIM(place) AS place FROM stock_items
         WHERE place IS NOT NULL AND TRIM(place) != '' AND ${scope.sql}
         ORDER BY place COLLATE NOCASE`
      )
      .bind(...scope.params)
      .all<{ place: string }>();
    places = (results || []).map((r) => r.place);
  }

  const reasonSet = new Set(Object.keys(REASON_LABELS));
  if (kinds.includes('movements')) {
    const { results } = await db
      .prepare(`SELECT DISTINCT reason FROM stock_movements`)
      .all<{ reason: string }>();
    for (const r of results || []) reasonSet.add(r.reason);
  }
  const reasons = [...reasonSet].map((code) => ({ code, label: REASON_LABELS[code] || code }));

  let creators: string[] = [];
  if (user.role === 'user1') {
    creators = [user.username];
  } else {
    const { results } = await db
      .prepare(`SELECT DISTINCT created_by FROM tickets ORDER BY created_by COLLATE NOCASE`)
      .all<{ created_by: string }>();
    creators = (results || []).map((r) => r.created_by);
  }

  return {
    kinds,
    companyLocked: scoped ? companies[0] ?? null : null,
    companies,
    places,
    reasons,
    statuses: Object.entries(STATUS_LABELS).map(([code, label]) => ({ code, label })),
    creators,
    limit: EXPORT_LIMIT,
    today: todayLocal(),
  };
}
