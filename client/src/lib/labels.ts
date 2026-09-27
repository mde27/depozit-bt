/**
 * Etichete în română pentru codurile interne afișate în interfață.
 * Doar afișare: codurile din baza de date și din API rămân neschimbate.
 */

/** Etapele de scanare ale unui tichet (ticket_scans.stage). */
export const SCAN_STAGE_LABELS: Record<string, string> = {
  SEND: 'Trimitere',
  DELIVER: 'Livrare',
  RETURN_OUT: 'Predare retur',
  RECEIVE_BACK: 'Recepție retur',
};

/** Acțiunile din istoricul unui tichet (ticket_history.action). */
export const TICKET_HISTORY_LABELS: Record<string, string> = {
  ORDERED: 'Cerere creată',
  RESUBMIT: 'Cerere retrimisă',
  SEND_WITH_COMMENT: 'Trimisă la corectat',
  SEND: 'Trimis',
  DELIVER: 'Livrat',
  RETURN_OUT: 'Retur predat',
  RECEIVE_BACK: 'Retur recepționat',
  COMMENT: 'Comentariu',
  CLOSED: 'Închis',
};

/** Acțiunile din jurnalul de activitate (activity_logs.action). */
export const ACTIVITY_LABELS: Record<string, string> = {
  LOGIN: 'Autentificare',
  LOGOUT: 'Ieșire',
  CREATE_TICKET: 'Cerere creată',
  RESUBMIT_TICKET: 'Cerere retrimisă',
  TICKET_SEND: 'Trimitere',
  TICKET_SEND_WITH_COMMENT: 'Trimisă la corectat',
  TICKET_DELIVER: 'Livrare',
  TICKET_RETURN_OUT: 'Predare retur',
  TICKET_RECEIVE_BACK: 'Recepție retur',
  TICKET_COMMENT: 'Comentariu',
  TICKET_CLOSED: 'Tichet închis',
  STOCK_RECEIVE: 'Intrare stoc',
  UPDATE_STOCK: 'Articol modificat',
  DELETE_STOCK: 'Articol șters',
  CREATE_USER: 'Utilizator creat',
  UPDATE_USER: 'Utilizator modificat',
};

/**
 * Textul lizibil din detaliile unui eveniment din istoric: comentariul, dacă există.
 * Detaliile tehnice (salvate ca JSON) nu se afișează.
 */
export function historyNote(details: string | null | undefined): string {
  if (!details) return '';
  const text = details.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'comment' in parsed) {
        const c = (parsed as { comment?: unknown }).comment;
        return typeof c === 'string' ? c.trim() : '';
      }
      return '';
    } catch {
      /* nu e JSON: se afișează ca text */
    }
  }
  return text;
}
