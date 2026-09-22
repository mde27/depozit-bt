import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import {
  authRequired,
  clearSessionCookie,
  setSessionCookie,
  signToken,
  type AuthUser,
  type Role,
} from '../auth.js';
import { logActivity } from '../logger.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username și parolă obligatorii' });
  }
  const row = db
    .prepare(`SELECT id, username, password_hash, role, company FROM users WHERE username = ?`)
    .get(username) as
    | { id: number; username: string; password_hash: string; role: Role; company: string | null }
    | undefined;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Credențiale invalide' });
  }

  const user: AuthUser = {
    id: row.id,
    username: row.username,
    role: row.role,
    company: row.company,
  };
  const token = signToken(user);
  setSessionCookie(res, token);
  logActivity(user.username, user.role, 'LOGIN', null);
  res.json({ user });
});

router.post('/logout', authRequired, (req, res) => {
  logActivity(req.user!.username, req.user!.role, 'LOGOUT', null);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

export default router;
