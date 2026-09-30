import type { AuthUser } from './types';
import { logActivity } from './tickets';

export type SmissCatalogRow = {
  mijloc_fix: string;
  mijloc_fix_orig: string | null;
  clasa: string | null;
  denumire1: string;
  denumire2: string | null;
  description: string | null;
  numar_serial: string | null;
  source_report: string | null;
  /** SMISS column LOCATIE (where the asset was registered). Null until migration 0004. */
  locatie: string | null;
};

export type StockItemRow = Record<string, unknown> & {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  quantity: number;
  mijloc_fix?: string | null;
  mijloc_fix_orig?: string | null;
  name2?: string | null;
  description?: string | null;
  source_from?: string | null;
  is_uncatalogued?: number;
  place?: string | null;
  company?: string | null;
};

/**
 * Length of the zero-padded MIJLOC_FIX_ORIG codes in the SMISS catalog.
 * RAPORT_SMISS_80 (and part of RAPORT_SMISS_01) store ORIG as 12 digits with
 * leading zeros ("000001225859"), while the label / scanner gives "1225859".
 * All 23,916 zero-padded ORIG values in the catalog are exactly 12 characters.
 */
const ORIG_PAD_LENGTH = 12;

/** Whitespace, control characters (CR/LF/TAB, GS1 group separator) and zero-width chars. */
const EDGE_JUNK = /^[\s\u0000-\u001F\u007F\u200B-\u200D\uFEFF]+|[\s\u0000-\u001F\u007F\u200B-\u200D\uFEFF]+$/g;

/** Trim (incl. scanner control chars) + strip leading apostrophe (Excel). */
export function normalizeScanCode(raw: string): string {
  let s = String(raw ?? '').replace(EDGE_JUNK, '');
  if (s.startsWith("'")) s = s.slice(1).replace(EDGE_JUNK, '');
  return s;
}

/**
 * Candidate spellings of a scanned code, most specific first:
 *  - the code as scanned (and upper-case, for codes like "INV00001" / "C213001")
 *  - without leading zeros ("000001225859" -> "1225859")
 *  - digits only: zero-padded to 12 ("1225859" -> "000001225859"), how ORIG is stored
 *  - inventory-number form "000001091229.0000" -> "1091229" (NUMAR_INVENTAR on labels)
 *  - with a leading apostrophe (legacy Excel imports)
 */
export function codeVariants(code: string): string[] {
  const base = normalizeScanCode(code);
  if (!base) return [];
  const list: string[] = [];
  const add = (v: string | null | undefined) => {
    if (v && !list.includes(v)) list.push(v);
  };
  add(base);
  add(base.toUpperCase());
  const stripped = base.replace(/^0+/, '') || '0';
  add(stripped);
  if (/^\d+$/.test(stripped) && stripped.length < ORIG_PAD_LENGTH) {
    add(stripped.padStart(ORIG_PAD_LENGTH, '0'));
  }
  const inv = /^0*(\d+)\.\d{4}$/.exec(base);
  if (inv) {
    add(inv[1]);
    if (inv[1].length < ORIG_PAD_LENGTH) add(inv[1].padStart(ORIG_PAD_LENGTH, '0'));
  }
  for (const v of [...list]) add("'" + v);
  return list;
}

const CATALOG_COLUMNS_BASE = `mijloc_fix, mijloc_fix_orig, clasa, denumire1, denumire2,
                description, numar_serial, source_report`;

/** LOCATIE is added by migrations/0004_smiss_locatie.sql. Lookups still work before it is applied. */
const CATALOG_COLUMNS = `${CATALOG_COLUMNS_BASE}, locatie`;

function missingLocatieColumn(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /no such column/i.test(msg) && /locatie/i.test(msg);
}

async function selectCatalog(
  db: D1Database,
  tail: string,
  binds: unknown[],
  mode: 'all' | 'first'
): Promise<SmissCatalogRow[]> {
  const run = async (columns: string) => {
    const stmt = db.prepare(`SELECT ${columns} ${tail}`).bind(...binds);
    if (mode === 'first') {
      const row = await stmt.first<SmissCatalogRow>();
      return row ? [row] : [];
    }
    const { results } = await stmt.all<SmissCatalogRow>();
    return results || [];
  };
  try {
    return await run(CATALOG_COLUMNS);
  } catch (e) {
    if (!missingLocatieColumn(e)) throw e;
    const rows = await run(CATALOG_COLUMNS_BASE);
    return rows.map((r) => ({ ...r, locatie: null }));
  }
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

export async function lookupCatalog(
  db: D1Database,
  code: string
): Promise<SmissCatalogRow | null> {
  const variants = codeVariants(code);
  if (!variants.length) return null;

  // One indexed query for all spellings (MIJLOC_FIX is the PK, ORIG has idx_smiss_orig).
  const ph = placeholders(variants.length);
  const rows = await selectCatalog(
    db,
    `FROM smiss_catalog
       WHERE mijloc_fix IN (${ph}) OR mijloc_fix_orig IN (${ph})
       LIMIT 50`,
    [...variants, ...variants],
    'all'
  );
  if (rows.length) {
    // Most specific spelling wins; for the same spelling MIJLOC_FIX beats ORIG.
    for (const v of variants) {
      const byFix = rows.find((r) => r.mijloc_fix === v);
      if (byFix) return byFix;
      const byOrig = rows.find((r) => r.mijloc_fix_orig === v);
      if (byOrig) return byOrig;
    }
    return rows[0];
  }

  // Last resort for codes scanned WITH leading zeros: compare with zeros stripped on the
  // DB side (full scan — only reached when nothing above matched).
  const base = normalizeScanCode(code);
  const stripped = base.replace(/^0+/, '') || '0';
  if (stripped && stripped !== base) {
    const [row] = await selectCatalog(
      db,
      `FROM smiss_catalog
         WHERE LTRIM(mijloc_fix, '0') = ? OR LTRIM(IFNULL(mijloc_fix_orig, ''), '0') = ?
         LIMIT 1`,
      [stripped, stripped],
      'first'
    );
    if (row) return row;
  }

  return null;
}

/**
 * Finds the stock line for a scanned code: by barcode, MIJLOC_FIX, MIJLOC_FIX_ORIG or SKU,
 * using the same spellings as the catalog lookup plus the catalog's own codes for that item.
 * `scope` (optional) restricts the search, e.g. to the user's company.
 */
export async function findStockByCode(
  db: D1Database,
  code: string,
  catalog: SmissCatalogRow | null,
  scope: { sql: string; params: unknown[] } = { sql: '1=1', params: [] }
): Promise<StockItemRow | null> {
  const base = normalizeScanCode(code);
  const candidates: string[] = [];
  const add = (v: string | null | undefined) => {
    if (v && !candidates.includes(v)) candidates.push(v);
  };
  // Stock codes are stored normalised (no Excel apostrophe), so those spellings are skipped.
  const addAll = (c: string | null | undefined) => {
    if (c) for (const v of codeVariants(c)) if (!v.startsWith("'")) add(v);
  };
  addAll(code);
  addAll(catalog?.mijloc_fix);
  addAll(catalog?.mijloc_fix_orig);
  if (!candidates.length) return null;
  // D1 allows at most 100 bound parameters per query (4 per candidate + 3 + scope).
  candidates.splice(20);

  const ph = placeholders(candidates.length);
  return db
    .prepare(
      `SELECT * FROM stock_items
       WHERE (barcode IN (${ph}) OR mijloc_fix IN (${ph}) OR mijloc_fix_orig IN (${ph})
              OR sku IN (${ph}))
         AND ${scope.sql}
       ORDER BY CASE WHEN barcode = ? THEN 0
                     WHEN mijloc_fix = ? OR mijloc_fix_orig = ? THEN 1
                     ELSE 2 END,
                id
       LIMIT 1`
    )
    .bind(...candidates, ...candidates, ...candidates, ...candidates, ...scope.params, base, base, base)
    .first<StockItemRow>();
}

/** Fields returned to the intake page for a code that is already in stock. */
export function stockSummary(row: StockItemRow) {
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    name2: row.name2 ?? null,
    description: row.description ?? null,
    quantity: Number(row.quantity || 0),
    company: row.company ?? null,
    place: row.place ?? null,
    mijloc_fix: row.mijloc_fix ?? null,
    mijloc_fix_orig: row.mijloc_fix_orig ?? null,
    is_uncatalogued: Number(row.is_uncatalogued || 0),
  };
}

type ReceiveResult = {
  item: StockItemRow;
  catalogHit: boolean;
  /** true = the code was already in stock; only its quantity was increased. */
  stockHit: boolean;
  quantityBefore: number;
  /** Company the request asked for, when it differs from the existing line's owner (kept). */
  companyRequested?: string | null;
};

function isPlaceholderName(row: StockItemRow): boolean {
  const name = String(row.name || '');
  return name.startsWith('NECUNOSCUT ');
}

/**
 * Code already in stock → only the quantity changes (+ RECEIVE movement).
 * Owner, location and first source of the line are kept (filled in only if empty);
 * the intake source is appended to the comments.
 * If the line was saved manually as unknown and the code is now found in the SMISS
 * catalog, the empty catalog fields and the automatic "NECUNOSCUT …" name are completed.
 */
async function addToExisting(
  db: D1Database,
  user: AuthUser,
  existing: StockItemRow,
  args: {
    code: string;
    qty: number;
    source_from: string;
    place: string | null;
    company: string | null;
    catalog: SmissCatalogRow | null;
  }
): Promise<ReceiveResult> {
  const { code, qty, source_from, place, company, catalog } = args;
  const quantityBefore = Number(existing.quantity || 0);
  const newQty = quantityBefore + qty;
  const commentAppend = `Intrare +${qty} de la: ${source_from}`;
  const prevComments = (existing.comments as string | null) || '';
  const comments = prevComments ? `${prevComments} | ${commentAppend}` : commentAppend;

  const sets = [
    'quantity = ?',
    "source_from = COALESCE(NULLIF(TRIM(source_from), ''), ?)",
    "place = COALESCE(NULLIF(TRIM(place), ''), ?)",
    "company = COALESCE(NULLIF(TRIM(company), ''), ?)",
    'comments = ?',
  ];
  const params: unknown[] = [newQty, source_from, place, company, comments];

  const catalogUpgrade = Boolean(catalog && Number(existing.is_uncatalogued || 0) === 1);
  if (catalog && catalogUpgrade) {
    sets.push(
      'mijloc_fix = COALESCE(mijloc_fix, ?)',
      'mijloc_fix_orig = COALESCE(mijloc_fix_orig, ?)',
      'name2 = COALESCE(name2, ?)',
      'description = COALESCE(description, ?)',
      'is_uncatalogued = 0'
    );
    params.push(
      catalog.mijloc_fix || null,
      catalog.mijloc_fix_orig || null,
      catalog.denumire2 || null,
      catalog.description || null
    );
    if (isPlaceholderName(existing) && catalog.denumire1) {
      sets.push('name = ?');
      params.push(catalog.denumire1);
    }
  }

  await db.batch([
    db
      .prepare(
        `UPDATE stock_items SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(...params, existing.id),
    db
      .prepare(
        `INSERT INTO stock_movements
         (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
         VALUES (?, NULL, ?, ?, 'RECEIVE', ?, ?)`
      )
      .bind(existing.id, code, qty, newQty, user.username),
  ]);

  const existingCompany = String(existing.company ?? '').trim() || null;
  const companyDiffers = Boolean(
    company && existingCompany && company.toLowerCase() !== existingCompany.toLowerCase()
  );

  await logActivity(db, user.username, user.role, 'STOCK_RECEIVE', {
    stock_item_id: existing.id,
    code,
    quantity: qty,
    quantity_after: newQty,
    source_from,
    catalogHit: Boolean(catalog),
    updated: true,
    ...(companyDiffers ? { company_requested: company, company_kept: existingCompany } : {}),
    ...(catalogUpgrade ? { catalog_completed: catalog?.mijloc_fix ?? null } : {}),
  });

  const item = await db
    .prepare(`SELECT * FROM stock_items WHERE id = ?`)
    .bind(existing.id)
    .first<StockItemRow>();
  return {
    item: item!,
    catalogHit: Boolean(catalog),
    stockHit: true,
    quantityBefore,
    ...(companyDiffers ? { companyRequested: company } : {}),
  };
}

export async function receiveStock(
  db: D1Database,
  user: AuthUser,
  body: {
    code: string;
    quantity?: number;
    source_from: string;
    place?: string;
    company?: string;
  }
): Promise<ReceiveResult> {
  const code = normalizeScanCode(body.code);
  if (!code) {
    const err = new Error('Cod obligatoriu') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const source_from = String(body.source_from || '').trim();
  if (!source_from) {
    const err = new Error('Câmpul „de unde a venit” (source_from) este obligatoriu') as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }
  let qty = Number(body.quantity ?? 1);
  if (!Number.isFinite(qty) || qty <= 0) qty = 1;
  qty = Math.floor(qty);

  const catalog = await lookupCatalog(db, code);
  const catalogHit = Boolean(catalog);
  const place = body.place?.trim() || null;
  const existing = await findStockByCode(db, code, catalog);

  if (existing) {
    return addToExisting(db, user, existing, {
      code,
      qty,
      source_from,
      place,
      company: body.company?.trim() || null,
      catalog,
    });
  }

  const mijloc_fix = catalog?.mijloc_fix || null;
  const mijloc_fix_orig = catalog?.mijloc_fix_orig || null;
  const name = catalog?.denumire1 || `NECUNOSCUT ${code}`;
  const name2 = catalog?.denumire2 || null;
  const description = catalog?.description || null;
  const is_uncatalogued = catalogHit ? 0 : 1;
  const sku = `MF-${mijloc_fix || code}`;
  const company = body.company?.trim() || user.company || null;

  const insert = (skuValue: string) =>
    db
      .prepare(
        `INSERT INTO stock_items
         (sku, barcode, name, company, place, quantity, comments,
          mijloc_fix, mijloc_fix_orig, name2, description, source_from, is_uncatalogued)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        skuValue,
        code,
        name,
        company,
        place,
        qty,
        `Intrare de la: ${source_from}`,
        mijloc_fix,
        mijloc_fix_orig,
        name2,
        description,
        source_from,
        is_uncatalogued
      )
      .run();

  let info;
  try {
    info = await insert(sku);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/UNIQUE/i.test(msg)) throw e;
    // Same code saved meanwhile (e.g. two phones) → add to that line instead of failing.
    const again = await findStockByCode(db, code, catalog);
    if (again) {
      return addToExisting(db, user, again, {
        code,
        qty,
        source_from,
        place,
        company: body.company?.trim() || null,
        catalog,
      });
    }
    // SKU collision only — retry with unique suffix
    info = await insert(`MF-${mijloc_fix || code}-${Date.now().toString(36)}`);
  }

  const id = Number(info.meta.last_row_id);
  await db
    .prepare(
      `INSERT INTO stock_movements
       (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
       VALUES (?, NULL, ?, ?, 'RECEIVE', ?, ?)`
    )
    .bind(id, code, qty, qty, user.username)
    .run();

  await logActivity(db, user.username, user.role, 'STOCK_RECEIVE', {
    stock_item_id: id,
    code,
    quantity: qty,
    source_from,
    catalogHit,
    created: true,
    is_uncatalogued,
  });

  const item = await db
    .prepare(`SELECT * FROM stock_items WHERE id = ?`)
    .bind(id)
    .first<StockItemRow>();
  return { item: item!, catalogHit, stockHit: false, quantityBefore: 0 };
}
