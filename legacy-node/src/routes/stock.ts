import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

/**
 * All authenticated roles can view stock.
 * Optional ?place= filter. Lookup by barcode: GET /api/stock/by-barcode/:code
 */
router.get('/', authRequired, (req, res) => {
  const place = String(req.query.place ?? '').trim();
  let items;
  if (place) {
    items = db
      .prepare(`SELECT * FROM stock_items WHERE place = ? ORDER BY name`)
      .all(place);
  } else {
    items = db.prepare(`SELECT * FROM stock_items ORDER BY name`).all();
  }
  res.json({ items });
});

router.get('/by-barcode/:code', authRequired, (req, res) => {
  const code = String(req.params.code ?? '').trim();
  const item = db.prepare(`SELECT * FROM stock_items WHERE barcode = ?`).get(code);
  if (!item) return res.status(404).json({ error: 'Barcode necunoscut' });
  res.json({ item });
});

router.get('/:id/movements', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`SELECT * FROM stock_items WHERE id = ?`).get(id);
  if (!item) return res.status(404).json({ error: 'Articol negăsit' });
  const movements = db
    .prepare(
      `SELECT m.*, t.ticket_code
       FROM stock_movements m
       LEFT JOIN tickets t ON t.id = m.ticket_id
       WHERE m.stock_item_id = ?
       ORDER BY m.id DESC`
    )
    .all(id);
  res.json({ item, movements });
});

export default router;
