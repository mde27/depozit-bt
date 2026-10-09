/**
 * Ieșire stoc — logica ciornei (fără DOM), folosită de pagina de scanare.
 * Ciorna stă doar pe telefon (localStorage) până la confirmare; serverul
 * primește totul o singură dată, la „Confirmă ieșirea”.
 */

export interface DraftLine {
  stock_item_id: number;
  /** codul așa cum a fost scanat / tastat */
  code: string;
  name: string;
  mijloc_fix: string | null;
  /** câte bucăți erau în stoc la scanare */
  available: number;
  quantity: number;
  /** notă opțională pentru acest articol (apare pe bon) */
  observatii?: string;
}

export interface ExitDraft {
  /** cheie unică a ciornei — trimisă la server ca să nu se salveze de două ori */
  key: string;
  predat_de: string;
  predat_catre: string;
  solicitant: string;
  destinatie: string;
  observatii: string;
  lines: DraftLine[];
}

export type StockMatchLite = {
  id: number;
  name: string;
  mijloc_fix: string | null;
  quantity: number;
};

export type AddResult = 'added' | 'incremented' | 'max' | 'empty';

export function newDraftKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** „Predat de” precompletat pe orice ieșire nouă (se poate modifica). */
export const DEFAULT_PREDAT_DE = 'Ida Bereczki';
/** valori vechi care se înlocuiesc automat cu cea implicită */
const OLD_PREDAT_DE = new Set(['', 'ida']);

/** Pune „Predat de” implicit dacă ciorna are gol sau vechiul „Ida” (numele de utilizator). */
export function withDefaultPredatDe(draft: ExitDraft): ExitDraft {
  return OLD_PREDAT_DE.has(draft.predat_de.trim().toLowerCase()) ? { ...draft, predat_de: DEFAULT_PREDAT_DE } : draft;
}

export function emptyDraft(predatDe = ''): ExitDraft {
  return {
    key: newDraftKey(),
    predat_de: predatDe,
    predat_catre: '',
    solicitant: '',
    destinatie: '',
    observatii: '',
    lines: [],
  };
}

/** Adaugă un cod scanat: linie nouă sau +1 pe linia existentă (fără să depășească stocul). */
export function addScan(
  draft: ExitDraft,
  code: string,
  stock: StockMatchLite
): { draft: ExitDraft; result: AddResult; line?: DraftLine } {
  const available = Math.max(0, Math.floor(Number(stock.quantity) || 0));
  const idx = draft.lines.findIndex((l) => l.stock_item_id === stock.id);
  if (idx >= 0) {
    const cur = draft.lines[idx];
    const updated = { ...cur, available };
    if (cur.quantity >= available) {
      const lines = draft.lines.slice();
      lines[idx] = updated;
      return { draft: { ...draft, lines }, result: 'max', line: updated };
    }
    updated.quantity = cur.quantity + 1;
    const lines = draft.lines.slice();
    lines[idx] = updated;
    return { draft: { ...draft, lines }, result: 'incremented', line: updated };
  }
  if (available <= 0) return { draft, result: 'empty' };
  const line: DraftLine = {
    stock_item_id: stock.id,
    code,
    name: stock.name,
    mijloc_fix: stock.mijloc_fix ?? null,
    available,
    quantity: 1,
  };
  // cel mai recent scanat sus
  return { draft: { ...draft, lines: [line, ...draft.lines] }, result: 'added', line };
}

/** Cantitate nouă, limitată la 1…stoc. */
export function setLineQuantity(draft: ExitDraft, stockItemId: number, qty: number): ExitDraft {
  return {
    ...draft,
    lines: draft.lines.map((l) => {
      if (l.stock_item_id !== stockItemId) return l;
      const q = Math.floor(Number(qty) || 0);
      return { ...l, quantity: Math.min(Math.max(1, q), Math.max(1, l.available)) };
    }),
  };
}

/** Notă pe o linie (ex. ce este un articol fără cod BT). */
export function setLineNote(draft: ExitDraft, stockItemId: number, note: string): ExitDraft {
  return {
    ...draft,
    lines: draft.lines.map((l) => (l.stock_item_id === stockItemId ? { ...l, observatii: note } : l)),
  };
}

export function removeLine(draft: ExitDraft, stockItemId: number): ExitDraft {
  return { ...draft, lines: draft.lines.filter((l) => l.stock_item_id !== stockItemId) };
}

export function draftTotal(draft: ExitDraft): number {
  return draft.lines.reduce((a, l) => a + l.quantity, 0);
}

/** Mesajele care opresc confirmarea (gol = se poate confirma). */
export function draftProblems(draft: ExitDraft): string[] {
  const out: string[] = [];
  if (!draft.lines.length) out.push('Scanează cel puțin un articol.');
  if (!draft.predat_de.trim()) out.push('Completează „Predat de”.');
  if (!draft.predat_catre.trim()) out.push('Completează „Predat către”.');
  if (!draft.solicitant.trim()) out.push('Completează „Solicitant”.');
  if (!draft.destinatie.trim()) out.push('Completează „Destinație”.');
  for (const l of draft.lines) {
    if (l.quantity > l.available) out.push(`„${l.name}”: în stoc sunt doar ${l.available} buc.`);
  }
  return out;
}

export function draftPayload(draft: ExitDraft) {
  return {
    client_key: draft.key,
    predat_de: draft.predat_de.trim(),
    predat_catre: draft.predat_catre.trim(),
    solicitant: draft.solicitant.trim(),
    destinatie: draft.destinatie.trim(),
    observatii: draft.observatii.trim(),
    items: draft.lines.map((l) => ({
      stock_item_id: l.stock_item_id,
      code: l.code,
      quantity: l.quantity,
      ...(l.observatii?.trim() ? { observatii: l.observatii.trim() } : {}),
    })),
  };
}

const STORAGE_KEY = 'depozitbt.exitDraft';

export function loadDraft(storage: Pick<Storage, 'getItem'> | undefined): ExitDraft | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as ExitDraft;
    if (!d || typeof d.key !== 'string' || !Array.isArray(d.lines)) return null;
    return {
      key: d.key,
      predat_de: String(d.predat_de ?? ''),
      predat_catre: String(d.predat_catre ?? ''),
      solicitant: String(d.solicitant ?? ''),
      destinatie: String(d.destinatie ?? ''),
      observatii: String(d.observatii ?? ''),
      lines: d.lines.filter((l) => l && Number.isInteger(l.stock_item_id) && l.quantity > 0),
    };
  } catch {
    return null;
  }
}

export function saveDraft(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, d: ExitDraft | null) {
  try {
    if (!storage) return;
    if (!d) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* stocare plină / privată — ciorna rămâne doar în memorie */
  }
}

export const EXIT_DRAFT_STORAGE_KEY = STORAGE_KEY;
