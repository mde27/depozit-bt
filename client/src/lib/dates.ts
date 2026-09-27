/** Date calendaristice în ora României, indiferent de fusul orar al telefonului. */
export const APP_TIME_ZONE = 'Europe/Bucharest';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Azi, ca `YYYY-MM-DD` (Europe/Bucharest). */
export function todayRo(): string {
  return fmt.format(new Date());
}

function parse(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, day };
}

function iso(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const { y, m, day } = parse(date);
  return iso(y, m, day + days);
}

export type PeriodPreset = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'custom';

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: 'Azi' },
  { key: 'last7', label: 'Ultimele 7 zile' },
  { key: 'thisMonth', label: 'Luna curentă' },
  { key: 'lastMonth', label: 'Luna trecută' },
  { key: 'custom', label: 'Personalizat' },
];

export function presetRange(preset: PeriodPreset, today = todayRo()): { from: string; to: string } {
  const { y, m } = parse(today);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'thisMonth':
      return { from: iso(y, m, 1), to: today };
    case 'lastMonth':
      return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    default:
      return { from: today, to: today };
  }
}
