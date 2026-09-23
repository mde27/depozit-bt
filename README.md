# Depozit BT — Cloudflare Pages + D1

Warehouse ticketing with a barcode multi-role pipeline, running on **Cloudflare Pages** (static React) + **Pages Functions** (API) + **D1** (SQLite).

## Architecture

| Layer | Tech |
|-------|------|
| UI | React 19 + Vite + Tailwind → `dist/` |
| API | `functions/api/[[path]].ts` (Pages Functions) |
| DB | Cloudflare D1 (`DB` binding) |
| Auth | PBKDF2 (Web Crypto) + HS256 JWT in httpOnly cookie |

Roles / flow unchanged: **user1** create → **user2** SEND (± NEEDS_FIX) → **user3** DELIVER → **user4** RETURN_OUT → **user2** RECEIVE_BACK → CLOSED.  
Stock changes **only** on user2 `SEND_OUT` / `RECEIVE_BACK`.

The old Express + better-sqlite3 app lives in `legacy-node/` (not used for CF deploy).

## Logins (after seed migration)

| User | Password | Role |
|------|----------|------|
| admin | admin123 | admin |
| user1–user4 | user123 | user1…user4 |

## Project layout

```
depozit-bt/
  client/                 # React app
  functions/
    api/[[path]].ts       # All /api/* routes
    _lib/                 # crypto, http, tickets (D1)
  migrations/             # D1 SQL (schema + seed)
  dist/                   # Vite build output (Pages)
  wrangler.toml
  legacy-node/            # old Express server (reference only)
```

## 1) One-time Cloudflare setup

### Create D1 database

```bash
npx wrangler login
npx wrangler d1 create depozit-bt
```

Copy the printed `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "depozit-bt"
database_id = "<paste-id-here>"
migrations_dir = "migrations"
```

### Apply migrations (schema + seed)

```bash
# Local (for wrangler pages dev)
npm run db:migrate:local

# Production D1
npm run db:migrate:remote
```

### JWT secret

```bash
# Production Pages project secret
npx wrangler pages secret put JWT_SECRET
# paste a long random string when prompted
```

For local `pages dev`, `[vars].JWT_SECRET` in `wrangler.toml` is used (dev only).

## 2) Connect GitHub → Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select the repo.
4. Build settings:
   - **Framework preset:** Vite (or None)
   - **Build command:** `npm run install:all && npm run build`  
     (or `cd client && npm ci && npm run build` if you prefer)
   - **Build output directory:** `dist`
5. **Settings → Functions:** enabled automatically when `functions/` exists.
6. **Settings → Bindings → D1:** bind `DB` → database `depozit-bt`  
   (or rely on `wrangler.toml` when deploying via Wrangler).
7. **Settings → Environment variables / Secrets:** `JWT_SECRET`.
8. Deploy. Then **Custom domains** → add `depozit.yourdomain.com` (HTTPS included — required for camera barcodes).

### Alternative: deploy from CLI

```bash
npm run install:all
npm run build
npx wrangler pages deploy dist --project-name=depozit-bt
```

Ensure the Pages project has the D1 binding `DB` and secret `JWT_SECRET`.

## 3) Local development

```bash
npm run install:all
npm run db:migrate:local
npm run pages:dev
# → http://localhost:8788  (static + Functions + local D1)
```

Or split:

```bash
# Terminal A — API + D1
npm run pages:dev

# Terminal B — Vite HMR (proxies /api → :8788)
npm run dev:client
# → http://localhost:5173
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Build client → `dist/` |
| `npm run pages:dev` | Local Pages + Functions + D1 |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run db:migrate:remote` | Apply D1 migrations to prod |
| `npm run deploy` | Build + `wrangler pages deploy dist` |
| `npm run typecheck:functions` | Typecheck Pages Functions |

## Camera barcodes

`html5-qrcode` on scan pages. Requires **HTTPS** (Cloudflare custom domain) or localhost. Manual entry remains as fallback.

## Status flow

```
ORDERED → (SEND match) SENT → DELIVERED → RETURNING → CLOSED
   ↑________ NEEDS_FIX (SEND_WITH_COMMENT) _________|
```

## Known gaps / notes

- Replace placeholder `database_id` in `wrangler.toml` before remote migrate/deploy.
- D1 has no Node `better-sqlite3`; all API code uses `env.DB` (Workers runtime only).
- Full E2E against remote D1 needs your Cloudflare account; local `pages:dev` + migrations is the supported path.
- `legacy-node/` is obsolete for CF hosting.

## SMISS catalog + Intrare stoc

Secondary D1 table `smiss_catalog` (migration `0003_smiss_catalog.sql`) powers scan-to-add on arrival.

1. Apply schema: paste `migrations/d1-steps-0003/*.sql` one-by-one in D1 Console, **or** `npm run db:migrate:remote` when wrangler is logged in.
2. Import catalog seed from Desktop zip `smiss-catalog-sql.zip` (or regenerate with `npm run smiss:build`). Paste each `seed_NNN.sql` in D1 Console.
3. UI: **Intrare stoc** (`/stock/receive`) for admin + user2 � scan code, fill �de unde a venit�, confirm.
