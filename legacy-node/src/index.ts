import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');
const projectRoot = path.join(serverRoot, '..');

// Load env: project root first, then server/.env overrides
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(serverRoot, '.env') });

const { initSchema, db, DB_PATH } = await import('./db.js');
const { default: authRoutes } = await import('./routes/auth.js');
const { default: stockRoutes } = await import('./routes/stock.js');
const { default: ticketRoutes } = await import('./routes/tickets.js');
const { default: logRoutes } = await import('./routes/logs.js');
const { default: userRoutes } = await import('./routes/users.js');

initSchema();

const userCount = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
if (userCount === 0) {
  console.log('No users found — running seed...');
  await import('./seed.js');
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';

const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const originEnv = process.env.CLIENT_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
const corsOrigins = originEnv?.length ? originEnv : isProd ? false : defaultDevOrigins;

app.use(
  cors({
    origin: corsOrigins === false ? false : corsOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    name: 'Depozit BT',
    flow: 'barcode-pipeline',
    env: process.env.NODE_ENV || 'development',
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/users', userRoutes);

// Production: serve Vite build from server/public
const publicDir = path.join(serverRoot, 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir, { index: false, maxAge: isProd ? '1h' : 0 }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
} else if (isProd) {
  console.warn(
    'Warning: server/public/index.html missing — run `npm run build` from project root.'
  );
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Eroare server', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`Depozit BT listening on http://localhost:${PORT}`);
  console.log(`  NODE_ENV=${process.env.NODE_ENV || 'development'}  db=${DB_PATH}`);
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    console.log(`  static UI: ${publicDir}`);
  }
});
