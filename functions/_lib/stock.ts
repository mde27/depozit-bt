import type { AuthUser } from './types';
import type { StockItemRow } from './catalog';
import { logActivity } from './tickets';

type HttpError = Error & { status?: number };

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status }) as HttpError;
}

/** Doar admin / user2 pot edita sau șterge articole din stoc. */
export function canManageStock(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'user2';
}

/** Câmpuri text editabile; `required` = NOT NULL în schemă. */
const TEXT_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'sku', label: 'SKU', required: true },
  { key: 'barcode', label: 'Barcode' },
  { key: 'name', label: 'Denumire', required: true },
  { key: 'name2', label: 'Denumire 2' },
  { key: 'description', label: 'Descriere' },
  { key: 'company', label: 'Firmă' },
  { key: 'place', label: 'Locație' },
  { key: 'comments', label: 'Comentarii' },
  { key: 'mijloc_fix', label: 'Mijloc fix' },
  { key: 'mijloc_fix_orig', label: 'Mijloc fix ORIG' },
  { key: 'source_from', label: 'Sursă' },
];

async function loadItem(db: D1Database, id: number): Promise<StockItemRow> {
  const item = await db
    .prepare(`SELECT * FROM stock_items WHERE id = ?`)
    .bind(id)
    .first<StockItemRow>();
  if (!item) fail('Articol negăsit', 404);
  return item;
}

/**
 * Editare articol (admin / user2). Se actualizează doar câmpurile trimise.
 * Schimbarea cantității creează o mișcare MANUAL_EDIT în stock_movements.
 * `is_uncatalogued` rămâne neschimbat: flag-ul înseamnă „negăsit în catalogul SMISS”,
 * iar redenumirea manuală nu îl face găsit în catalog.
 */
export async function updateStockItem(
  db: D1Database,
  user: AuthUser,
  id: number,
  body: Record<string, unknown>
): Promise<StockItemRow> {
  if (!canManageStock(user)) fail('Acces interzis — doar admin / user2', 403);
  const before = await loadItem(db, id);

  const changes: Record<string, string | number | null> = {};
  for (const f of TEXT_FIELDS) {
    if (!(f.key in body)) continue;
    const raw = body[f.key];
    const value = raw == null ? null : String(raw).trim() || null;
    if (f.required && !value) fail(`Câmpul „${f.label}” este obligatoriu`);
    if (value !== ((before[f.key] as string | null | undefined) ?? null)) changes[f.key] = value;
  }

  if ('quantity' in body) {
    const qty = Number(body.quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      fail('Cantitatea trebuie să fie un număr întreg ≥ 0');
    }
    if (qty !== Number(before.quantity)) changes.quantity = qty;
  }

  const keys = Object.keys(changes);
  if (keys.length === 0) return before;

  // Unicitate (schema: sku UNIQUE, barcode UNIQUE)
  if (changes.sku) {
    const dup = await db
      .prepare(`SELECT id, name FROM stock_items WHERE sku = ? AND id != ?`)
      .bind(changes.sku, id)
      .first<{ id: number; name: string }>();
    if (dup) fail(`SKU „${changes.sku}” este deja folosit de articolul „${dup.name}”`, 409);
  }
  if (changes.barcode) {
    const dup = await db
      .prepare(`SELECT id, name FROM stock_items WHERE barcode = ? AND id != ?`)
      .bind(changes.barcode, id)
      .first<{ id: number; name: string }>();
    if (dup) {
      fail(`Barcode-ul „${changes.barcode}” este deja folosit de articolul „${dup.name}”`, 409);
    }
  }

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE stock_items SET ${keys.map((k) => `${k} = ?`).join(', ')},
         updated_at = datetime('now') WHERE id = ?`
      )
      .bind(...keys.map((k) => changes[k]), id),
  ];
  if ('quantity' in changes) {
    const newQty = changes.quantity as number;
    const barcode = (changes.barcode as string | null | undefined) ?? before.barcode ?? null;
    stmts.push(
      db
        .prepare(
          `INSERT INTO stock_movements
           (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
           VALUES (?, NULL, ?, ?, 'MANUAL_EDIT', ?, ?)`
        )
        .bind(id, barcode, newQty - Number(before.quantity), newQty, user.username)
    );
  }

  try {
    await db.batch(stmts);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE/i.test(msg)) fail('SKU sau barcode deja folosit de alt articol', 409);
    throw e;
  }

  await logActivity(db, user.username, user.role, 'UPDATE_STOCK', {
    stock_item_id: id,
    sku: before.sku,
    before: Object.fromEntries(keys.map((k) => [k, before[k] ?? null])),
    after: changes,
  });
  return loadItem(db, id);
}

/**
 * Ștergere articol (admin / user2). Refuză (409) dacă articolul apare în vreun tichet
 * (ticket_items / ticket_scans / mișcări legate de tichet), ca istoricul să rămână intact.
 * Altfel șterge mișcările proprii (INITIAL / RECEIVE / MANUAL_EDIT) și articolul.
 */
export async function deleteStockItem(
  db: D1Database,
  user: AuthUser,
  id: number
): Promise<{ id: number }> {
  if (!canManageStock(user)) fail('Acces interzis — doar admin / user2', 403);
  const item = await loadItem(db, id);

  const { results: refs } = await db
    .prepare(
      `SELECT DISTINCT t.ticket_code FROM tickets t
       WHERE t.id IN (
         SELECT ticket_id FROM ticket_items WHERE stock_item_id = ?
         UNION SELECT ticket_id FROM ticket_scans WHERE stock_item_id = ?
         UNION SELECT ticket_id FROM stock_movements
               WHERE stock_item_id = ? AND ticket_id IS NOT NULL
       )
       ORDER BY t.id DESC`
    )
    .bind(id, id, id)
    .all<{ ticket_code: string }>();
  const codes = (refs || []).map((r) => r.ticket_code);
  if (codes.length) {
    const shown = codes.slice(0, 10).join(', ');
    const more = codes.length > 10 ? ` și încă ${codes.length - 10}` : '';
    fail(
      `Articolul „${item.name}” nu poate fi șters: este folosit în cereri (${shown}${more}). ` +
        'Poți corecta cantitatea la 0 prin editare.',
      409
    );
  }

  const { results: movements } = await db
    .prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE stock_item_id = ?`)
    .bind(id)
    .all<{ n: number }>();

  await db.batch([
    db.prepare(`DELETE FROM stock_movements WHERE stock_item_id = ?`).bind(id),
    db.prepare(`DELETE FROM stock_items WHERE id = ?`).bind(id),
  ]);

  await logActivity(db, user.username, user.role, 'DELETE_STOCK', {
    stock_item_id: id,
    sku: item.sku,
    barcode: item.barcode,
    name: item.name,
    company: item.company ?? null,
    quantity: item.quantity,
    movements_deleted: movements?.[0]?.n ?? 0,
  });
  return { id };
}
