/**
 * „Descriere” (stock_items.description): din catalog (TEXT_NR_PRIN_MIJLOC_FIX)
 * sau scrisă de mână la articolele fără cod BT (ex. „rollbox”, „masa bucătărie”).
 * Se afișează ca rând mic sub denumire, doar dacă spune ceva în plus.
 */
const fold = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Textul de afișat sau null (gol, „-”, ori identic cu ce se vede deja). */
export function descriereLabel(description: unknown, ...alreadyShown: unknown[]): string | null {
  const d = String(description ?? '').replace(/\s+/g, ' ').trim();
  if (!d || /^-+$/.test(d)) return null;
  const f = fold(d);
  if (alreadyShown.some((s) => fold(s) === f)) return null;
  return d;
}
