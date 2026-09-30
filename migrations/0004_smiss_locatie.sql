-- SMISS LOCATIE (column T on RAPORT_SMISS_80, column AC on RAPORT_SMISS_01).
-- Where the fixed asset was registered. Additive; existing rows stay NULL until backfill.
ALTER TABLE smiss_catalog ADD COLUMN locatie TEXT;
