import type { AuthUser } from './types';
import { isIsoDate, localDayStartUtc } from './time';

/** Rânduri maxime trimise o dată (un rând = un articol de pe un tichet). */
export const COMENZI_LIMIT = 2000;

/** Cine vede „Comenzi”: Admin, Client (doar tichetele proprii) și Magazie. */
export function canViewComenzi(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'user1' || user.role === 'user2';
}

function bad(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

/**
 * Lista comenzilor: un rând per articol de tichet, cu tichetul, destinația și data închiderii.
 * Un singur SELECT (JOIN pe chei primare), filtrat pe perioadă și limitat la COMENZI_LIMIT.
 * Status, destinație și căutarea se filtrează în pagină (fără diacritice, ca în rest).
 */
export async function listComenzi(db: D1Database, user: AuthUser, q: URLSearchParams) {
  if (!canViewComenzi(user)) bad('Nu ai acces la Comenzi', 403);
  const where: string[] = [];
  const params: unknown[] = [];
  const from = q.get('from')?.trim() || '';
  const to = q.get('to')?.trim() || '';
  if (from && !isIsoDate(from)) bad('Data „de la” invalidă (format AAAA-LL-ZZ)');
  if (to && !isIsoDate(to)) bad('Data „până la” invalidă (format AAAA-LL-ZZ)');
  if (from && to && from > to) bad('Data „de la” este după data „până la”');
  if (from) {
    where.push('t.created_at >= ?');
    params.push(localDayStartUtc(from));
  }
  if (to) {
    where.push('t.created_at < ?');
    params.push(localDayStartUtc(to, 1));
  }
  // Clientul vede doar tichetele lui (la fel ca în Tichete).
  if (user.role === 'user1') {
    where.push('t.created_by = ?');
    params.push(user.username);
  }
  const sql = `SELECT t.id AS ticket_id, t.ticket_code, t.status, t.client_name, t.created_by, t.created_at,
            CASE WHEN t.status = 'CLOSED' THEN COALESCE(
              (SELECT MAX(h.at) FROM ticket_history h WHERE h.ticket_id = t.id AND h.action IN ('CLOSED', 'RECEIVE_BACK')),
              t.updated_at) END AS closed_at,
            ti.id AS line_id, ti.ordered_qty, ti.sent_qty, ti.delivered_qty,
            s.name, s.barcode, s.mijloc_fix, s.sku,
            i.delivery_address, i.delivery_locality, i.delivery_county, i.recipient
     FROM ticket_items ti
     JOIN tickets t ON t.id = ti.ticket_id
     JOIN stock_items s ON s.id = ti.stock_item_id
     LEFT JOIN ticket_info i ON i.ticket_id = t.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.created_at DESC, t.id DESC, ti.id
     LIMIT ${COMENZI_LIMIT + 1}`;
  const { results } = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const rows = results || [];
  const truncated = rows.length > COMENZI_LIMIT;
  return { rows: truncated ? rows.slice(0, COMENZI_LIMIT) : rows, truncated, limit: COMENZI_LIMIT, from, to };
}
