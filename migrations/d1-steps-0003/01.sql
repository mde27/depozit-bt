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
