import { APP_TIME_ZONE } from './dates';

/**
 * Timestamp-urile din DB vin din SQLite `datetime('now')`: UTC, fără fus orar
 * (`YYYY-MM-DD HH:MM:SS`). `new Date('2026-09-28 21:15:03')` le-ar citi ca oră
 * locală, deci le marcăm explicit ca UTC. ISO cu `Z`/offset rămân neschimbate.
 */
export function parseDbTimestamp(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  let s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const fmt = new Intl.DateTimeFormat('ro-RO', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Afișează un timestamp în ora României (Europe/Bucharest, indiferent de fusul
 * telefonului), în același format ca până acum: `YYYY-MM-DD HH:MM:SS`
 * (`date` → `YYYY-MM-DD`, `time` → `HH:MM:SS`). Valorile neparsabile se afișează ca atare.
 */
export function formatRoTime(
  value: string | number | Date | null | undefined,
  mode: 'datetime' | 'date' | 'time' = 'datetime'
): string {
  const d = parseDbTimestamp(value);
  if (!d) return value == null ? '' : String(value);
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  return mode === 'date' ? date : mode === 'time' ? time : `${date} ${time}`;
}
