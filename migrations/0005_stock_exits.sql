-- Ieșire stoc: one closed exit (bon de ieșire) with its scanned lines. Additive only.
CREATE TABLE IF NOT EXISTS stock_exits (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'FINALIZAT', predat_de TEXT NOT NULL, predat_catre TEXT NOT NULL, destinatie TEXT NOT NULL, observatii TEXT, client_key TEXT UNIQUE, created_by_id INTEGER, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), finalized_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS stock_exit_items (id INTEGER PRIMARY KEY AUTOINCREMENT, exit_id INTEGER NOT NULL REFERENCES stock_exits(id), stock_item_id INTEGER NOT NULL REFERENCES stock_items(id), barcode TEXT, name TEXT NOT NULL, mijloc_fix TEXT, quantity INTEGER NOT NULL CHECK(quantity > 0), quantity_after INTEGER);
CREATE INDEX IF NOT EXISTS idx_stock_exit_items_exit ON stock_exit_items(exit_id);
CREATE INDEX IF NOT EXISTS idx_stock_exits_created ON stock_exits(created_at);
ALTER TABLE stock_movements ADD COLUMN stock_exit_id INTEGER REFERENCES stock_exits(id);
