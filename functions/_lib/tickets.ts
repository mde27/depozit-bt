import type { AuthUser, Env, Role, ScanStage } from './types';
import { assertCompanySet, isCompanyScoped, stockCompanyScope } from './company';

interface ScanLine {
  barcode: string;
  qty: number;
}

interface StockRow {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  quantity: number;
}

export function generateTicketCode(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `T-${ts}-${rand}`;
}

export async function logActivity(
  db: D1Database,
  username: string,
  role: string,
  action: string,
  details?: unknown
) {
  const detailsStr =
    details == null ? null : typeof details === 'string' ? details : JSON.stringify(details);
  await db
    .prepare(`INSERT INTO activity_logs (username, role, action, details) VALUES (?, ?, ?, ?)`)
    .bind(username, role, action, detailsStr)
    .run();
}

export async function addTicketHistory(
  db: D1Database,
  ticketId: number,
  username: string,
  action: string,
  details?: unknown
) {
  const detailsStr =
    details == null ? null : typeof details === 'string' ? details : JSON.stringify(details);
  await db
    .prepare(
      `INSERT INTO ticket_history (ticket_id, username, action, details) VALUES (?, ?, ?, ?)`
    )
    .bind(ticketId, username, action, detailsStr)
    .run();
}

export async function loadTicket(db: D1Database, id: number) {
  const ticket = await db.prepare(`SELECT * FROM tickets WHERE id = ?`).bind(id).first();
  if (!ticket) return null;
  const info = await db.prepare(`SELECT * FROM ticket_info WHERE ticket_id = ?`).bind(id).first();
  const { results: items } = await db
    .prepare(
      `SELECT ti.*, s.sku, s.name AS stock_name, s.barcode, s.quantity AS stock_qty, s.place
       FROM ticket_items ti
       JOIN stock_items s ON s.id = ti.stock_item_id
       WHERE ti.ticket_id = ?`
    )
    .bind(id)
    .all();
  const { results: history } = await db
    .prepare(`SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY id ASC`)
    .bind(id)
    .all();
  const { results: scans } = await db
    .prepare(
      `SELECT ts.*, s.name AS stock_name, s.sku
       FROM ticket_scans ts
       LEFT JOIN stock_items s ON s.id = ts.stock_item_id
       WHERE ts.ticket_id = ?
       ORDER BY ts.id ASC`
    )
    .bind(id)
    .all();
  return { ...ticket, info, items, history, scans };
}

/** user1 vede doar tichetele create de el; ceilalți roluri văd tot. */
export function canViewTicket(user: AuthUser, ticket: Record<string, unknown>): boolean {
  return user.role !== 'user1' || ticket.created_by === user.username;
}

async function resolveScans(db: D1Database, lines: ScanLine[], user?: AuthUser) {
  const errors: string[] = [];
  const byBarcode = new Map<string, number>();
  for (const line of lines) {
    const barcode = String(line.barcode ?? '').trim();
    const qty = Number(line.qty);
    if (!barcode) {
      errors.push('Barcode gol');
      continue;
    }
    if (!qty || qty < 1 || !Number.isFinite(qty)) {
      errors.push(`Cantitate invalidă pentru ${barcode}`);
      continue;
    }
    byBarcode.set(barcode, (byBarcode.get(barcode) || 0) + qty);
  }

  // user1: doar articolele firmei proprii (restul apar ca „necunoscut”)
  const scope = user ? stockCompanyScope(user) : { sql: '1=1', params: [] };
  const resolved: { barcode: string; qty: number; stock: StockRow }[] = [];
  for (const [barcode, qty] of byBarcode) {
    const stock = (await db
      .prepare(
        `SELECT id, sku, barcode, name, quantity FROM stock_items WHERE barcode = ? AND ${scope.sql}`
      )
      .bind(barcode, ...scope.params)
      .first()) as StockRow | null;
    if (!stock) {
      errors.push(`Barcode necunoscut: ${barcode}`);
      continue;
    }
    resolved.push({ barcode, qty, stock });
  }
  return { resolved, errors };
}

async function compareToOrder(
  db: D1Database,
  ticketId: number,
  resolved: { qty: number; stock: StockRow }[]
) {
  const { results: items } = await db
    .prepare(
      `SELECT ti.stock_item_id, ti.ordered_qty, s.sku, s.name, s.barcode
       FROM ticket_items ti JOIN stock_items s ON s.id = ti.stock_item_id
       WHERE ti.ticket_id = ?`
    )
    .bind(ticketId)
    .all<{
      stock_item_id: number;
      ordered_qty: number;
      sku: string;
      name: string;
      barcode: string | null;
    }>();

  const scannedById = new Map<number, number>();
  for (const r of resolved) {
    scannedById.set(r.stock.id, (scannedById.get(r.stock.id) || 0) + r.qty);
  }

  const expected = (items || []).map((it) => ({
    stock_item_id: it.stock_item_id,
    sku: it.sku,
    name: it.name,
    barcode: it.barcode,
    ordered_qty: it.ordered_qty,
    scanned_qty: scannedById.get(it.stock_item_id) || 0,
  }));

  const orderedIds = new Set((items || []).map((i) => i.stock_item_id));
  const extras = resolved
    .filter((r) => !orderedIds.has(r.stock.id))
    .map((r) => ({
      stock_item_id: r.stock.id,
      sku: r.stock.sku,
      name: r.stock.name,
      barcode: r.stock.barcode,
      scanned_qty: r.qty,
    }));

  const match =
    extras.length === 0 && expected.every((e) => e.ordered_qty === e.scanned_qty);
  return { match, expected, extras };
}

async function upsertTicketInfo(db: D1Database, ticketId: number, info: Record<string, unknown>) {
  await db
    .prepare(
      `INSERT INTO ticket_info (
        ticket_id, pm_client, phones, pickup_address, delivery_address,
        pickup_county, pickup_locality, delivery_county, delivery_locality,
        pickup_date, delivery_date, time_interval, return_request, return_details,
        comments, recipient
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticket_id) DO UPDATE SET
        pm_client=excluded.pm_client, phones=excluded.phones,
        pickup_address=excluded.pickup_address, delivery_address=excluded.delivery_address,
        pickup_county=excluded.pickup_county, pickup_locality=excluded.pickup_locality,
        delivery_county=excluded.delivery_county, delivery_locality=excluded.delivery_locality,
        pickup_date=excluded.pickup_date, delivery_date=excluded.delivery_date,
        time_interval=excluded.time_interval, return_request=excluded.return_request,
        return_details=excluded.return_details, comments=excluded.comments,
        recipient=excluded.recipient`
    )
    .bind(
      ticketId,
      info.pm_client ?? null,
      info.phones ?? null,
      info.pickup_address ?? null,
      info.delivery_address ?? null,
      info.pickup_county ?? null,
      info.pickup_locality ?? null,
      info.delivery_county ?? null,
      info.delivery_locality ?? null,
      info.pickup_date ?? null,
      info.delivery_date ?? null,
      info.time_interval ?? null,
      info.return_request ? 1 : 0,
      info.return_details ?? null,
      info.comments ?? null,
      info.recipient ?? null
    )
    .run();
}

/**
 * Validează articolele comandate înainte de orice scriere.
 * user1: fiecare stock_item_id trebuie să aparțină firmei proprii.
 */
async function validateTicketItems(
  db: D1Database,
  user: AuthUser,
  items: { stock_item_id: number; ordered_qty: number }[]
) {
  assertCompanySet(user);
  const scope = stockCompanyScope(user);
  for (const it of items) {
    const stockId = Number(it.stock_item_id);
    const qty = Number(it.ordered_qty);
    if (!stockId || !qty || qty < 1) {
      throw Object.assign(new Error('Articol invalid'), { status: 400 });
    }
    const stock = await db
      .prepare(`SELECT id FROM stock_items WHERE id = ? AND ${scope.sql}`)
      .bind(stockId, ...scope.params)
      .first();
    if (!stock) {
      if (isCompanyScoped(user)) {
        throw Object.assign(
          new Error(`Articolul #${stockId} nu există sau nu aparține firmei tale (${user.company}).`),
          { status: 403 }
        );
      }
      throw Object.assign(new Error(`Stock ${stockId} inexistent`), { status: 400 });
    }
  }
}

async function replaceTicketItems(
  db: D1Database,
  ticketId: number,
  items: { stock_item_id: number; ordered_qty: number }[]
) {
  await db.prepare(`DELETE FROM ticket_items WHERE ticket_id = ?`).bind(ticketId).run();
  for (const it of items) {
    const stockId = Number(it.stock_item_id);
    const qty = Number(it.ordered_qty);
    if (!stockId || !qty || qty < 1) throw new Error('Articol invalid');
    const stock = await db.prepare(`SELECT id FROM stock_items WHERE id = ?`).bind(stockId).first();
    if (!stock) throw new Error(`Stock ${stockId} inexistent`);
    await db
      .prepare(
        `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty) VALUES (?, ?, ?)`
      )
      .bind(ticketId, stockId, qty)
      .run();
  }
}

function queueStatusesForRole(role: Role): string[] | 'ALL' {
  switch (role) {
    case 'user1':
      return ['ORDERED', 'NEEDS_FIX'];
    case 'user2':
      return ['ORDERED', 'RETURNING'];
    case 'user3':
      return ['SENT'];
    case 'user4':
      return ['DELIVERED'];
    case 'admin':
      return 'ALL';
    default:
      return [];
  }
}

export async function listTickets(
  db: D1Database,
  user: AuthUser,
  query: URLSearchParams
) {
  const status = String(query.get('status') ?? '').trim();
  const queue = query.get('queue') === '1';
  const mine = query.get('mine') === '1';
  const active = query.get('active') === '1';

  let sql = `SELECT * FROM tickets WHERE 1=1`;
  const params: unknown[] = [];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  } else if (queue) {
    const allowed = queueStatusesForRole(user.role);
    if (allowed === 'ALL') {
      sql += ` AND status != 'CLOSED'`;
    } else if (allowed.length > 0) {
      sql += ` AND status IN (${allowed.map(() => '?').join(',')})`;
      params.push(...allowed);
    } else {
      return [];
    }
  } else if (active) {
    sql += ` AND status != 'CLOSED'`;
  }

  if (mine || user.role === 'user1') {
    sql += ` AND created_by = ?`;
    params.push(user.username);
  }

  sql += ` ORDER BY updated_at DESC`;
  const stmt = db.prepare(sql);
  const { results } = await (params.length ? stmt.bind(...params) : stmt).all();
  return results || [];
}

export async function createTicket(
  db: D1Database,
  user: AuthUser,
  body: {
    client_name?: string;
    items?: { stock_item_id: number; ordered_qty: number }[];
    info?: Record<string, unknown>;
  }
) {
  if (user.role !== 'user1' && user.role !== 'admin') {
    throw Object.assign(new Error('Doar user1 / admin pot crea tichete'), { status: 403 });
  }
  const clientName = String(body.client_name ?? '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const info = body.info ?? {};
  if (!clientName) throw Object.assign(new Error('client_name obligatoriu'), { status: 400 });
  if (items.length === 0) throw Object.assign(new Error('Cel puțin un articol'), { status: 400 });
  await validateTicketItems(db, user, items);

  const ticketCode = generateTicketCode();
  const ins = await db
    .prepare(
      `INSERT INTO tickets (ticket_code, client_name, status, created_by) VALUES (?, ?, 'ORDERED', ?)`
    )
    .bind(ticketCode, clientName, user.username)
    .run();
  const ticketId = Number(ins.meta.last_row_id);
  await upsertTicketInfo(db, ticketId, info);
  await replaceTicketItems(db, ticketId, items);
  await addTicketHistory(db, ticketId, user.username, 'ORDERED', { items });
  await logActivity(db, user.username, user.role, 'CREATE_TICKET', {
    ticketId,
    ticketCode,
    clientName,
  });
  return loadTicket(db, ticketId);
}

export async function resubmitTicket(
  db: D1Database,
  user: AuthUser,
  ticketId: number,
  body: {
    client_name?: string;
    items?: { stock_item_id: number; ordered_qty: number }[];
    info?: Record<string, unknown>;
  }
) {
  if (user.role !== 'user1' && user.role !== 'admin') {
    throw Object.assign(new Error('Doar user1 / admin pot edita'), { status: 403 });
  }
  const ticket = await db
    .prepare(`SELECT * FROM tickets WHERE id = ?`)
    .bind(ticketId)
    .first<{ id: number; status: string; created_by: string; ticket_code: string }>();
  if (!ticket || !canViewTicket(user, ticket)) {
    throw Object.assign(new Error('Tichet negăsit'), { status: 404 });
  }
  if (ticket.status !== 'NEEDS_FIX' && user.role !== 'admin') {
    throw Object.assign(new Error('Editare permisă doar în status NEEDS_FIX'), { status: 400 });
  }
  const clientName = String(body.client_name ?? '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const info = body.info ?? {};
  if (!clientName) throw Object.assign(new Error('client_name obligatoriu'), { status: 400 });
  if (items.length === 0) throw Object.assign(new Error('Cel puțin un articol'), { status: 400 });
  await validateTicketItems(db, user, items);

  await db
    .prepare(
      `UPDATE tickets SET client_name = ?, status = 'ORDERED', fix_comment = NULL, updated_at = datetime('now') WHERE id = ?`
    )
    .bind(clientName, ticketId)
    .run();
  await upsertTicketInfo(db, ticketId, info);
  await replaceTicketItems(db, ticketId, items);
  await addTicketHistory(db, ticketId, user.username, 'RESUBMIT', { items, clientName });
  await logActivity(db, user.username, user.role, 'RESUBMIT_TICKET', {
    ticketId,
    ticket_code: ticket.ticket_code,
  });
  return loadTicket(db, ticketId);
}

function can(user: AuthUser, ...roles: Role[]) {
  return user.role === 'admin' || roles.includes(user.role);
}

export async function ticketAction(
  db: D1Database,
  user: AuthUser,
  ticketId: number,
  body: {
    action?: string;
    comment?: string;
    scans?: ScanLine[];
  }
) {
  const ticket = await db
    .prepare(`SELECT * FROM tickets WHERE id = ?`)
    .bind(ticketId)
    .first<{ id: number; status: string; ticket_code: string; created_by: string }>();
  // user1 poate acționa (ex. COMMENT) doar pe tichetele proprii
  if (!ticket || !canViewTicket(user, ticket)) {
    throw Object.assign(new Error('Tichet negăsit'), { status: 404 });
  }

  const action = String(body.action ?? '').toUpperCase();
  const comment = body.comment != null ? String(body.comment) : null;
  const lines: ScanLine[] = Array.isArray(body.scans) ? body.scans : [];
  const username = user.username;

  switch (action) {
    case 'SEND_WITH_COMMENT': {
      if (!can(user, 'user2')) throw Object.assign(new Error('Doar user2'), { status: 403 });
      if (ticket.status !== 'ORDERED') {
        throw Object.assign(new Error('Status trebuie să fie ORDERED'), { status: 400 });
      }
      if (!comment?.trim()) {
        throw Object.assign(new Error('Comentariu obligatoriu pentru trimitere cu observații'), {
          status: 400,
        });
      }
      let resolved: { barcode: string; qty: number; stock: StockRow }[] = [];
      let comparison = null;
      if (lines.length) {
        const r = await resolveScans(db, lines, user);
        if (r.errors.length) throw Object.assign(new Error(r.errors.join('; ')), { status: 400 });
        resolved = r.resolved;
        comparison = await compareToOrder(db, ticketId, resolved);
        for (const x of resolved) {
          await db
            .prepare(
              `INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
               VALUES (?, 'SEND', ?, ?, ?, ?)`
            )
            .bind(ticketId, x.barcode, x.stock.id, x.qty, username)
            .run();
        }
      }
      await db
        .prepare(
          `UPDATE tickets SET status = 'NEEDS_FIX', fix_comment = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(comment.trim(), ticketId)
        .run();
      await addTicketHistory(db, ticketId, username, 'SEND_WITH_COMMENT', {
        comment: comment.trim(),
        comparison,
        scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty })),
      });
      break;
    }

    case 'SEND':
    case 'TRIMITERE': {
      if (!can(user, 'user2')) throw Object.assign(new Error('Doar user2'), { status: 403 });
      if (ticket.status !== 'ORDERED') {
        throw Object.assign(new Error('Status trebuie să fie ORDERED'), { status: 400 });
      }
      if (!lines.length) {
        throw Object.assign(new Error('Scanează cel puțin un articol'), { status: 400 });
      }
      const { resolved, errors } = await resolveScans(db, lines, user);
      if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
      const comparison = await compareToOrder(db, ticketId, resolved);
      if (!comparison.match) {
        const err = Object.assign(
          new Error(
            'Scanările nu corespund comenzii. Folosește „Trimitere cu comentariu” sau corectează scanările.'
          ),
          { status: 400, comparison }
        );
        throw err;
      }
      for (const r of resolved) {
        if (r.stock.quantity < r.qty) {
          throw Object.assign(
            new Error(
              `Stoc insuficient pentru ${r.stock.name} (are ${r.stock.quantity}, nevoie ${r.qty})`
            ),
            { status: 400 }
          );
        }
      }

      const stmts: D1PreparedStatement[] = [];
      for (const r of resolved) {
        const stock = (await db
          .prepare(`SELECT id, quantity FROM stock_items WHERE id = ?`)
          .bind(r.stock.id)
          .first()) as { id: number; quantity: number };
        const newQty = stock.quantity - r.qty;
        stmts.push(
          db
            .prepare(
              `UPDATE stock_items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`
            )
            .bind(newQty, stock.id)
        );
        stmts.push(
          db
            .prepare(
              `INSERT INTO stock_movements
                (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
               VALUES (?, ?, ?, ?, 'SEND_OUT', ?, ?)`
            )
            .bind(stock.id, ticketId, r.barcode, -r.qty, newQty, username)
        );
        stmts.push(
          db
            .prepare(
              `UPDATE ticket_items SET sent_qty = ? WHERE ticket_id = ? AND stock_item_id = ?`
            )
            .bind(r.qty, ticketId, r.stock.id)
        );
        stmts.push(
          db
            .prepare(
              `INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
               VALUES (?, 'SEND', ?, ?, ?, ?)`
            )
            .bind(ticketId, r.barcode, r.stock.id, r.qty, username)
        );
      }
      stmts.push(
        db
          .prepare(
            `UPDATE tickets SET status = 'SENT', fix_comment = NULL, updated_at = datetime('now') WHERE id = ?`
          )
          .bind(ticketId)
      );
      await db.batch(stmts);
      await addTicketHistory(db, ticketId, username, 'SEND', { comparison, scans: lines });
      break;
    }

    case 'DELIVER': {
      if (!can(user, 'user3')) throw Object.assign(new Error('Doar user3'), { status: 403 });
      if (ticket.status !== 'SENT') {
        throw Object.assign(new Error('Status trebuie să fie SENT'), { status: 400 });
      }
      if (!lines.length) throw Object.assign(new Error('Scanează ce s-a livrat'), { status: 400 });
      const { resolved, errors } = await resolveScans(db, lines, user);
      if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

      for (const r of resolved) {
        await db
          .prepare(
            `INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
             VALUES (?, 'DELIVER', ?, ?, ?, ?)`
          )
          .bind(ticketId, r.barcode, r.stock.id, r.qty, username)
          .run();
        const existing = await db
          .prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND stock_item_id = ?`)
          .bind(ticketId, r.stock.id)
          .first<{ id: number }>();
        if (existing) {
          await db
            .prepare(`UPDATE ticket_items SET delivered_qty = delivered_qty + ? WHERE id = ?`)
            .bind(r.qty, existing.id)
            .run();
        } else {
          await db
            .prepare(
              `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, delivered_qty)
               VALUES (?, ?, 0, ?)`
            )
            .bind(ticketId, r.stock.id, r.qty)
            .run();
        }
      }
      await db
        .prepare(
          `UPDATE tickets SET status = 'DELIVERED', updated_at = datetime('now') WHERE id = ?`
        )
        .bind(ticketId)
        .run();
      await addTicketHistory(db, ticketId, username, 'DELIVER', {
        scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty, name: x.stock.name })),
        comment,
      });
      break;
    }

    case 'RETURN_OUT': {
      if (!can(user, 'user4')) throw Object.assign(new Error('Doar user4'), { status: 403 });
      if (ticket.status !== 'DELIVERED') {
        throw Object.assign(new Error('Status trebuie să fie DELIVERED'), { status: 400 });
      }
      if (!lines.length) {
        throw Object.assign(new Error('Scanează ce se returnează'), { status: 400 });
      }
      const { resolved, errors } = await resolveScans(db, lines, user);
      if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

      for (const r of resolved) {
        await db
          .prepare(
            `INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
             VALUES (?, 'RETURN_OUT', ?, ?, ?, ?)`
          )
          .bind(ticketId, r.barcode, r.stock.id, r.qty, username)
          .run();
        const existing = await db
          .prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND stock_item_id = ?`)
          .bind(ticketId, r.stock.id)
          .first<{ id: number }>();
        if (existing) {
          await db
            .prepare(`UPDATE ticket_items SET return_out_qty = return_out_qty + ? WHERE id = ?`)
            .bind(r.qty, existing.id)
            .run();
        } else {
          await db
            .prepare(
              `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, return_out_qty)
               VALUES (?, ?, 0, ?)`
            )
            .bind(ticketId, r.stock.id, r.qty)
            .run();
        }
      }
      await db
        .prepare(
          `UPDATE tickets SET status = 'RETURNING', updated_at = datetime('now') WHERE id = ?`
        )
        .bind(ticketId)
        .run();
      await addTicketHistory(db, ticketId, username, 'RETURN_OUT', {
        scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty, name: x.stock.name })),
        comment,
      });
      break;
    }

    case 'RECEIVE_BACK': {
      if (!can(user, 'user2')) throw Object.assign(new Error('Doar user2'), { status: 403 });
      if (ticket.status !== 'RETURNING') {
        throw Object.assign(new Error('Status trebuie să fie RETURNING'), { status: 400 });
      }
      if (!lines.length) {
        throw Object.assign(new Error('Scanează ce s-a primit înapoi'), { status: 400 });
      }
      const { resolved, errors } = await resolveScans(db, lines, user);
      if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

      const stmts: D1PreparedStatement[] = [];
      for (const r of resolved) {
        const stock = (await db
          .prepare(`SELECT id, quantity FROM stock_items WHERE id = ?`)
          .bind(r.stock.id)
          .first()) as { id: number; quantity: number };
        const newQty = stock.quantity + r.qty;
        stmts.push(
          db
            .prepare(
              `UPDATE stock_items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`
            )
            .bind(newQty, stock.id)
        );
        stmts.push(
          db
            .prepare(
              `INSERT INTO stock_movements
                (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
               VALUES (?, ?, ?, ?, 'RECEIVE_BACK', ?, ?)`
            )
            .bind(stock.id, ticketId, r.barcode, r.qty, newQty, username)
        );
        stmts.push(
          db
            .prepare(
              `INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
               VALUES (?, 'RECEIVE_BACK', ?, ?, ?, ?)`
            )
            .bind(ticketId, r.barcode, r.stock.id, r.qty, username)
        );
      }
      stmts.push(
        db
          .prepare(
            `UPDATE tickets SET status = 'CLOSED', updated_at = datetime('now') WHERE id = ?`
          )
          .bind(ticketId)
      );
      await db.batch(stmts);

      for (const r of resolved) {
        const existing = await db
          .prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND stock_item_id = ?`)
          .bind(ticketId, r.stock.id)
          .first<{ id: number }>();
        if (existing) {
          await db
            .prepare(
              `UPDATE ticket_items SET received_back_qty = received_back_qty + ? WHERE id = ?`
            )
            .bind(r.qty, existing.id)
            .run();
        } else {
          await db
            .prepare(
              `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, received_back_qty)
               VALUES (?, ?, 0, ?)`
            )
            .bind(ticketId, r.stock.id, r.qty)
            .run();
        }
      }
      await addTicketHistory(db, ticketId, username, 'RECEIVE_BACK', {
        scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty, name: x.stock.name })),
        comment,
      });
      break;
    }

    case 'COMMENT': {
      if (!comment?.trim()) {
        throw Object.assign(new Error('Comentariu obligatoriu'), { status: 400 });
      }
      await addTicketHistory(db, ticketId, username, 'COMMENT', comment.trim());
      await db
        .prepare(`UPDATE tickets SET updated_at = datetime('now') WHERE id = ?`)
        .bind(ticketId)
        .run();
      break;
    }

    case 'CLOSED': {
      if (!can(user, 'admin', 'user2')) {
        throw Object.assign(new Error('Acces interzis'), { status: 403 });
      }
      await db
        .prepare(
          `UPDATE tickets SET status = 'CLOSED', updated_at = datetime('now') WHERE id = ?`
        )
        .bind(ticketId)
        .run();
      await addTicketHistory(db, ticketId, username, 'CLOSED', comment);
      break;
    }

    default:
      throw Object.assign(new Error(`Acțiune necunoscută: ${action}`), { status: 400 });
  }

  await logActivity(db, username, user.role, `TICKET_${action}`, {
    ticketId,
    ticket_code: ticket.ticket_code,
    comment,
  });
  return loadTicket(db, ticketId);
}

export async function scanPreview(
  db: D1Database,
  user: AuthUser,
  ticketId: number,
  lines: ScanLine[]
) {
  const ticket = await db
    .prepare(`SELECT id, created_by FROM tickets WHERE id = ?`)
    .bind(ticketId)
    .first<{ id: number; created_by: string }>();
  if (!ticket || !canViewTicket(user, ticket)) {
    throw Object.assign(new Error('Tichet negăsit'), { status: 404 });
  }
  const { resolved, errors } = await resolveScans(db, lines, user);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400, errors });
  const comparison = await compareToOrder(db, ticketId, resolved);
  return {
    comparison,
    resolved: resolved.map((r) => ({
      barcode: r.barcode,
      qty: r.qty,
      stock_item_id: r.stock.id,
      name: r.stock.name,
      sku: r.stock.sku,
      stock_qty: r.stock.quantity,
    })),
  };
}
