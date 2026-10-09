import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatRoTime } from '../lib/time';
import type { StockExitListRow } from '../lib/types';
import SearchBox, { EmptySearch, useUrlSearch } from '../components/SearchBox';
import { resultsLabel } from '../lib/stockSearch';

export default function StockExits() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<StockExitListRow[] | null>(null);
  const [q, setQ] = useUrlSearch();
  const [error, setError] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => {
      api<{ exits: StockExitListRow[] }>(`/api/stock-exits${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((d) => setRows(d.exits))
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Eroare la încărcare'));
    }, 0); // debounce-ul e în SearchBox
    return () => window.clearTimeout(t);
  }, [q]);

  if (user && user.role !== 'admin' && user.role !== 'user2') {
    return <p className="text-red-600">Nu ai acces la ieșirile din stoc.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ieșiri stoc</h1>
          <p className="text-sm text-slate-500">Bonurile de ieșire confirmate, cele mai noi primele.</p>
        </div>
        <Link
          to="/stock/iesire"
          className="min-h-[44px] px-4 rounded-xl bg-brand-700 text-white font-semibold flex items-center hover:bg-brand-800"
        >
          + Ieșire nouă
        </Link>
      </div>
      <SearchBox
        value={q}
        onChange={setQ}
        placeholder="Caută: nr. bon, persoană, solicitant, destinație, articol…"
        count={rows && q.trim() ? resultsLabel(rows.length) : null}
      />
      {error && <p className="text-red-600">{error}</p>}
      {rows && rows.length === 0 &&
        (q.trim() ? <EmptySearch query={q} /> : <p className="text-slate-500 text-sm">Nicio ieșire încă.</p>)}

      {/* telefon: carduri */}
      <ul className="sm:hidden space-y-2">
        {rows?.map((r) => (
          <li key={r.id}>
            <Link to={`/stock/iesiri/${r.id}`} className="block bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex justify-between gap-2">
                <span className="font-mono font-semibold text-sm">{r.code}</span>
                <span className="text-xs text-slate-500">{formatRoTime(r.created_at).slice(0, 16)}</span>
              </div>
              <div className="text-sm mt-1">
                către <strong>{r.predat_catre}</strong> · {r.destinatie}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">Solicitant: {r.solicitant || '—'}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {r.line_count} articole · {r.total} buc. · de {r.created_by}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* desktop: tabel */}
      {rows && rows.length > 0 && (
        <div className="hidden sm:block overflow-x-auto bg-white rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Nr. bon</th>
                <th className="px-3 py-2">Predat către</th>
                <th className="px-3 py-2">Solicitant</th>
                <th className="px-3 py-2">Destinație</th>
                <th className="px-3 py-2 text-right">Articole</th>
                <th className="px-3 py-2 text-right">Buc.</th>
                <th className="px-3 py-2">Predat de</th>
                <th className="px-3 py-2">Creat de</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-brand-50 cursor-pointer"
                  onClick={() => nav(`/stock/iesiri/${r.id}`)}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatRoTime(r.created_at)}</td>
                  <td className="px-3 py-2 font-mono font-medium">
                    <Link to={`/stock/iesiri/${r.id}`} className="text-brand-700 hover:underline">
                      {r.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.predat_catre}</td>
                  <td className="px-3 py-2">{r.solicitant || '—'}</td>
                  <td className="px-3 py-2">{r.destinatie}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.line_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                  <td className="px-3 py-2">{r.predat_de}</td>
                  <td className="px-3 py-2">{r.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
