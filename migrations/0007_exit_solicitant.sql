-- Ieșire stoc: cine a cerut articolele (Solicitant). Ieșirile vechi rămân NULL („—”). Additive only.
ALTER TABLE stock_exits ADD COLUMN solicitant TEXT;
