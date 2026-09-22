import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { authRequired, requireRoles, type Role } from '../auth.js';
import { logActivity } from '../logger.js';

const VALID: Role[] = ['admin', 'user1', 'user2', 'user3', 'user4'];

const router = Router();

router.get('/', authRequired, requireRoles('admin'), (_req, res) => {
  const users = db
    .prepare(`SELECT id, username, role, company, created_at FROM users ORDER BY id`)
    .all();
  res.json({ users });
});

router.post('/', authRequired, requireRoles('admin'), (req, res) => {
  const { username, password, role, company } = req.body ?? {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, role obligatorii' });
  }
  if (!VALID.includes(role)) {
    return res.status(400).json({ error: 'Rol invalid' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, role, company) VALUES (?, ?, ?, ?)`
      )
      .run(username, hash, role as Role, company ?? null);
    logActivity(req.user!.username, req.user!.role, 'CREATE_USER', { username, role });
    res.status(201).json({ id: info.lastInsertRowid, username, role, company: company ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username există deja' });
    }
    throw e;
  }
});

export default router;
