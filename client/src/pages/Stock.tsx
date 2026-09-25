import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { StockItem } from '../lib/types';

export default function Stock() {
  const { user } = useAuth();
  const isUser1 = user?.role === 'user1';
  const canReceive = user?.role === 'admin' || user?.role === 'user2';
  const [items, setItems] = useState<StockItem[]>([]);
  const [place, setPlace] = useState('');
  const [places, setPlaces] = useState<string[]>([]);
  const [error, setError] = useState('');

  async function load(p = place) {
    try {
      const qs = p ? `?place=${encodeURIComponent(p)}` : '';
      const data = await api<{ items: StockItem[] }>(`/api/stock${qs}`);
      setItems(data.items);
      if (!p) {
        const uniq = [...new Set(data.items.map((i) => i.place).filter(Boolean))] as string[];
        setPlaces(uniq.sort());
      }
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Stoc live</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canReceive && (
            <Link
              to="/stock/receive"
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded-lg"
            >
              + Intrare stoc
            </Link>
          )}
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              load(e.target.value);
            }}
          >
            <option value="">Toate locațiile</option>
            {places.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isUser1 &&
        (user?.company?.trim() ? (
          <p className="text-sm text-slate-600 mb-3">
            Vezi doar articolele firmei: <strong>{user.company}</strong>
          </p>
        ) : (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Contul tău nu are o firmă setată. Cere administratorului să o completeze.
          </p>
        ))}
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Barcode</th>
              <th className="px-3 py-2">MF / ORIG</th>
              <th className="px-3 py-2">Denumire</th>
              <th className="px-3 py-2">Sursă</th>
              <th className="px-3 py-2">Locație</th>
              <th className="px-3 py-2">Companie</th>
              <th className="px-3 py-2 text-right">Cant.</th>
              <th className="px-3 py-2">Ledger</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const uncat = Boolean(it.is_uncatalogued);
              return (
                <tr
                  key={it.id}
                  className={
                    uncat
                      ? 'border-t border-amber-200 bg-amber-50 hover:bg-amber-100/80'
                      : 'border-t border-slate-100 hover:bg-slate-50'
                  }
                >
                  <td className="px-3 py-2 font-mono text-xs">{it.sku}</td>
                  <td className="px-3 py-2 font-mono text-xs">{it.barcode || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {it.mijloc_fix || it.mijloc_fix_orig ? (
                      <>
                        <div>{it.mijloc_fix || '—'}</div>
                        {it.mijloc_fix_orig ? (
                          <div className="text-slate-500">{it.mijloc_fix_orig}</div>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {it.name}
                    {uncat && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded">
                        necunoscut
                      </span>
                    )}
                    {it.name2 ? (
                      <div className="text-xs font-normal text-slate-500">{it.name2}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-700">{it.source_from || '—'}</td>
                  <td className="px-3 py-2">{it.place}</td>
                  <td className="px-3 py-2">{it.company}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{it.quantity}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/stock/${it.id}/movements`}
                      className="text-blue-600 hover:underline text-xs font-medium"
                    >
                      Mișcări
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
