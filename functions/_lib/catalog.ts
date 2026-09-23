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

/** Trim + strip leading apostrophe (Excel) + optional leading-zero variants. */
export function normalizeScanCode(raw: string): string {
  let s = String(raw ?? '').trim();
  if (s.startsWith("'")) s = s.slice(1).trim();
  return s;
}

export function codeVariants(code: string): string[] {
  const base = normalizeScanCode(code);
  if (!base) return [];
  const set = new Set<string>([base]);
  // without leading zeros (keep at least one digit)
  const stripped = base.replace(/^0+/, '') || '0';
  if (stripped !== base) set.add(stripped);
  // with apostrophe prefix (how ORIG sometimes appears in Excel)
  set.add("'" + base);
  if (stripped !== base) set.add("'" + stripped);
  return [...set];
}

export async function lookupCatalog(
  db: D1Database,
  code: string
): Promise<SmissCatalogRow | null> {
  const variants = codeVariants(code);
  if (!variants.length) return null;

  // Try exact MIJLOC_FIX / ORIG for each variant
  for (const v of variants) {
    const row = await db
      .prepare(
        `SELECT mijloc_fix, mijloc_fix_orig, clasa, denumire1, denumire2,
                description, numar_serial, source_report
         FROM smiss_catalog
         WHERE mijloc_fix = ? OR mijloc_fix_orig = ?
         LIMIT 1`
      )
      .bind(v, v)
      .first<SmissCatalogRow>();
    if (row) return row;
  }

  // Also match ORIG with leading zeros stripped on the DB side (cheap-ish)
  const base = normalizeScanCode(code);
  const stripped = base.replace(/^0+/, '') || '0';
  if (stripped && stripped !== base) {
    const row = await db
      .prepare(
        `SELECT mijloc_fix, mijloc_fix_orig, clasa, denumire1, denumire2,
                description, numar_serial, source_report
         FROM smiss_catalog
         WHERE LTRIM(mijloc_fix, '0') = ? OR LTRIM(IFNULL(mijloc_fix_orig, ''), '0') = ?
         LIMIT 1`
      )
      .bind(stripped, stripped)
      .first<SmissCatalogRow>();
    if (row) return row;
  }

  return null;
}

async function findExistingStock(
  db: D1Database,
  code: string,
  catalog: SmissCatalogRow | null
): Promise<StockItemRow | null> {
  const variants = codeVariants(code);
  const candidates = new Set<string>(variants);
  if (catalog?.mijloc_fix) candidates.add(catalog.mijloc_fix);
  if (catalog?.mijloc_fix_orig) {
    for (const v of codeVariants(catalog.mijloc_fix_orig)) candidates.add(v);
  }

  for (const v of candidates) {
    const row = await db
      .prepare(
        `SELECT * FROM stock_items
         WHERE barcode = ? OR mijloc_fix = ? OR mijloc_fix_orig = ?
         LIMIT 1`
      )
      .bind(v, v, v)
      .first<StockItemRow>();
    if (row) return row;
  }
  return null;
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
): Promise<{ item: StockItemRow; catalogHit: boolean }> {
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
  const existing = await findExistingStock(db, code, catalog);

  if (existing) {
    const newQty = Number(existing.quantity || 0) + qty;
    const place = body.place?.trim() || (existing.place as string | null) || null;
    const company = body.company?.trim() || (existing.company as string | null) || null;
    const commentAppend = `Intrare +${qty} de la: ${source_from}`;
    const prevComments = (existing.comments as string | null) || '';
    const comments = prevComments
      ? `${prevComments} | ${commentAppend}`
      : commentAppend;

    await db
      .prepare(
        `UPDATE stock_items
         SET quantity = ?, source_from = ?, place = COALESCE(?, place),
             company = COALESCE(?, company), comments = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(newQty, source_from, place, company, comments, existing.id)
      .run();

    await db
      .prepare(
        `INSERT INTO stock_movements
         (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
         VALUES (?, NULL, ?, ?, 'RECEIVE', ?, ?)`
      )
      .bind(existing.id, code, qty, newQty, user.username)
      .run();

    await logActivity(db, user.username, user.role, 'STOCK_RECEIVE', {
      stock_item_id: existing.id,
      code,
      quantity: qty,
      quantity_after: newQty,
      source_from,
      catalogHit,
      updated: true,
    });

    const item = await db
      .prepare(`SELECT * FROM stock_items WHERE id = ?`)
      .bind(existing.id)
      .first<StockItemRow>();
    return { item: item!, catalogHit };
  }

  const mijloc_fix = catalog?.mijloc_fix || null;
  const mijloc_fix_orig = catalog?.mijloc_fix_orig || null;
  const name = catalog?.denumire1 || `NECUNOSCUT ${code}`;
  const name2 = catalog?.denumire2 || null;
  const description = catalog?.description || null;
  const is_uncatalogued = catalogHit ? 0 : 1;
  const sku = `MF-${mijloc_fix || code}`;
  const place = body.place?.trim() || null;
  const company = body.company?.trim() || user.company || null;

  let info;
  try {
    info = await db
      .prepare(
        `INSERT INTO stock_items
         (sku, barcode, name, company, place, quantity, comments,
          mijloc_fix, mijloc_fix_orig, name2, description, source_from, is_uncatalogued)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        sku,
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // SKU collision — retry with unique suffix
    if (/UNIQUE/i.test(msg)) {
      const sku2 = `MF-${mijloc_fix || code}-${Date.now().toString(36)}`;
      info = await db
        .prepare(
          `INSERT INTO stock_items
           (sku, barcode, name, company, place, quantity, comments,
            mijloc_fix, mijloc_fix_orig, name2, description, source_from, is_uncatalogued)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          sku2,
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
    } else {
      throw e;
    }
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
  return { item: item!, catalogHit };
}
