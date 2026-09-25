import type { AuthUser, Env } from './types';
import { verifyJwt } from './crypto';

const COOKIE = 'depozit_session';

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}

export function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.get('Cookie') || '';
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

export function setSessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 3600}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export async function requireUser(
  req: Request,
  env: Env
): Promise<{ user: AuthUser } | Response> {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE];
  if (!token) return error('Neautentificat', 401);
  const secret = env.JWT_SECRET || 'depozit-bt-dev-secret-change-in-prod';
  const payload = await verifyJwt<{
    id: number;
    username: string;
    role: AuthUser['role'];
    company: string | null;
  }>(token, secret);
  if (!payload?.id || !payload.username || !payload.role) {
    return error('Sesiune invalidă', 401);
  }
  // Rol / firmă se recitesc din DB, ca modificările făcute de admin să se aplice imediat
  // (fără re-login). Dacă DB nu e disponibil, cădem pe valorile din JWT.
  let row: { id: number; username: string; role: AuthUser['role']; company: string | null } | null;
  try {
    row = await env.DB.prepare(`SELECT id, username, role, company FROM users WHERE id = ?`)
      .bind(payload.id)
      .first();
  } catch {
    return {
      user: {
        id: payload.id,
        username: payload.username,
        role: payload.role,
        company: payload.company ?? null,
      },
    };
  }
  if (!row) return error('Sesiune invalidă', 401);
  return {
    user: {
      id: row.id,
      username: row.username,
      role: row.role,
      company: row.company ?? null,
    },
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get('X-Forwarded-Proto') || new URL(req.url).protocol;
  return proto.includes('https');
}
