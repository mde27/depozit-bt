import { Router } from 'express';
import { db, type ScanStage } from '../db.js';
import { authRequired, type Role } from '../auth.js';
import { addTicketHistory, generateTicketCode, logActivity } from '../logger.js';

const router = Router();

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

function loadTicket(id: number) {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!ticket) return null;
  const info = db.prepare(`SELECT * FROM ticket_info WHERE ticket_id = ?`).get(id);
  const items = db
    .prepare(
      `SELECT ti.*, s.sku, s.name AS stock_name, s.barcode, s.quantity AS stock_qty, s.place
       FROM ticket_items ti
       JOIN stock_items s ON s.id = ti.stock_item_id
       WHERE ti.ticket_id = ?`
    )
    .all(id);
  const history = db
    .prepare(`SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY id ASC`)
    .all(id);
  const scans = db
    .prepare(
      `SELECT ts.*, s.name AS stock_name, s.sku
       FROM ticket_scans ts
       LEFT JOIN stock_items s ON s.id = ts.stock_item_id
       WHERE ts.ticket_id = ?
       ORDER BY ts.id ASC`
    )
    .all(id);
  return { ...ticket, info, items, history, scans };
}

function resolveScans(lines: ScanLine[]): {
  resolved: { barcode: string; qty: number; stock: StockRow }[];
  errors: string[];
} {
  const errors: string[] = [];
  const resolved: { barcode: string; qty: number; stock: StockRow }[] = [];
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

  for (const [barcode, qty] of byBarcode) {
    const stock = db
      .prepare(`SELECT id, sku, barcode, name, quantity FROM stock_items WHERE barcode = ?`)
      .get(barcode) as StockRow | undefined;
    if (!stock) {
      errors.push(`Barcode necunoscut: ${barcode}`);
      continue;
    }
    resolved.push({ barcode, qty, stock });
  }

  return { resolved, errors };
}

function compareToOrder(
  ticketId: number,
  resolved: { qty: number; stock: StockRow }[]
) {
  const items = db
    .prepare(
      `SELECT ti.stock_item_id, ti.ordered_qty, s.sku, s.name, s.barcode
       FROM ticket_items ti JOIN stock_items s ON s.id = ti.stock_item_id
       WHERE ti.ticket_id = ?`
    )
    .all(ticketId) as {
    stock_item_id: number;
    ordered_qty: number;
    sku: string;
    name: string;
    barcode: string | null;
  }[];

  const scannedById = new Map<number, number>();
  for (const r of resolved) {
    scannedById.set(r.stock.id, (scannedById.get(r.stock.id) || 0) + r.qty);
  }

  const expected = items.map((it) => ({
    stock_item_id: it.stock_item_id,
    sku: it.sku,
    name: it.name,
    barcode: it.barcode,
    ordered_qty: it.ordered_qty,
    scanned_qty: scannedById.get(it.stock_item_id) || 0,
  }));

  const orderedIds = new Set(items.map((i) => i.stock_item_id));
  const extras: {
    stock_item_id: number;
    sku: string;
    name: string;
    barcode: string | null;
    scanned_qty: number;
  }[] = [];
  for (const r of resolved) {
    if (!orderedIds.has(r.stock.id)) {
      extras.push({
        stock_item_id: r.stock.id,
        sku: r.stock.sku,
        name: r.stock.name,
        barcode: r.stock.barcode,
        scanned_qty: r.qty,
      });
    }
  }

  const match =
    extras.length === 0 && expected.every((e) => e.ordered_qty === e.scanned_qty);

  return { match, expected, extras };
}

function persistScans(
  ticketId: number,
  stage: ScanStage,
  resolved: { barcode: string; qty: number; stock: StockRow }[],
  username: string
) {
  const ins = db.prepare(
    `INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const r of resolved) {
    ins.run(ticketId, stage, r.barcode, r.stock.id, r.qty, username);
  }
}

function upsertTicketInfo(ticketId: number, info: Record<string, unknown>) {
  db.prepare(
    `INSERT INTO ticket_info (
      ticket_id, pm_client, phones, pickup_address, delivery_address,
      pickup_county, pickup_locality, delivery_county, delivery_locality,
      pickup_date, delivery_date, time_interval, return_request, return_details,
      comments, recipient
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticket_id) DO UPDATE SET
      pm_client=excluded.pm_client,
      phones=excluded.phones,
      pickup_address=excluded.pickup_address,
      delivery_address=excluded.delivery_address,
      pickup_county=excluded.pickup_county,
      pickup_locality=excluded.pickup_locality,
      delivery_county=excluded.delivery_county,
      delivery_locality=excluded.delivery_locality,
      pickup_date=excluded.pickup_date,
      delivery_date=excluded.delivery_date,
      time_interval=excluded.time_interval,
      return_request=excluded.return_request,
      return_details=excluded.return_details,
      comments=excluded.comments,
      recipient=excluded.recipient`
  ).run(
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
  );
}

function replaceTicketItems(
  ticketId: number,
  items: { stock_item_id: number; ordered_qty: number }[]
) {
  db.prepare(`DELETE FROM ticket_items WHERE ticket_id = ?`).run(ticketId);
  const ins = db.prepare(
    `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty) VALUES (?, ?, ?)`
  );
  for (const it of items) {
    const stockId = Number(it.stock_item_id);
    const qty = Number(it.ordered_qty);
    if (!stockId || !qty || qty < 1) throw new Error('Articol invalid');
    const stock = db.prepare(`SELECT id FROM stock_items WHERE id = ?`).get(stockId);
    if (!stock) throw new Error(`Stock ${stockId} inexistent`);
    ins.run(ticketId, stockId, qty);
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

router.get('/', authRequired, (req, res) => {
  const role = req.user!.role;
  const status = String(req.query.status ?? '').trim();
  const queue = String(req.query.queue ?? '') === '1';
  const mine = String(req.query.mine ?? '') === '1';
  const active = String(req.query.active ?? '') === '1';

  let sql = `SELECT * FROM tickets WHERE 1=1`;
  const params: unknown[] = [];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  } else if (queue) {
    const allowed = queueStatusesForRole(role);
    if (allowed === 'ALL') {
      sql += ` AND status != 'CLOSED'`;
    } else if (allowed.length > 0) {
      sql += ` AND status IN (${allowed.map(() => '?').join(',')})`;
      params.push(...allowed);
    } else {
      return res.json({ tickets: [] });
    }
  } else if (active) {
    sql += ` AND status != 'CLOSED'`;
  }

  if (mine || role === 'user1') {
    sql += ` AND created_by = ?`;
    params.push(req.user!.username);
  }

  sql += ` ORDER BY updated_at DESC`;
  const tickets = db.prepare(sql).all(...params);
  res.json({ tickets });
});

router.get('/:id', authRequired, (req, res) => {
  const ticket = loadTicket(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Tichet negăsit' });
  res.json({ ticket });
});

router.post('/', authRequired, (req, res) => {
  const role = req.user!.role;
  if (role !== 'user1' && role !== 'admin') {
    return res.status(403).json({ error: 'Doar user1 / admin pot crea tichete' });
  }

  const body = req.body ?? {};
  const clientName = String(body.client_name ?? '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const info = body.info ?? {};

  if (!clientName) return res.status(400).json({ error: 'client_name obligatoriu' });
  if (items.length === 0) return res.status(400).json({ error: 'Cel puțin un articol' });

  const ticketCode = generateTicketCode();
  const username = req.user!.username;

  try {
    const ticketId = db.transaction(() => {
      const tInfo = db
        .prepare(
          `INSERT INTO tickets (ticket_code, client_name, status, created_by)
           VALUES (?, ?, 'ORDERED', ?)`
        )
        .run(ticketCode, clientName, username);
      const id = Number(tInfo.lastInsertRowid);
      upsertTicketInfo(id, info);
      replaceTicketItems(id, items);
      addTicketHistory(id, username, 'ORDERED', { items });
      return id;
    })();

    logActivity(username, role, 'CREATE_TICKET', { ticketId, ticketCode, clientName });
    res.status(201).json({ ticket: loadTicket(ticketId) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ error: msg });
  }
});

router.put('/:id', authRequired, (req, res) => {
  const role = req.user!.role;
  if (role !== 'user1' && role !== 'admin') {
    return res.status(403).json({ error: 'Doar user1 / admin pot edita' });
  }

  const ticketId = Number(req.params.id);
  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(ticketId) as
    | { id: number; status: string; created_by: string; ticket_code: string }
    | undefined;
  if (!ticket) return res.status(404).json({ error: 'Tichet negăsit' });
  if (ticket.status !== 'NEEDS_FIX' && role !== 'admin') {
    return res.status(400).json({ error: 'Editare permisă doar în status NEEDS_FIX' });
  }
  if (role === 'user1' && ticket.created_by !== req.user!.username) {
    return res.status(403).json({ error: 'Nu este tichetul tău' });
  }

  const body = req.body ?? {};
  const clientName = String(body.client_name ?? '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const info = body.info ?? {};
  if (!clientName) return res.status(400).json({ error: 'client_name obligatoriu' });
  if (items.length === 0) return res.status(400).json({ error: 'Cel puțin un articol' });

  try {
    db.transaction(() => {
      db.prepare(
        `UPDATE tickets SET client_name = ?, status = 'ORDERED', fix_comment = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(clientName, ticketId);
      upsertTicketInfo(ticketId, info);
      replaceTicketItems(ticketId, items);
      addTicketHistory(ticketId, req.user!.username, 'RESUBMIT', { items, clientName });
    })();
    logActivity(req.user!.username, role, 'RESUBMIT_TICKET', {
      ticketId,
      ticket_code: ticket.ticket_code,
    });
    res.json({ ticket: loadTicket(ticketId) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ error: msg });
  }
});

router.post('/:id/scan-preview', authRequired, (req, res) => {
  const ticketId = Number(req.params.id);
  const ticket = db.prepare(`SELECT id FROM tickets WHERE id = ?`).get(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Tichet negăsit' });

  const lines: ScanLine[] = Array.isArray(req.body?.scans) ? req.body.scans : [];
  const { resolved, errors } = resolveScans(lines);
  if (errors.length) return res.status(400).json({ error: errors.join('; '), errors });

  const comparison = compareToOrder(ticketId, resolved);
  res.json({
    comparison,
    resolved: resolved.map((r) => ({
      barcode: r.barcode,
      qty: r.qty,
      stock_item_id: r.stock.id,
      name: r.stock.name,
      sku: r.stock.sku,
      stock_qty: r.stock.quantity,
    })),
  });
});

router.post('/:id/actions', authRequired, (req, res) => {
  const ticketId = Number(req.params.id);
  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(ticketId) as
    | { id: number; status: string; ticket_code: string; created_by: string }
    | undefined;
  if (!ticket) return res.status(404).json({ error: 'Tichet negăsit' });

  const action = String(req.body?.action ?? '').toUpperCase();
  const comment = req.body?.comment != null ? String(req.body.comment) : null;
  const lines: ScanLine[] = Array.isArray(req.body?.scans) ? req.body.scans : [];
  const username = req.user!.username;
  const role = req.user!.role;
  const can = (...roles: Role[]) => role === 'admin' || roles.includes(role);

  try {
    switch (action) {
      case 'SEND_WITH_COMMENT': {
        if (!can('user2')) return res.status(403).json({ error: 'Doar user2' });
        if (ticket.status !== 'ORDERED') {
          return res.status(400).json({ error: 'Status trebuie să fie ORDERED' });
        }
        if (!comment?.trim()) {
          return res.status(400).json({
            error: 'Comentariu obligatoriu pentru trimitere cu observații',
          });
        }
        let resolved: { barcode: string; qty: number; stock: StockRow }[] = [];
        let comparison = null;
        if (lines.length) {
          const r = resolveScans(lines);
          if (r.errors.length) return res.status(400).json({ error: r.errors.join('; ') });
          resolved = r.resolved;
          comparison = compareToOrder(ticketId, resolved);
        }
        db.transaction(() => {
          if (resolved.length) persistScans(ticketId, 'SEND', resolved, username);
          db.prepare(
            `UPDATE tickets SET status = 'NEEDS_FIX', fix_comment = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(comment.trim(), ticketId);
          addTicketHistory(ticketId, username, 'SEND_WITH_COMMENT', {
            comment: comment.trim(),
            comparison,
            scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty })),
          });
        })();
        break;
      }

      case 'SEND':
      case 'TRIMITERE': {
        if (!can('user2')) return res.status(403).json({ error: 'Doar user2' });
        if (ticket.status !== 'ORDERED') {
          return res.status(400).json({ error: 'Status trebuie să fie ORDERED' });
        }
        if (!lines.length) return res.status(400).json({ error: 'Scanează cel puțin un articol' });

        const { resolved, errors } = resolveScans(lines);
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });

        const comparison = compareToOrder(ticketId, resolved);
        if (!comparison.match) {
          return res.status(400).json({
            error:
              'Scanările nu corespund comenzii. Folosește „Trimitere cu comentariu” sau corectează scanările.',
            comparison,
          });
        }

        for (const r of resolved) {
          if (r.stock.quantity < r.qty) {
            return res.status(400).json({
              error: `Stoc insuficient pentru ${r.stock.name} (are ${r.stock.quantity}, nevoie ${r.qty})`,
            });
          }
        }

        db.transaction(() => {
          persistScans(ticketId, 'SEND', resolved, username);
          for (const r of resolved) {
            const stock = db
              .prepare(`SELECT id, quantity FROM stock_items WHERE id = ?`)
              .get(r.stock.id) as { id: number; quantity: number };
            const newQty = stock.quantity - r.qty;
            db.prepare(
              `UPDATE stock_items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(newQty, stock.id);
            db.prepare(
              `INSERT INTO stock_movements
                (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
               VALUES (?, ?, ?, ?, 'SEND_OUT', ?, ?)`
            ).run(stock.id, ticketId, r.barcode, -r.qty, newQty, username);
            db.prepare(
              `UPDATE ticket_items SET sent_qty = ? WHERE ticket_id = ? AND stock_item_id = ?`
            ).run(r.qty, ticketId, r.stock.id);
          }
          db.prepare(
            `UPDATE tickets SET status = 'SENT', fix_comment = NULL, updated_at = datetime('now') WHERE id = ?`
          ).run(ticketId);
          addTicketHistory(ticketId, username, 'SEND', { comparison, scans: lines });
        })();
        break;
      }

      case 'DELIVER': {
        if (!can('user3')) return res.status(403).json({ error: 'Doar user3' });
        if (ticket.status !== 'SENT') {
          return res.status(400).json({ error: 'Status trebuie să fie SENT' });
        }
        if (!lines.length) return res.status(400).json({ error: 'Scanează ce s-a livrat' });

        const { resolved, errors } = resolveScans(lines);
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });

        db.transaction(() => {
          persistScans(ticketId, 'DELIVER', resolved, username);
          for (const r of resolved) {
            const existing = db
              .prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND stock_item_id = ?`)
              .get(ticketId, r.stock.id) as { id: number } | undefined;
            if (existing) {
              db.prepare(
                `UPDATE ticket_items SET delivered_qty = delivered_qty + ? WHERE id = ?`
              ).run(r.qty, existing.id);
            } else {
              db.prepare(
                `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, delivered_qty)
                 VALUES (?, ?, 0, ?)`
              ).run(ticketId, r.stock.id, r.qty);
            }
          }
          db.prepare(
            `UPDATE tickets SET status = 'DELIVERED', updated_at = datetime('now') WHERE id = ?`
          ).run(ticketId);
          addTicketHistory(ticketId, username, 'DELIVER', {
            scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty, name: x.stock.name })),
            comment,
          });
        })();
        break;
      }

      case 'RETURN_OUT': {
        if (!can('user4')) return res.status(403).json({ error: 'Doar user4' });
        if (ticket.status !== 'DELIVERED') {
          return res.status(400).json({ error: 'Status trebuie să fie DELIVERED' });
        }
        if (!lines.length) return res.status(400).json({ error: 'Scanează ce se returnează' });

        const { resolved, errors } = resolveScans(lines);
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });

        db.transaction(() => {
          persistScans(ticketId, 'RETURN_OUT', resolved, username);
          for (const r of resolved) {
            const existing = db
              .prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND stock_item_id = ?`)
              .get(ticketId, r.stock.id) as { id: number } | undefined;
            if (existing) {
              db.prepare(
                `UPDATE ticket_items SET return_out_qty = return_out_qty + ? WHERE id = ?`
              ).run(r.qty, existing.id);
            } else {
              db.prepare(
                `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, return_out_qty)
                 VALUES (?, ?, 0, ?)`
              ).run(ticketId, r.stock.id, r.qty);
            }
          }
          db.prepare(
            `UPDATE tickets SET status = 'RETURNING', updated_at = datetime('now') WHERE id = ?`
          ).run(ticketId);
          addTicketHistory(ticketId, username, 'RETURN_OUT', {
            scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty, name: x.stock.name })),
            comment,
          });
        })();
        break;
      }

      case 'RECEIVE_BACK': {
        if (!can('user2')) return res.status(403).json({ error: 'Doar user2' });
        if (ticket.status !== 'RETURNING') {
          return res.status(400).json({ error: 'Status trebuie să fie RETURNING' });
        }
        if (!lines.length) return res.status(400).json({ error: 'Scanează ce s-a primit înapoi' });

        const { resolved, errors } = resolveScans(lines);
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });

        db.transaction(() => {
          persistScans(ticketId, 'RECEIVE_BACK', resolved, username);
          for (const r of resolved) {
            const stock = db
              .prepare(`SELECT id, quantity FROM stock_items WHERE id = ?`)
              .get(r.stock.id) as { id: number; quantity: number };
            const newQty = stock.quantity + r.qty;
            db.prepare(
              `UPDATE stock_items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(newQty, stock.id);
            db.prepare(
              `INSERT INTO stock_movements
                (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
               VALUES (?, ?, ?, ?, 'RECEIVE_BACK', ?, ?)`
            ).run(stock.id, ticketId, r.barcode, r.qty, newQty, username);

            const existing = db
              .prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND stock_item_id = ?`)
              .get(ticketId, r.stock.id) as { id: number } | undefined;
            if (existing) {
              db.prepare(
                `UPDATE ticket_items SET received_back_qty = received_back_qty + ? WHERE id = ?`
              ).run(r.qty, existing.id);
            } else {
              db.prepare(
                `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, received_back_qty)
                 VALUES (?, ?, 0, ?)`
              ).run(ticketId, r.stock.id, r.qty);
            }
          }
          db.prepare(
            `UPDATE tickets SET status = 'CLOSED', updated_at = datetime('now') WHERE id = ?`
          ).run(ticketId);
          addTicketHistory(ticketId, username, 'RECEIVE_BACK', {
            scans: resolved.map((x) => ({ barcode: x.barcode, qty: x.qty, name: x.stock.name })),
            comment,
          });
        })();
        break;
      }

      case 'COMMENT': {
        if (!comment?.trim()) return res.status(400).json({ error: 'Comentariu obligatoriu' });
        addTicketHistory(ticketId, username, 'COMMENT', comment.trim());
        db.prepare(`UPDATE tickets SET updated_at = datetime('now') WHERE id = ?`).run(ticketId);
        break;
      }

      case 'CLOSED': {
        if (!can('admin', 'user2')) return res.status(403).json({ error: 'Acces interzis' });
        db.prepare(
          `UPDATE tickets SET status = 'CLOSED', updated_at = datetime('now') WHERE id = ?`
        ).run(ticketId);
        addTicketHistory(ticketId, username, 'CLOSED', comment);
        break;
      }

      default:
        return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
    }

    logActivity(username, role, `TICKET_${action}`, {
      ticketId,
      ticket_code: ticket.ticket_code,
      comment,
    });
    res.json({ ticket: loadTicket(ticketId) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ error: msg });
  }
});

export default router;
