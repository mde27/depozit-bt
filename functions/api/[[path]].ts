import type { AuthUser, Env, Role } from '../_lib/types';
import {
  clearSessionCookie,
  error,
  isSecureRequest,
  json,
  readJson,
  requireUser,
  setSessionCookie,
} from '../_lib/http';
import { hashPassword, signJwt, verifyPassword } from '../_lib/crypto';
import {
  createTicket,
  listTickets,
  loadTicket,
  logActivity,
  resubmitTicket,
  scanPreview,
  ticketAction,
} from '../_lib/tickets';
import { lookupCatalog, normalizeScanCode, receiveStock } from '../_lib/catalog';

type Ctx = EventContext<Env, string, Record<string, unknown>>;

function pathParts(url: URL): string[] {
  // /api/... → strip leading api
  return url.pathname.replace(/^\/+/, '').split('/').filter(Boolean).slice(1);
}

async function handleAuth(ctx: Ctx, parts: string[], method: string): Promise<Response> {
  const { request, env } = ctx;
  const secure = isSecureRequest(request);

  if (parts[0] === 'login' && method === 'POST') {
    const body = await readJson<{ username?: string; password?: string }>(request);
    if (!body.username || !body.password) return error('Username și parolă obligatorii');
    let row: {
      id: number;
      username: string;
      password_hash: string;
      role: Role;
      company: string | null;
    } | null;
    try {
      row = await env.DB.prepare(
        `SELECT id, username, password_hash, role, company FROM users WHERE username = ?`
      )
        .bind(body.username)
        .first();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return error(
        `Baza D1 nu are tabelele încă (rulează migrations). Detaliu: ${msg}`,
        503
      );
    }
    if (!row || !(await verifyPassword(body.password, row.password_hash))) {
      return error('Credențiale invalide', 401);
    }
    const user: AuthUser = {
      id: row.id,
      username: row.username,
      role: row.role,
      company: row.company,
    };
    const secret = env.JWT_SECRET || 'depozit-bt-dev-secret-change-in-prod';
    const token = await signJwt(
      { id: user.id, username: user.username, role: user.role, company: user.company },
      secret
    );
    await logActivity(env.DB, user.username, user.role, 'LOGIN', null);
    return json(
      { user },
      200,
      { 'Set-Cookie': setSessionCookie(token, secure) }
    );
  }

  if (parts[0] === 'logout' && method === 'POST') {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) {
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) });
    }
    await logActivity(env.DB, auth.user.username, auth.user.role, 'LOGOUT', null);
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) });
  }

  if (parts[0] === 'me' && method === 'GET') {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;
    return json({ user: auth.user });
  }

  return error('Not found', 404);
}

async function handleStock(ctx: Ctx, parts: string[], method: string): Promise<Response> {
  const { request, env } = ctx;
  const auth = await requireUser(request, env);
  if (auth instanceof Response) return auth;

  if (method === 'GET' && parts[0] === 'by-barcode' && parts[1]) {
    const item = await env.DB.prepare(`SELECT * FROM stock_items WHERE barcode = ?`)
      .bind(decodeURIComponent(parts[1]))
      .first();
    if (!item) return error('Barcode necunoscut', 404);
    return json({ item });
  }

  if (method === 'GET' && parts[0] && parts[1] === 'movements') {
    const id = Number(parts[0]);
    const item = await env.DB.prepare(`SELECT * FROM stock_items WHERE id = ?`).bind(id).first();
    if (!item) return error('Articol negăsit', 404);
    const { results: movements } = await env.DB.prepare(
      `SELECT m.*, t.ticket_code
       FROM stock_movements m
       LEFT JOIN tickets t ON t.id = m.ticket_id
       WHERE m.stock_item_id = ?
       ORDER BY m.id DESC`
    )
      .bind(id)
      .all();
    return json({ item, movements });
  }


  if (method === 'POST' && parts[0] === 'receive') {
    if (auth.user.role !== 'admin' && auth.user.role !== 'user2') {
      return error('Acces interzis — doar admin / user2', 403);
    }
    const body = await readJson<{
      code?: string;
      quantity?: number;
      source_from?: string;
      place?: string;
      company?: string;
    }>(request);
    if (!body.code) return error('Cod obligatoriu');
    if (!body.source_from?.trim()) {
      return error('Câmpul „de unde a venit” (source_from) este obligatoriu');
    }
    try {
      const result = await receiveStock(env.DB, auth.user, {
        code: body.code,
        quantity: body.quantity,
        source_from: body.source_from,
        place: body.place,
        company: body.company,
      });
      return json(result, 201);
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      const msg = err.message || String(e);
      if (/no such (table|column)/i.test(msg)) {
        return error(
          'Schema stoc/catalog incompletă. Aplică migrations/0003_smiss_catalog.sql.',
          503
        );
      }
      return error(msg, err.status || 400);
    }
  }

  if (method === 'GET' && parts.length === 0) {
    const place = new URL(request.url).searchParams.get('place')?.trim();
    const { results: items } = place
      ? await env.DB.prepare(`SELECT * FROM stock_items WHERE place = ? ORDER BY name`)
          .bind(place)
          .all()
      : await env.DB.prepare(`SELECT * FROM stock_items ORDER BY name`).all();
    return json({ items });
  }

  return error('Not found', 404);
}

async function handleTickets(ctx: Ctx, parts: string[], method: string): Promise<Response> {
  const { request, env } = ctx;
  const auth = await requireUser(request, env);
  if (auth instanceof Response) return auth;

  try {
    if (method === 'GET' && parts.length === 0) {
      const tickets = await listTickets(env.DB, auth.user, new URL(request.url).searchParams);
      return json({ tickets });
    }

    if (method === 'POST' && parts.length === 0) {
      const body = await readJson(request);
      const ticket = await createTicket(env.DB, auth.user, body);
      return json({ ticket }, 201);
    }

    const id = Number(parts[0]);
    if (!id) return error('Not found', 404);

    if (method === 'GET' && parts.length === 1) {
      const ticket = await loadTicket(env.DB, id);
      if (!ticket) return error('Tichet negăsit', 404);
      return json({ ticket });
    }

    if (method === 'PUT' && parts.length === 1) {
      const body = await readJson(request);
      const ticket = await resubmitTicket(env.DB, auth.user, id, body);
      return json({ ticket });
    }

    if (method === 'POST' && parts[1] === 'scan-preview') {
      const body = await readJson<{ scans?: { barcode: string; qty: number }[] }>(request);
      const result = await scanPreview(env.DB, id, body.scans || []);
      return json(result);
    }

    if (method === 'POST' && parts[1] === 'actions') {
      const body = await readJson(request);
      const ticket = await ticketAction(env.DB, auth.user, id, body);
      return json({ ticket });
    }

    return error('Not found', 404);
  } catch (e: unknown) {
    const err = e as Error & { status?: number; comparison?: unknown; errors?: unknown };
    const status = err.status || 400;
    return error(err.message || 'Eroare', status, {
      ...(err.comparison ? { comparison: err.comparison } : {}),
      ...(err.errors ? { errors: err.errors } : {}),
    });
  }
}


async function handleCatalog(ctx: Ctx, parts: string[], method: string): Promise<Response> {
  const { request, env } = ctx;
  const auth = await requireUser(request, env);
  if (auth instanceof Response) return auth;

  if (method === 'GET' && parts[0] === 'lookup') {
    const code = normalizeScanCode(new URL(request.url).searchParams.get('code') || '');
    if (!code) return error('Parametrul code este obligatoriu');
    try {
      const item = await lookupCatalog(env.DB, code);
      if (!item) return json({ found: false, code });
      return json({ found: true, item, code });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no such table/i.test(msg)) {
        return error(
          'Tabelul smiss_catalog lipsește. Aplică migrations/0003_smiss_catalog.sql și seed-ul SMISS.',
          503
        );
      }
      throw e;
    }
  }

  return error('Not found', 404);
}

async function handleLogs(ctx: Ctx, method: string): Promise<Response> {
  const { request, env } = ctx;
  const auth = await requireUser(request, env);
  if (auth instanceof Response) return auth;
  if (method !== 'GET') return error('Method not allowed', 405);
  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  let logs;
  if (q) {
    const like = `%${q}%`;
    const { results } = await env.DB.prepare(
      `SELECT * FROM activity_logs
       WHERE username LIKE ? OR action LIKE ? OR details LIKE ? OR role LIKE ?
       ORDER BY id DESC LIMIT 500`
    )
      .bind(like, like, like, like)
      .all();
    logs = results;
  } else {
    const { results } = await env.DB.prepare(
      `SELECT * FROM activity_logs ORDER BY id DESC LIMIT 500`
    ).all();
    logs = results;
  }
  return json({ logs });
}

async function handleUsers(ctx: Ctx, method: string): Promise<Response> {
  const { request, env } = ctx;
  const auth = await requireUser(request, env);
  if (auth instanceof Response) return auth;
  if (auth.user.role !== 'admin') return error('Acces interzis', 403);

  if (method === 'GET') {
    const { results: users } = await env.DB.prepare(
      `SELECT id, username, role, company, created_at FROM users ORDER BY id`
    ).all();
    return json({ users });
  }

  if (method === 'POST') {
    const body = await readJson<{
      username?: string;
      password?: string;
      role?: string;
      company?: string;
    }>(request);
    if (!body.username || !body.password || !body.role) {
      return error('username, password, role obligatorii');
    }
    const valid = ['admin', 'user1', 'user2', 'user3', 'user4'];
    if (!valid.includes(body.role)) return error('Rol invalid');
    const hash = await hashPassword(body.password);
    try {
      const info = await env.DB.prepare(
        `INSERT INTO users (username, password_hash, role, company) VALUES (?, ?, ?, ?)`
      )
        .bind(body.username, hash, body.role, body.company ?? null)
        .run();
      await logActivity(env.DB, auth.user.username, auth.user.role, 'CREATE_USER', {
        username: body.username,
        role: body.role,
      });
      return json(
        {
          id: info.meta.last_row_id,
          username: body.username,
          role: body.role,
          company: body.company ?? null,
        },
        201
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE/i.test(msg)) return error('Username există deja', 409);
      throw e;
    }
  }

  return error('Method not allowed', 405);
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const method = ctx.request.method.toUpperCase();
  const parts = pathParts(url);

  if (parts.length === 1 && parts[0] === 'health' && method === 'GET') {
    return json({
      ok: true,
      name: 'Depozit BT',
      flow: 'barcode-pipeline',
      runtime: 'cloudflare-pages',
      hasDb: Boolean(ctx.env.DB),
      hasJwt: Boolean(ctx.env.JWT_SECRET),
    });
  }

  if (!ctx.env.DB) {
    return error(
      'Baza D1 nu este legată. În Pages → Settings → Bindings adaugă D1 cu numele DB, apoi Redeploy.',
      503
    );
  }

  try {
    if (parts[0] === 'auth') return handleAuth(ctx, parts.slice(1), method);
    if (parts[0] === 'stock') return handleStock(ctx, parts.slice(1), method);
    if (parts[0] === 'catalog') return handleCatalog(ctx, parts.slice(1), method);
    if (parts[0] === 'tickets') return handleTickets(ctx, parts.slice(1), method);
    if (parts[0] === 'logs') return handleLogs(ctx, method);
    if (parts[0] === 'users') return handleUsers(ctx, method);
    return error('Not found', 404);
  } catch (e: unknown) {
    console.error(e);
    return error(e instanceof Error ? e.message : 'Eroare server', 500);
  }
};
