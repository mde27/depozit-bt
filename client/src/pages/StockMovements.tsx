import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatRoTime } from '../lib/time';

interface Movement {
  id: number;
  delta: number;
  reason: string;
  quantity_after: number;
  created_by: string;
  created_at: string;
  barcode_scanned: string | null;
  ticket_code: string | null;
  ticket_id: number | null;
  exit_code?: string | null;
  stock_exit_id?: number | null;
}

const REASON_LABELS: Record<string, string> = {
  INITIAL: 'Stoc inițial',
  RECEIVE: 'Intrare stoc',
  SEND_OUT: 'Trimitere (ieșire)',
  RECEIVE_BACK: 'Retur primit',
  MANUAL_EDIT: 'Corecție manuală (editare)',
  ISSUE: 'Ieșire stoc',
};

export default function StockMovements() {
  const { id } = useParams();
  const [item, setItem] = useState<Record<string, unknown> | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ item: Record<string, unknown>; movements: Movement[] }>(`/api/stock/${id}/movements`)
      .then((d) => {
        setItem(d.item);
        setMovements(d.movements);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <div>
      <Link to="/stock" className="text-sm text-brand-700 hover:underline">
        ← Înapoi la stoc
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-1">Mișcări stoc</h1>
      {item && (
        <p className="text-slate-600 mb-4">
          <span className="font-medium">{String(item.name)}</span> · SKU {String(item.sku)} ·
          cod de bare {String(item.barcode || '—')} · stoc curent{' '}
          <strong>{String(item.quantity)}</strong>
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Motiv</th>
              <th className="px-3 py-2 text-right">Modificare</th>
              <th className="px-3 py-2 text-right">După</th>
              <th className="px-3 py-2">Tichet / Bon</th>
              <th className="px-3 py-2">Utilizator</th>
              <th className="px-3 py-2">Cod scanat</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatRoTime(m.created_at)}</td>
                <td className="px-3 py-2 font-medium">{REASON_LABELS[m.reason] || m.reason}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold tabular-nums ${
                    m.delta < 0 ? 'text-red-600' : 'text-success-700'
                  }`}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{m.quantity_after}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {m.ticket_code ||
                    (m.exit_code && m.stock_exit_id ? (
                      <Link to={`/stock/iesiri/${m.stock_exit_id}`} className="text-brand-700 hover:underline">
                        {m.exit_code}
                      </Link>
                    ) : (
                      m.exit_code || '—'
                    ))}
                </td>
                <td className="px-3 py-2">{m.created_by}</td>
                <td className="px-3 py-2 font-mono text-xs">{m.barcode_scanned || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
