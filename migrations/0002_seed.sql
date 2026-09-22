-- Seed users (passwords: admin/admin123, user1–4/user123)
-- Hash format: pbkdf2$iterations$saltB64$hashB64 (Web Crypto PBKDF2-SHA256)

DELETE FROM stock_movements;
DELETE FROM activity_logs;
DELETE FROM ticket_scans;
DELETE FROM ticket_history;
DELETE FROM ticket_items;
DELETE FROM ticket_info;
DELETE FROM tickets;
DELETE FROM stock_items;
DELETE FROM users;

INSERT INTO users (username, password_hash, role, company) VALUES
  ('admin', 'pbkdf2$100000$ZGVwb3ppdC1idC1zYWx0LWFkbWluLTAx$Ik4o3KzVLe8WmiqXwxqGfx1oQE7eqmQ0SalVZCY8PZw=', 'admin', NULL),
  ('user1', 'pbkdf2$100000$ZGVwb3ppdC1idC1zYWx0LXVzZXJ4eC0wMQ==$wpu4TmEUFGr/A/oIv2/kgpF/HBaFtxprYZMUxpSYkSk=', 'user1', 'Requester Co'),
  ('user2', 'pbkdf2$100000$ZGVwb3ppdC1idC1zYWx0LXVzZXJ4eC0wMQ==$wpu4TmEUFGr/A/oIv2/kgpF/HBaFtxprYZMUxpSYkSk=', 'user2', 'Warehouse'),
  ('user3', 'pbkdf2$100000$ZGVwb3ppdC1idC1zYWx0LXVzZXJ4eC0wMQ==$wpu4TmEUFGr/A/oIv2/kgpF/HBaFtxprYZMUxpSYkSk=', 'user3', 'Courier'),
  ('user4', 'pbkdf2$100000$ZGVwb3ppdC1idC1zYWx0LXVzZXJ4eC0wMQ==$wpu4TmEUFGr/A/oIv2/kgpF/HBaFtxprYZMUxpSYkSk=', 'user4', 'Return Desk');

INSERT INTO stock_items (sku, barcode, name, company, place, quantity, comments, for_a) VALUES
  ('SKU-001', '5901234123457', 'Palet Euro 800x1200', 'Company A', 'Depozit Nord', 50, 'Standard', 1),
  ('SKU-002', '5901234123464', 'Cutie carton L', 'Company A', 'Depozit Nord', 200, NULL, 1),
  ('SKU-003', '5901234123471', 'Folie stretch 2kg', 'Company A', 'Depozit Sud', 80, NULL, 1),
  ('SKU-004', 'WH-BOX-M', 'Cutie carton M', 'Company B', 'Depozit Sud', 150, NULL, 0),
  ('SKU-005', 'WH-PAL-CHEP', 'Palet CHEP', 'Company B', 'Depozit Est', 40, 'Returnabil', 0),
  ('SKU-006', '5901234123488', 'Bandă adezivă 48mm', 'Company A', 'Depozit Nord', 300, NULL, 1),
  ('SKU-007', 'WH-RACK-BIN', 'Ladă plastic stivuibilă', 'Company B', 'Depozit Est', 60, NULL, 0),
  ('SKU-008', '5901234123495', 'Etichete termice 100x150', 'Company A', 'Depozit Sud', 500, 'Role', 1);

INSERT INTO stock_movements (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
SELECT id, NULL, barcode, quantity, 'INITIAL', quantity, 'system' FROM stock_items;

INSERT INTO tickets (ticket_code, client_name, status, created_by)
VALUES ('T-SEED-ORDERED', 'SC Exemplu SRL', 'ORDERED', 'user1');

INSERT INTO ticket_info (
  ticket_id, pm_client, phones, pickup_address, delivery_address,
  pickup_county, pickup_locality, delivery_county, delivery_locality,
  pickup_date, delivery_date, time_interval, return_request, return_details, comments, recipient
) VALUES (
  (SELECT id FROM tickets WHERE ticket_code = 'T-SEED-ORDERED'),
  'Ion Popescu', '0722123456 / 0311122334', 'Str. Depozitului 1', 'Bd. Unirii 10',
  'București', 'Sector 1', 'București', 'Sector 3',
  '2026-09-23', '2026-09-24', '09:00-12:00', 1, 'Retur paleți goi', 'Livrare standard', 'Maria Ionescu'
);

INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty)
SELECT (SELECT id FROM tickets WHERE ticket_code = 'T-SEED-ORDERED'), id, 5 FROM stock_items WHERE sku = 'SKU-001';
INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty)
SELECT (SELECT id FROM tickets WHERE ticket_code = 'T-SEED-ORDERED'), id, 20 FROM stock_items WHERE sku = 'SKU-002';

INSERT INTO ticket_history (ticket_id, username, action, details)
SELECT id, 'user1', 'ORDERED', 'Seed' FROM tickets WHERE ticket_code = 'T-SEED-ORDERED';

INSERT INTO tickets (ticket_code, client_name, status, created_by)
VALUES ('T-SEED-SENT', 'SC MidFlow SA', 'SENT', 'user1');

INSERT INTO ticket_info (
  ticket_id, pm_client, phones, pickup_address, delivery_address,
  pickup_county, delivery_county, pickup_date, delivery_date, time_interval, comments, recipient
) VALUES (
  (SELECT id FROM tickets WHERE ticket_code = 'T-SEED-SENT'),
  'Ana Vasile', '0733987654', 'Depozit Nord', 'Str. Clientului 5',
  'Ilfov', 'Ilfov', '2026-09-22', '2026-09-22', '14:00-18:00', 'În tranzit', 'Gheorghe D.'
);

INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, sent_qty)
SELECT (SELECT id FROM tickets WHERE ticket_code = 'T-SEED-SENT'), id, 10, 10 FROM stock_items WHERE sku = 'SKU-003';
INSERT INTO ticket_items (ticket_id, stock_item_id, ordered_qty, sent_qty)
SELECT (SELECT id FROM tickets WHERE ticket_code = 'T-SEED-SENT'), id, 50, 50 FROM stock_items WHERE sku = 'SKU-006';

-- Adjust stock for seed SENT ticket (10 of SKU-003, 50 of SKU-006)
UPDATE stock_items SET quantity = quantity - 10 WHERE sku = 'SKU-003';
UPDATE stock_items SET quantity = quantity - 50 WHERE sku = 'SKU-006';

INSERT INTO stock_movements (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
SELECT s.id, t.id, s.barcode, -10, 'SEND_OUT', s.quantity, 'user2'
FROM stock_items s, tickets t WHERE s.sku = 'SKU-003' AND t.ticket_code = 'T-SEED-SENT';

INSERT INTO stock_movements (stock_item_id, ticket_id, barcode_scanned, delta, reason, quantity_after, created_by)
SELECT s.id, t.id, s.barcode, -50, 'SEND_OUT', s.quantity, 'user2'
FROM stock_items s, tickets t WHERE s.sku = 'SKU-006' AND t.ticket_code = 'T-SEED-SENT';

INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
SELECT t.id, 'SEND', s.barcode, s.id, 10, 'user2'
FROM tickets t, stock_items s WHERE t.ticket_code = 'T-SEED-SENT' AND s.sku = 'SKU-003';

INSERT INTO ticket_scans (ticket_id, stage, barcode, stock_item_id, qty, created_by)
SELECT t.id, 'SEND', s.barcode, s.id, 50, 'user2'
FROM tickets t, stock_items s WHERE t.ticket_code = 'T-SEED-SENT' AND s.sku = 'SKU-006';

INSERT INTO ticket_history (ticket_id, username, action, details)
SELECT id, 'user1', 'ORDERED', 'Seed' FROM tickets WHERE ticket_code = 'T-SEED-SENT';
INSERT INTO ticket_history (ticket_id, username, action, details)
SELECT id, 'user2', 'SEND', 'Seed sent' FROM tickets WHERE ticket_code = 'T-SEED-SENT';

INSERT INTO activity_logs (username, role, action, details)
VALUES ('system', 'admin', 'SEED', 'D1 database seeded — barcode pipeline');
