-- Ieșire stoc: notă opțională pe fiecare linie (ex. ce este un articol fără cod BT). Additive only.
ALTER TABLE stock_exit_items ADD COLUMN observatii TEXT;
