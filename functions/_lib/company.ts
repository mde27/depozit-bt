import type { AuthUser } from './types';

/** Mesaj afișat unui user1 fără firmă setată. */
export const NO_COMPANY_MESSAGE =
  'Contul tău nu are o firmă setată. Cere administratorului să o completeze.';

/** Trim + null pentru string gol. */
export function normalizeCompany(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/** user1 vede / folosește doar stocul propriei firme; ceilalți văd tot. */
export function isCompanyScoped(user: AuthUser): boolean {
  return user.role === 'user1';
}

/** True dacă userul e limitat pe firmă, dar nu are firmă setată. */
export function missingCompany(user: AuthUser): boolean {
  return isCompanyScoped(user) && !normalizeCompany(user.company);
}

/** Aruncă 403 (format tickets.ts) dacă user1 nu are firmă setată. */
export function assertCompanySet(user: AuthUser): void {
  if (missingCompany(user)) {
    throw Object.assign(new Error(NO_COMPANY_MESSAGE), { status: 403 });
  }
}

/**
 * Fragment SQL pentru filtrarea stock_items pe firma userului.
 * - admin / user2 / user3 / user4 → `1=1` (fără restricție)
 * - user1 fără firmă → `0=1` (nimic)
 * - user1 → LOWER(TRIM(company)) = LOWER(TRIM(?))
 * `column` = coloana company (ex. `company`, `s.company`).
 */
export function stockCompanyScope(
  user: AuthUser,
  column = 'company'
): { sql: string; params: unknown[] } {
  if (!isCompanyScoped(user)) return { sql: '1=1', params: [] };
  const company = normalizeCompany(user.company);
  if (!company) return { sql: '0=1', params: [] };
  return { sql: `LOWER(TRIM(${column})) = LOWER(TRIM(?))`, params: [company] };
}
