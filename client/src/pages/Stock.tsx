import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { StockItem } from '../lib/types';

export default function Stock() {
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
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Barcode</th>
              <th className="px-3 py-2">Denumire</th>
              <th className="px-3 py-2">Locație</th>
              <th className="px-3 py-2">Companie</th>
              <th className="px-3 py-2 text-right">Cant.</th>
              <th className="px-3 py-2">Ledger</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{it.sku}</td>
                <td className="px-3 py-2 font-mono text-xs">{it.barcode || '—'}</td>
                <td className="px-3 py-2 font-medium">{it.name}</td>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
