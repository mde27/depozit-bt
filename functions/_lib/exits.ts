import type { AuthUser } from './types';
import { findStockByCode, lookupCatalog, normalizeScanCode, type StockItemRow } from './catalog';
import { todayLocal } from './time';

/** Ieșire stoc (bon de ieșire): doar Magazie (user2) și Admin. */
export const EXIT_FORBIDDEN_MESSAGE =
  'Acces interzis: ieșirile din stoc sunt disponibile doar pentru Magazie și Admin.';

export function canUseStockExits(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'user2';
}

function fail(message: string, status = 400, extra?: Record<string, unknown>): never {
  throw Object.assign(new Error(message), { status, ...extra });
}

export type ExitRow = {
  id: number;
  code: string;
  status: string;
  predat_de: string;
  predat_catre: string;
  destinatie: string;
  observatii: string | null;
  created_by: string;
  created_at: string;
  finalized_at: string;
};

export type ExitLineInput = { stock_item_id?: number; code?: string; quantity?: number };
export type ExitBody = {
  predat_de?: string;
  predat_catre?: string;
  destinatie?: string;
  observatii?: string;
  client_key?: string;
  items?: ExitLineInput[];
};

const MAX_LINES = 300;
const MAX_TEXT = 200;

function text(v: unknown, label: string, required: boolean, max = MAX_TEXT): string | null {
  const s = v == null ? '' : String(v).trim().replace(/\s+/g, ' ');
  if (!s) {
    if (required) fail(`Câmpul „${label}” este obligatoriu.`);
    return null;
  }
  if (s.length > max) fail(`Câmpul „${label}” este prea lung (maximum ${max} caractere).`);
  return s;
}

/** IES-YYYYMMDD-NNN (data din ora României). */
export function exitCodeFor(localDate: string, seq: number): string {
  return `IES-${localDate.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
}

export async function loadExit(db: D1Database, id: number) {
  const exit = await db.prepare(`SELECT * FROM stock_exits WHERE id = ?`).bind(id).first<ExitRow>();
  if (!exit) return null;
  const { results } = await db
    .prepare(
      `SELECT id, stock_item_id, barcode, name, mijloc_fix, quantity, quantity_after
       FROM stock_exit_items WHERE exit_id = ? ORDER BY id`
    )
    .bind(id)
    .all();
  const items = results || [];
  const total = items.reduce((a, r) => a + Number((r as { quantity: number }).quantity || 0), 0);
  return { ...exit, items, total };
}

export async function listExits(db: D1Database, q: URLSearchParams) {
  const search = q.get('q')?.trim();
  const params: unknown[] = [];
  let where = '';
  if (search) {
    const like = `%${search}%`;
    where = `WHERE e.code LIKE ? OR e.predat_catre LIKE ? OR e.destinatie LIKE ? OR e.predat_de LIKE ?
             OR e.id IN (SELECT exit_id FROM stock_exit_items WHERE name LIKE ? OR barcode LIKE ?)`;
    params.push(like, like, like, like, like, like);
  }
  const { results } = await db
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM stock_exit_items i WHERE i.exit_id = e.id) AS line_count,
              (SELECT COALESCE(SUM(quantity),0) FROM stock_exit_items i WHERE i.exit_id = e.id) AS total
       FROM stock_exits e ${where} ORDER BY e.id DESC LIMIT 500`
    )
    .bind(...params)
    .all();
  return results || [];
}

/**
 * Creează o ieșire deja finalizată, într-un singur batch D1 (tranzacție):
 * bon + linii, scade stocul, câte o mișcare ISSUE per articol, intrare în jurnal.
 * Dacă stocul s-a schimbat între verificare și scriere, inserarea mișcării dă
 * NULL în quantity_after (NOT NULL) și tot batch-ul se anulează.
 * `client_key` face trimiterea idempotentă (dublu-tap / reîncercare după eroare de rețea).
 */
export async function createExit(db: D1Database, user: AuthUser, body: ExitBody) {
  if (!canUseStockExits(user)) fail(EXIT_FORBIDDEN_MESSAGE, 403);

  const clientKey = body.client_key ? String(body.client_key).trim().slice(0, 80) : null;
  if (clientKey) {
    const prev = await db
      .prepare(`SELECT id FROM stock_exits WHERE client_key = ?`)
      .bind(clientKey)
      .first<{ id: number }>();
    if (prev) return { exit: await loadExit(db, prev.id), duplicate: true };
  }

  const predatDe = text(body.predat_de, 'Predat de', true)!;
  const predatCatre = text(body.predat_catre, 'Predat către', true)!;
  const destinatie = text(body.destinatie, 'Destinație', true)!;
  const observatii = text(body.observatii, 'Observații', false, 1000);

  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) fail('Scanează cel puțin un articol înainte de confirmare.');
  if (lines.length > MAX_LINES) fail(`Prea multe linii într-o ieșire (maximum ${MAX_LINES}).`);

  // Rezolvă fiecare linie la un articol din stoc și adună cantitățile pe articol.
  const merged = new Map<number, { item: StockItemRow; qty: number; scanned: string }>();
  const errors: string[] = [];
  for (const line of lines) {
    const qty = Number(line.quantity ?? 1);
    const code = line.code ? normalizeScanCode(String(line.code)) : '';
    if (!Number.isInteger(qty) || qty <= 0) {
      errors.push(`Cantitate invalidă pentru ${code || 'un articol'}.`);
      continue;
    }
    let item: StockItemRow | null = null;
    if (line.stock_item_id) {
      item = await db
        .prepare(`SELECT * FROM stock_items WHERE id = ?`)
        .bind(Number(line.stock_item_id))
        .first<StockItemRow>();
    } else if (code) {
      let catalog = null;
      try {
        catalog = await lookupCatalog(db, code);
      } catch {
        catalog = null; // catalog lipsă → căutăm doar în stoc
      }
      item = await findStockByCode(db, code, catalog);
    }
    if (!item) {
      errors.push(`Codul ${code || '?'} nu există în stoc.`);
      continue;
    }
    const prev = merged.get(item.id);
    if (prev) prev.qty += qty;
    else merged.set(item.id, { item, qty, scanned: code || String(item.barcode || item.sku) });
  }
  for (const { item, qty } of merged.values()) {
    const have = Number(item.quantity || 0);
    if (qty > have) {
      errors.push(
        have > 0
          ? `„${item.name}”: în stoc sunt doar ${have} buc., ai cerut ${qty}.`
          : `„${item.name}” nu mai este în stoc (0 buc.).`
      );
    }
  }
  if (errors.length) fail(errors[0], 409, { errors });

  // Cod bon: IES-YYYYMMDD-NNN. La coliziune (două ieșiri simultan) reîncercăm.
  const today = todayLocal();
  const prefix = exitCodeFor(today, 0).slice(0, -3);
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await db
      .prepare(`SELECT code FROM stock_exits WHERE code LIKE ? ORDER BY code DESC LIMIT 1`)
      .bind(`${prefix}%`)
      .first<{ code: string }>();
    const seq = (last ? Number(last.code.slice(prefix.length)) || 0 : 0) + 1 + attempt;
    const code = exitCodeFor(today, seq);
    const exitIdSql = `(SELECT id FROM stock_exits WHERE code = ?)`;

    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO stock_exits
           (code, status, predat_de, predat_catre, destinatie, observatii, client_key, created_by_id, created_by)
           VALUES (?, 'FINALIZAT', ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(code, predatDe, predatCatre, destinatie, observatii, clientKey, user.id, user.username),
    ];
    for (const { item, qty, scanned } of merged.values()) {
      stmts.push(
        // quantity_after = NULL dacă nu mai e destul stoc → NOT NULL eșuează → rollback
        db
          .prepare(
            `INSERT INTO stock_movements
             (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by, stock_exit_id)
             VALUES (?, NULL, ?, ?, 'ISSUE',
                     (SELECT CASE WHEN quantity >= ? THEN quantity - ? END FROM stock_items WHERE id = ?),
                     ?, ${exitIdSql})`
          )
          .bind(item.id, scanned, -qty, qty, qty, item.id, user.username, code),
        db
          .prepare(
            `UPDATE stock_items SET quantity = quantity - ?, updated_at = datetime('now')
             WHERE id = ? AND quantity >= ?`
          )
          .bind(qty, item.id, qty),
        db
          .prepare(
            `INSERT INTO stock_exit_items (exit_id, stock_item_id, barcode, name, mijloc_fix, quantity, quantity_after)
             VALUES (${exitIdSql}, ?, ?, ?, ?, ?, (SELECT quantity FROM stock_items WHERE id = ?))`
          )
          .bind(code, item.id, scanned, item.name, item.mijloc_fix ?? null, qty, item.id)
      );
    }
    const details = {
      exit_code: code,
      predat_de: predatDe,
      predat_catre: predatCatre,
      destinatie,
      observatii,
      total: [...merged.values()].reduce((a, l) => a + l.qty, 0),
      items: [...merged.values()].map((l) => ({
        stock_item_id: l.item.id,
        name: l.item.name,
        cod: l.scanned,
        mijloc_fix: l.item.mijloc_fix ?? null,
        cantitate: l.qty,
        stoc_inainte: Number(l.item.quantity || 0),
      })),
    };
    stmts.push(
      db
        .prepare(`INSERT INTO activity_logs (username, role, action, details) VALUES (?, ?, 'STOCK_EXIT', ?)`)
        .bind(user.username, user.role, JSON.stringify(details))
    );

    try {
      await db.batch(stmts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE/i.test(msg) && /client_key/i.test(msg) && clientKey) {
        const prev = await db
          .prepare(`SELECT id FROM stock_exits WHERE client_key = ?`)
          .bind(clientKey)
          .first<{ id: number }>();
        if (prev) return { exit: await loadExit(db, prev.id), duplicate: true };
      }
      if (/UNIQUE/i.test(msg) && /code/i.test(msg)) continue;
      if (/NOT NULL/i.test(msg) && /quantity_after/i.test(msg)) {
        fail('Stocul s-a modificat între timp. Verifică din nou cantitățile și reîncearcă.', 409);
      }
      if (/no such (table|column)/i.test(msg)) {
        fail('Baza de date nu este pregătită pentru ieșiri din stoc. Contactează administratorul.', 503);
      }
      throw e;
    }
    const row = await db.prepare(`SELECT id FROM stock_exits WHERE code = ?`).bind(code).first<{ id: number }>();
    return { exit: await loadExit(db, row!.id), duplicate: false };
  }
  fail('Nu s-a putut genera numărul bonului. Reîncearcă.', 409);
}
