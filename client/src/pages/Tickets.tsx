import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../lib/auth';
import type { Ticket } from '../lib/types';

export default function Tickets() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [mode, setMode] = useState<'queue' | 'all'>('queue');
  const [error, setError] = useState('');

  async function load(m = mode) {
    try {
      let path = '/api/tickets?queue=1';
      if (user?.role === 'user1') path = '/api/tickets?mine=1';
      else if (user?.role === 'admin') {
        path = m === 'all' ? '/api/tickets' : '/api/tickets?active=1';
      }
      const data = await api<{ tickets: Ticket[] }>(path);
      setTickets(data.tickets);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare');
    }
  }

  useEffect(() => {
    load();
  }, [user, mode]);

  const title =
    user?.role === 'user2'
      ? 'Coadă magazie (ORDERED + RETURNING)'
      : user?.role === 'user3'
        ? 'Coadă curier (SENT)'
        : user?.role === 'user4'
          ? 'Coadă retur outbound (DELIVERED)'
          : user?.role === 'user1'
            ? 'Tichetele mele'
            : 'Tichete';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        {user?.role === 'admin' && (
          <div className="flex gap-2 text-sm">
            <button
              className={`px-3 py-1.5 rounded-lg ${mode === 'queue' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}
              onClick={() => setMode('queue')}
            >
              Active
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg ${mode === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}
              onClick={() => setMode('all')}
            >
              Toate
            </button>
          </div>
        )}
      </div>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">Cod</th>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Creat de</th>
              <th className="px-3 py-2">Actualizat</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 hover:bg-blue-50">
                <td className="px-3 py-2">
                  <Link
                    to={`/tichete/${t.id}`}
                    className="font-mono text-xs text-blue-700 hover:underline"
                  >
                    {t.ticket_code}
                  </Link>
                </td>
                <td className="px-3 py-2">{t.client_name}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-3 py-2">{t.created_by}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{t.updated_at}</td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                  Niciun tichet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
