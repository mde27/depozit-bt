CREATE TABLE IF NOT EXISTS smiss_catalog (
  mijloc_fix TEXT PRIMARY KEY,
  mijloc_fix_orig TEXT,
  clasa TEXT,
  denumire1 TEXT NOT NULL,
  denumire2 TEXT,
  description TEXT,
  numar_serial TEXT,
  source_report TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_smiss_orig ON smiss_catalog(mijloc_fix_orig);
CREATE INDEX IF NOT EXISTS idx_smiss_denumire1 ON smiss_catalog(denumire1);

-- Extend stock_items (SQLite/D1 ALTER ADD COLUMN)
ALTER TABLE stock_items ADD COLUMN mijloc_fix TEXT;
ALTER TABLE stock_items ADD COLUMN mijloc_fix_orig TEXT;
ALTER TABLE stock_items ADD COLUMN name2 TEXT;
ALTER TABLE stock_items ADD COLUMN description TEXT;
ALTER TABLE stock_items ADD COLUMN source_from TEXT;
ALTER TABLE stock_items ADD COLUMN is_uncatalogued INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_stock_mijloc ON stock_items(mijloc_fix);
CREATE INDEX IF NOT EXISTS idx_stock_mijloc_orig ON stock_items(mijloc_fix_orig);
CREATE INDEX IF NOT EXISTS idx_stock_uncatalogued ON stock_items(is_uncatalogued);
