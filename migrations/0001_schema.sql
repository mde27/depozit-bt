-- Depozit BT D1 schema
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user1','user2','user3','user4')),
  company TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  place TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  comments TEXT,
  image_url TEXT,
  for_a INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ORDERED',
  created_by TEXT NOT NULL,
  fix_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_info (
  ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  pm_client TEXT,
  phones TEXT,
  pickup_address TEXT,
  delivery_address TEXT,
  pickup_county TEXT,
  pickup_locality TEXT,
  delivery_county TEXT,
  delivery_locality TEXT,
  pickup_date TEXT,
  delivery_date TEXT,
  time_interval TEXT,
  return_request INTEGER DEFAULT 0,
  return_details TEXT,
  comments TEXT,
  recipient TEXT
);

CREATE TABLE IF NOT EXISTS ticket_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  ordered_qty INTEGER NOT NULL DEFAULT 0,
  sent_qty INTEGER NOT NULL DEFAULT 0,
  delivered_qty INTEGER NOT NULL DEFAULT 0,
  return_out_qty INTEGER NOT NULL DEFAULT 0,
  received_back_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ticket_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT
);

CREATE TABLE IF NOT EXISTS ticket_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('SEND','DELIVER','RETURN_OUT','RECEIVE_BACK')),
  barcode TEXT NOT NULL,
  stock_item_id INTEGER REFERENCES stock_items(id),
  qty INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  ticket_id INTEGER REFERENCES tickets(id),
  barcode_scanned TEXT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  quantity_after INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_stock_barcode ON stock_items(barcode);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(stock_item_id);
