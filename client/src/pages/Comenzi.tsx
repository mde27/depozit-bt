import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import StatusBadge from '../components/StatusBadge';
import SearchBox, { useUrlSearch } from '../components/SearchBox';
import { resultsLabel } from '../lib/stockSearch';
import { presetRange, todayRo } from '../lib/dates';
import { downloadCsv, toCsv } from '../lib/csv';
import {
  COMENZI_EXPORT_COLUMNS,
  destinationLabel,
  destinations,
  exportRows,
  filterBase,
  filterComenzi,
  groupComenzi,
  productCode,
  requesterLabel,
  roDate,
  statusCounts,
  type ComandaRow,
  type GroupBy,
} from '../lib/comenzi';

type Period = 'all' | 'today' | 'last7' | 'thisMonth' | 'custom';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'Tot' },
  { key: 'today', label: 'Azi' },
  { key: 'last7', label: '7 zile' },
  { key: 'thisMonth', label: 'Luna aceasta' },
];

interface Resp {
  rows: ComandaRow[];
  truncated: boolean;
  limit: number;
}

const chip = (on: boolean) =>
  `min-h-[40px] px-3 py-1.5 rounded-lg text-sm font-medium ring-1 transition ${
    on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300 hover:bg-brand-50'
  }`;

export default function Comenzi() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  const [query, setQuery] = useUrlSearch('q');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');

  function choosePeriod(p: Period) {
    setPeriod(p);
    if (p === 'all') {
      setFrom('');
      setTo('');
    } else if (p !== 'custom') {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  useEffect(() => {
    if (from && to && from > to) return;
    let stop = false;
    setLoading(true);
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    api<Resp>(`/api/comenzi${p.toString() ? `?${p}` : ''}`)
      .then((d) => {
        if (stop) return;
        setData(d);
        setError('');
      })
      .catch((e) => !stop && setError(e instanceof Error ? e.message : 'Eroare'))
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [from, to]);

  const rows = data?.rows ?? [];
  const destList = useMemo(() => destinations(rows), [rows]);
  const base = useMemo(() => filterBase(rows, { destination, query }), [rows, destination, query]);
  const counts = useMemo(() => statusCounts(base), [base]);
  const shown = useMemo(() => filterComenzi(rows, { statuses, destination, query }), [rows, statuses, destination, query]);
  const groups = useMemo(() => groupComenzi(shown, groupBy), [shown, groupBy]);
  const ticketCount = useMemo(() => new Set(shown.map((r) => r.ticket_id)).size, [shown]);
  const filtersOn = statuses.length > 0 || !!destination || !!query.trim() || period !== 'all';

  function toggleStatus(s: string) {
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }
  function resetAll() {
    setStatuses([]);
    setDestination('');
    setQuery('');
    choosePeriod('all');
  }
  function exportCsv() {
    const suffix = from || to ? `${from || 'inceput'}_${to || todayRo()}` : todayRo();
    downloadCsv(`comenzi-${suffix}.csv`, toCsv(COMENZI_EXPORT_COLUMNS, exportRows(shown)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Comenzi</h1>
          <p className="text-sm text-slate-500">
            {user?.role === 'user1'
              ? 'Comenzile tale, pe produse — inclusiv cele închise.'
              : 'Toate comenzile, pe produse — inclusiv cele închise.'}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={shown.length === 0}
          className="min-h-[40px] px-3 py-2 rounded-lg text-sm font-medium bg-white ring-1 ring-slate-300 hover:bg-brand-50 disabled:opacity-50"
        >
          Descarcă (Excel/CSV)
        </button>
      </div>

      {/* Numărători pe status = filtre rapide (se pot alege mai multe) */}
      <div data-testid="status-counts" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {counts.map((c) => {
          const on = statuses.includes(c.status);
          return (
            <button
              key={c.status}
              type="button"
              aria-pressed={on}
              onClick={() => toggleStatus(c.status)}
              className={`text-left rounded-xl px-3 py-2 ring-1 transition ${
                on ? 'bg-brand-50 ring-brand-600 ring-2' : 'bg-white ring-slate-200 hover:ring-brand-300'
              } ${c.tickets === 0 && !on ? 'opacity-60' : ''}`}
            >
              <StatusBadge status={c.status} />
              <div className="mt-1 text-xl font-bold tabular-nums">{c.tickets}</div>
              <div className="text-xs text-slate-500">
                {c.tickets === 1 ? 'tichet' : 'tichete'} · {c.lines} {c.lines === 1 ? 'produs' : 'produse'}
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl ring-1 ring-slate-200 p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-slate-600 mr-1">Perioada (data creării):</span>
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className={chip(period === p.key)} onClick={() => choosePeriod(p.key)}>
              {p.label}
            </button>
          ))}
          <label className="flex items-center gap-1 text-sm">
            de la
            <input
              type="date"
              aria-label="De la"
              value={from}
              onChange={(e) => {
                setPeriod('custom');
                setFrom(e.target.value);
              }}
              className="min-h-[40px] border border-slate-300 rounded-lg px-2"
            />
          </label>
          <label className="flex items-center gap-1 text-sm">
            până la
            <input
              type="date"
              aria-label="Până la"
              value={to}
              onChange={(e) => {
                setPeriod('custom');
                setTo(e.target.value);
              }}
              className="min-h-[40px] border border-slate-300 rounded-lg px-2"
            />
          </label>
        </div>
        {from && to && from > to && <p className="text-sm text-red-600">Data „de la” este după data „până la”.</p>}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Caută tichet, produs, cod, destinație, solicitant…"
            count={rows.length ? `${resultsLabel(shown.length)} · ${ticketCount} ${ticketCount === 1 ? 'tichet' : 'tichete'}` : null}
          />
          <select
            aria-label="Destinație"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="min-h-[44px] w-full sm:w-auto sm:max-w-xs border border-slate-300 rounded-lg px-2 text-base sm:text-sm bg-white"
          >
            <option value="">Toate destinațiile</option>
            {destList.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <div className="flex gap-1 shrink-0" role="group" aria-label="Grupare">
            <button type="button" className={chip(groupBy === 'status')} onClick={() => setGroupBy('status')}>
              Pe status
            </button>
            <button type="button" className={chip(groupBy === 'ticket')} onClick={() => setGroupBy('ticket')}>
              Pe tichet
            </button>
          </div>
        </div>
        {filtersOn && (
          <button type="button" onClick={resetAll} className="text-sm text-brand-700 hover:underline">
            Șterge filtrele
          </button>
        )}
      </div>

      {error && <p className="text-red-600">{error}</p>}
      {data?.truncated && (
        <p className="text-sm bg-amber-50 text-amber-800 ring-1 ring-amber-200 rounded-lg px-3 py-2">
          Sunt afișate doar cele mai noi {data.limit.toLocaleString('ro-RO')} produse. Alege o perioadă mai scurtă.
        </p>
      )}
      {loading && !data && <p className="text-slate-500">Se încarcă…</p>}
      {data && shown.length === 0 && (
        <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-6 text-center">
          {rows.length === 0 ? 'Nicio comandă în perioada aleasă.' : 'Nicio comandă pentru filtrele alese.'}
        </p>
      )}

      <div className="space-y-4" data-testid="comenzi-groups">
        {groups.map((g) => (
          <section key={g.key} className="bg-white rounded-xl ring-1 ring-slate-200 overflow-hidden" data-testid="comenzi-group">
            <header className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
              {groupBy === 'status' ? (
                <StatusBadge status={g.status || ''} />
              ) : (
                <>
                  <Link to={`/tichete/${g.ticketId}`} className="font-mono text-sm font-semibold text-brand-700 hover:underline">
                    {g.title}
                  </Link>
                  <StatusBadge status={g.status || ''} />
                </>
              )}
              <span className="text-sm text-slate-600" data-testid="group-count">
                {groupBy === 'status' ? `${g.tickets} ${g.tickets === 1 ? 'tichet' : 'tichete'} · ` : ''}
                {g.rows.length} {g.rows.length === 1 ? 'produs' : 'produse'}
              </span>
              {groupBy === 'ticket' && (
                <span className="text-sm text-slate-500 ml-auto">
                  {destinationLabel(g.rows[0])} · {requesterLabel(g.rows[0])}
                </span>
              )}
            </header>

            {/* telefon: carduri */}
            <ul className="md:hidden divide-y divide-slate-100">
              {g.rows.map((r) => (
                <li key={r.line_id}>
                  <Link to={`/tichete/${r.ticket_id}`} className="block px-3 py-2.5 hover:bg-brand-50" data-testid="comanda-card">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium break-words">{r.name}</span>
                      <span className="font-semibold tabular-nums whitespace-nowrap">{r.ordered_qty} buc.</span>
                    </div>
                    <div className="text-xs font-mono text-slate-500">{productCode(r)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                      <span className="font-mono text-brand-700">{r.ticket_code}</span>
                      <StatusBadge status={r.status} />
                      <span>creat {roDate(r.created_at)}</span>
                      {r.closed_at && <span>închis {roDate(r.closed_at)}</span>}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">→ {destinationLabel(r)}</div>
                    <div className="text-xs text-slate-500">Solicitant: {requesterLabel(r)}</div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* desktop: tabel */}
            <table className="hidden md:table min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Tichet</th>
                  <th className="px-3 py-2 font-medium">Produs</th>
                  <th className="px-3 py-2 font-medium text-right">Cant.</th>
                  <th className="px-3 py-2 font-medium">Creat</th>
                  <th className="px-3 py-2 font-medium">Destinație</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Solicitant</th>
                  <th className="px-3 py-2 font-medium">Închis</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.line_id} className="border-t border-slate-100 hover:bg-brand-50" data-testid="comanda-row">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link to={`/tichete/${r.ticket_id}`} className="font-mono text-xs text-brand-700 hover:underline">
                        {r.ticket_code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div>{r.name}</div>
                      <div className="text-xs font-mono text-slate-500">{productCode(r)}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.ordered_qty}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{roDate(r.created_at)}</td>
                    <td className="px-3 py-2">{destinationLabel(r)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">{requesterLabel(r)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.closed_at ? roDate(r.closed_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
