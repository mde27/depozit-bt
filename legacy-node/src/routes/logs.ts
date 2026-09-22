import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

router.get('/', authRequired, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT * FROM activity_logs
         WHERE username LIKE ? OR action LIKE ? OR details LIKE ? OR role LIKE ?
         ORDER BY id DESC LIMIT 500`
      )
      .all(like, like, like, like);
  } else {
    rows = db.prepare(`SELECT * FROM activity_logs ORDER BY id DESC LIMIT 500`).all();
  }
  res.json({ logs: rows });
});

export default router;
