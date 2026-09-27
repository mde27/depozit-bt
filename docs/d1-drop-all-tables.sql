-- DANGER: deletes ALL app tables and ALL data in the database you run it on.
-- Use ONLY as step 3 of "Restore a weekly backup into the LIVE database"
-- in docs/BACKUP-RESTORE.md, right before importing a backup .sql file.
-- Order matters: child tables first, then the tables they point to.
PRAGMA defer_foreign_keys = true;
DROP TABLE IF EXISTS ticket_scans;
DROP TABLE IF EXISTS ticket_history;
DROP TABLE IF EXISTS ticket_items;
DROP TABLE IF EXISTS ticket_info;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS stock_items;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS smiss_catalog;
DROP TABLE IF EXISTS d1_migrations;
