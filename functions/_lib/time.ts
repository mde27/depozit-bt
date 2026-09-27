/**
 * Helpers de fus orar. Timestamp-urile din DB vin din SQLite `datetime('now')`,
 * adică UTC în formatul `YYYY-MM-DD HH:MM:SS`. În UI / exporturi le afișăm
 * în ora României (Europe/Bucharest, EET/EEST).
 */
export const APP_TIME_ZONE = 'Europe/Bucharest';

const dtf = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function localParts(ms: number) {
  const out: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset (ms) al Europe/Bucharest față de UTC la momentul dat. */
function tzOffsetMs(ms: number): number {
  const p = localParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

function sqliteUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** `YYYY-MM-DD HH:MM:SS` (UTC, SQLite) → `YYYY-MM-DD HH:MM` ora României. */
export function formatLocal(value: unknown): string {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const p = localParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Începutul zilei locale `YYYY-MM-DD` (+ `addDays`) exprimat ca UTC SQLite. */
export function localDayStartUtc(date: string, addDays = 0): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Dată invalidă: ${date}`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3] + addDays);
  let t = guess - tzOffsetMs(guess);
  const off2 = tzOffsetMs(t);
  if (guess - off2 !== t) t = guess - off2;
  return sqliteUtc(t);
}

/** Data de azi (ora României) ca `YYYY-MM-DD`. */
export function todayLocal(): string {
  const p = localParts(Date.now());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
