import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatRoTime } from '../lib/time';
import { ROLE_LABELS, type Role } from '../lib/auth';
import { ACTIVITY_LABELS } from '../lib/labels';

interface LogRow {
  id: number;
  timestamp: string;
  username: string;
  role: string;
  action: string;
  details: string | null;
}

export default function Logs() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  async function load(search = q) {
    try {
      const data = await api<{ logs: LogRow[] }>(
        `/api/logs${search ? `?q=${encodeURIComponent(search)}` : ''}`
      );
      setLogs(data.logs);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare');
    }
  }

  useEffect(() => {
    load('');
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Jurnal activitate</h1>
      <form
        className="flex gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
      >
        <input
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
          placeholder="Caută după utilizator sau detalii…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg font-medium">Caută</button>
      </form>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">Timp</th>
              <th className="px-3 py-2">Utilizator</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Acțiune</th>
              <th className="px-3 py-2">Detalii</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatRoTime(l.timestamp)}</td>
                <td className="px-3 py-2 font-medium">{l.username}</td>
                <td className="px-3 py-2">{ROLE_LABELS[l.role as Role] ?? l.role}</td>
                <td className="px-3 py-2">{ACTIVITY_LABELS[l.action] ?? l.action}</td>
                <td className="px-3 py-2 max-w-xs truncate text-slate-600">{l.details}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                  Nicio înregistrare
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
