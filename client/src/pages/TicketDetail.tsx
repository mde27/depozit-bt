import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../lib/auth';
import type { Ticket } from '../lib/types';

export default function TicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ ticket: Ticket }>(`/api/tickets/${id}`)
      .then((d) => setTicket(d.ticket))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!ticket) return <p className="text-slate-400">Se încarcă…</p>;

  const info = ticket.info;
  const role = user?.role;
  const actions: { label: string; to: string; className: string }[] = [];

  if ((role === 'user2' || role === 'admin') && ticket.status === 'ORDERED') {
    actions.push({
      label: 'Trimitere (scan barcode)',
      to: `/tichete/${ticket.id}/scan/send`,
      className: 'bg-sky-600 hover:bg-sky-700',
    });
  }
  if ((role === 'user3' || role === 'admin') && ticket.status === 'SENT') {
    actions.push({
      label: 'Livrare (scan)',
      to: `/tichete/${ticket.id}/scan/deliver`,
      className: 'bg-emerald-600 hover:bg-emerald-700',
    });
  }
  if ((role === 'user4' || role === 'admin') && ticket.status === 'DELIVERED') {
    actions.push({
      label: 'Retur outbound (scan)',
      to: `/tichete/${ticket.id}/scan/return_out`,
      className: 'bg-violet-600 hover:bg-violet-700',
    });
  }
  if ((role === 'user2' || role === 'admin') && ticket.status === 'RETURNING') {
    actions.push({
      label: 'Recepție retur (scan → +stoc)',
      to: `/tichete/${ticket.id}/scan/receive_back`,
      className: 'bg-indigo-600 hover:bg-indigo-700',
    });
  }
  if (
    (role === 'user1' || role === 'admin') &&
    ticket.status === 'NEEDS_FIX'
  ) {
    actions.push({
      label: 'Corectează cererea',
      to: `/cerere/${ticket.id}`,
      className: 'bg-orange-600 hover:bg-orange-700',
    });
  }

  return (
    <div className="space-y-4">
      <Link to="/tichete" className="text-sm text-blue-600 hover:underline">
        ← Tichete
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold font-mono">{ticket.ticket_code}</h1>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="text-slate-700 text-lg">{ticket.client_name}</p>

      {ticket.fix_comment && (
        <div className="bg-orange-50 border border-orange-200 text-orange-900 rounded-xl px-4 py-3 text-sm">
          <strong>De corectat:</strong> {ticket.fix_comment}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className={`${a.className} text-white text-sm font-semibold px-4 py-2 rounded-lg`}
            >
              {a.label}
            </Link>
          ))}
        </div>
      )}

      {info && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 text-sm grid sm:grid-cols-2 gap-3">
          <div>
            <h3 className="font-semibold mb-1">Contact</h3>
            <p>PM/Client: {info.pm_client || '—'}</p>
            <p>Tel: {info.phones || '—'}</p>
            <p>Destinatar: {info.recipient || '—'}</p>
            <p>Interval: {info.time_interval || '—'}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-1">Ridicare</h3>
            <p>{info.pickup_address || '—'}</p>
            <p>
              {info.pickup_locality || ''} {info.pickup_county || ''}
            </p>
            <p>Data: {info.pickup_date || '—'}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-1">Livrare</h3>
            <p>{info.delivery_address || '—'}</p>
            <p>
              {info.delivery_locality || ''} {info.delivery_county || ''}
            </p>
            <p>Data: {info.delivery_date || '—'}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-1">Retur / note</h3>
            <p>Retur: {info.return_request ? 'Da' : 'Nu'}</p>
            <p>{info.return_details || '—'}</p>
            <p className="text-slate-500">{info.comments || ''}</p>
          </div>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold mb-2">Articole comandate</h3>
        <ul className="text-sm space-y-1">
          {(ticket.items || []).map((it) => (
            <li key={it.id} className="flex justify-between border-b border-slate-100 py-1 gap-2">
              <span>
                {it.stock_name}{' '}
                <span className="font-mono text-xs text-slate-400">{it.barcode}</span>
              </span>
              <span className="text-xs tabular-nums whitespace-nowrap text-slate-600">
                cmd {it.ordered_qty} · trim {it.sent_qty} · liv {it.delivered_qty} · ret↓{' '}
                {it.return_out_qty} · ret↑ {it.received_back_qty}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(ticket.scans || []).length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-semibold mb-2">Scanări</h3>
          <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {ticket.scans!.map((s) => (
              <li key={s.id} className="text-slate-600">
                <span className="text-slate-400">{s.created_at}</span> · {s.stage} ·{' '}
                <span className="font-mono">{s.barcode}</span> ×{s.qty} · {s.created_by}
                {s.stock_name ? ` · ${s.stock_name}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold mb-2">Istoric</h3>
        <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
          {(ticket.history || []).map((h) => (
            <li key={h.id} className="text-slate-600">
              <span className="text-slate-400">{h.at}</span> · {h.username} ·{' '}
              <strong>{h.action}</strong>
              {h.details ? ` — ${h.details.slice(0, 120)}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
