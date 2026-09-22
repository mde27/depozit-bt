import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'depozit-bt-dev-secret-change-in-prod';
const COOKIE_NAME = 'depozit_session';
const isProd = process.env.NODE_ENV === 'production';
const cookieSecure =
  process.env.COOKIE_SECURE === 'true' ||
  (process.env.COOKIE_SECURE !== 'false' && isProd);

export type Role = 'admin' | 'user1' | 'user2' | 'user3' | 'user4';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  company: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, company: user.company },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/', secure: cookieSecure, sameSite: 'lax' });
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Neautentificat' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      company: payload.company ?? null,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Sesiune invalidă' });
  }
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acces interzis' });
    }
    next();
  };
}
