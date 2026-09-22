import { db } from './db.js';

export function logActivity(
  username: string,
  role: string,
  action: string,
  details?: string | object | null
) {
  const detailsStr =
    details == null
      ? null
      : typeof details === 'string'
        ? details
        : JSON.stringify(details);
  db.prepare(
    `INSERT INTO activity_logs (username, role, action, details) VALUES (?, ?, ?, ?)`
  ).run(username, role, action, detailsStr);
}

export function addTicketHistory(
  ticketId: number,
  username: string,
  action: string,
  details?: string | object | null
) {
  const detailsStr =
    details == null
      ? null
      : typeof details === 'string'
        ? details
        : JSON.stringify(details);
  db.prepare(
    `INSERT INTO ticket_history (ticket_id, username, action, details) VALUES (?, ?, ?, ?)`
  ).run(ticketId, username, action, detailsStr);
}

export function generateTicketCode(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `T-${ts}-${rand}`;
}
