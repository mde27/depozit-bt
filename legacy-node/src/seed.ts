import bcrypt from 'bcryptjs';
import { db, initSchema } from './db.js';

initSchema();

function clearAll() {
  db.exec(`
    DELETE FROM stock_movements;
    DELETE FROM activity_logs;
    DELETE FROM ticket_scans;
    DELETE FROM ticket_history;
    DELETE FROM ticket_items;
    DELETE FROM ticket_info;
    DELETE FROM tickets;
    DELETE FROM stock_items;
    DELETE FROM users;
  `);
}

clearAll();

const hash = (p: string) => bcrypt.hashSync(p, 10);

const users: [string, string, string, string | null][] = [
  ['admin', 'admin123', 'admin', null],
  ['user1', 'user123', 'user1', 'Requester Co'],
  ['user2', 'user123', 'user2', 'Warehouse'],
  ['user3', 'user123', 'user3', 'Courier'],
  ['user4', 'user123', 'user4', 'Return Desk'],
];

for (const [u, p, role, company] of users) {
  db.prepare(
    `INSERT INTO users (username, password_hash, role, company) VALUES (?, ?, ?, ?)`
  ).run(u, hash(p), role, company);
}

const insertStock = db.prepare(
  `INSERT INTO stock_items (sku, barcode, name, company, place, quantity, comments, for_a)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const stockSeed = [
  ['SKU-001', '5901234123457', 'Palet Euro 800x1200', 'Company A', 'Depozit Nord', 50, 'Standard', 1],
  ['SKU-002', '5901234123464', 'Cutie carton L', 'Company A', 'Depozit Nord', 200, null, 1],
  ['SKU-003', '5901234123471', 'Folie stretch 2kg', 'Company A', 'Depozit Sud', 80, null, 1],
  ['SKU-004', 'WH-BOX-M', 'Cutie carton M', 'Company B', 'Depozit Sud', 150, null, 0],
  ['SKU-005', 'WH-PAL-CHEP', 'Palet CHEP', 'Company B', 'Depozit Est', 40, 'Returnabil', 0],
  ['SKU-006', '5901234123488', 'Bandă adezivă 48mm', 'Company A', 'Depozit Nord', 300, null, 1],
  ['SKU-007', 'WH-RACK-BIN', 'Ladă plastic stivuibilă', 'Company B', 'Depozit Est', 60, null, 0],
  ['SKU-008', '5901234123495', 'Etichete termice 100x150', 'Company A', 'Depozit Sud', 500, 'Role', 1],
] as const;

const stockIds: number[] = [];
for (const row of stockSeed) {
  const info = insertStock.run(...row);
  const id = Number(info.lastInsertRowid);
  stockIds.push(id);
  db.prepare(
    `INSERT INTO stock_movements
      (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
     VALUES (?, NULL, ?, ?, 'INITIAL', ?, 'system')`
  ).run(id, row[1], row[5], row[5]);
}

// Sample ticket ORDERED (waiting for user2)
const t1 = db
  .prepare(
    `INSERT INTO tickets (ticket_code, client_name, status, created_by)
     VALUES ('T-SEED-ORDERED', 'SC Exemplu SRL', 'ORDERED', 'user1')`
  )
  .run();
const t1id = Number(t1.lastInsertRowid);
db.prepare(
  `INSERT INTO ticket_info (
    ticket_id, pm_client, phones, pickup_address, delivery_address,
    pickup_county, pickup_locality, delivery_county, delivery_locality,
    pickup_date, delivery_date, time_interval, return_request, return_details,
    comments, recipient
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
).run(
  t1id,
  'Ion Popescu',
  '0722123456 / 0311122334',
  'Str. Depozitului 1',
  'Bd. Unirii 10',
  'București',
  'Sector 1',
  'București',
  'Sector 3',
  '2026-09-23',
  '2026-09-24',
  '09:00-12:00',
  'Retur paleți goi',
  'Livrare standard',
  'Maria Ionescu'
);
db.prepare(
  `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty) VALUES (?, ?, ?)`
).run(t1id, stockIds[0], 5);
db.prepare(
  `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty) VALUES (?, ?, ?)`
).run(t1id, stockIds[1], 20);
db.prepare(
  `INSERT INTO ticket_history (ticket_id, username, action, details) VALUES (?, 'user1', 'ORDERED', 'Seed')`
).run(t1id);

// Sample mid-flow: SENT (courier queue)
const t2 = db
  .prepare(
    `INSERT INTO tickets (ticket_code, client_name, status, created_by)
     VALUES ('T-SEED-SENT', 'SC MidFlow SA', 'SENT', 'user1')`
  )
  .run();
const t2id = Number(t2.lastInsertRowid);
db.prepare(
  `INSERT INTO ticket_info (
    ticket_id, pm_client, phones, pickup_address, delivery_address,
    pickup_county, delivery_county, pickup_date, delivery_date, time_interval, comments, recipient
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  t2id,
  'Ana Vasile',
  '0733987654',
  'Depozit Nord',
  'Str. Clientului 5',
  'Ilfov',
  'Ilfov',
  '2026-09-22',
  '2026-09-22',
  '14:00-18:00',
  'În tranzit',
  'Gheorghe D.'
);
db.prepare(
  `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, sent_qty) VALUES (?, ?, ?, ?)`
).run(t2id, stockIds[2], 10, 10);
db.prepare(
  `INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, sent_qty) VALUES (?, ?, ?, ?)`
).run(t2id, stockIds[5], 50, 50);
// Decrement stock for seed SENT ticket
for (const [sid, qty] of [
  [stockIds[2], 10],
  [stockIds[5], 50],
] as const) {
  const stock = db.prepare(`SELECT quantity, barcode FROM stock_items WHERE id = ?`).get(sid) as {
    quantity: number;
    barcode: string;
  };
  const newQty = stock.quantity - qty;
  db.prepare(`UPDATE stock_items SET quantity = ? WHERE id = ?`).run(newQty, sid);
  db.prepare(
    `INSERT INTO stock_movements
      (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
     VALUES (?, ?, ?, ?, 'SEND_OUT', ?, 'user2')`
  ).run(sid, t2id, stock.barcode, -qty, newQty);
  db.prepare(
    `INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
     VALUES (?, 'SEND', ?, ?, ?, 'user2')`
  ).run(t2id, stock.barcode, sid, qty);
}
db.prepare(
  `INSERT INTO ticket_history (ticket_id, username, action, details) VALUES (?, 'user1', 'ORDERED', 'Seed')`
).run(t2id);
db.prepare(
  `INSERT INTO ticket_history (ticket_id, username, action, details) VALUES (?, 'user2', 'SEND', 'Seed sent')`
).run(t2id);

db.prepare(
  `INSERT INTO activity_logs (username, role, action, details) VALUES ('system', 'admin', 'SEED', 'Database seeded — barcode pipeline')`
).run();

console.log('Seed complete.');
console.log('Users: admin/admin123, user1–user4 / user123');
console.log(`Stock items: ${stockIds.length}`);
console.log('Tickets: T-SEED-ORDERED (ORDERED), T-SEED-SENT (SENT)');
