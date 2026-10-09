import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { descriereLabel } from '../lib/descriere';
import { useAuth } from '../lib/auth';
import { downloadReceipt } from '../lib/receipt';
import { formatRoTime } from '../lib/time';
import type { StockExit } from '../lib/types';

export default function StockExitDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [exit, setExit] = useState<StockExit | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ exit: StockExit }>(`/api/stock-exits/${id}`)
      .then((d) => setExit(d.exit))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Eroare la încărcare'));
  }, [id]);

  if (user && user.role !== 'admin' && user.role !== 'user2') {
    return <p className="text-red-600">Nu ai acces la ieșirile din stoc.</p>;
  }

  async function receipt() {
    if (!exit) return;
    setBusy(true);
    try {
      await downloadReceipt(exit);
    } catch {
      setError('Bonul nu a putut fi generat. Reîncearcă.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Link to="/stock/iesiri" className="text-sm text-brand-700 hover:underline">
        ← Înapoi la ieșiri
      </Link>
      {error && <p className="text-red-600">{error}</p>}
      {exit && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold font-mono">{exit.code}</h1>
              <p className="text-sm text-slate-500">
                {formatRoTime(exit.created_at)} ·{' '}
                <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  Închisă
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={receipt}
              disabled={busy}
              className="min-h-[48px] px-5 rounded-xl bg-brand-700 text-white font-semibold hover:bg-brand-800 disabled:opacity-60"
            >
              {busy ? 'Se generează…' : 'Descarcă bonul (Word)'}
            </button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">Predat de</div>
              <div className="font-semibold">{exit.predat_de}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Predat către</div>
              <div className="font-semibold">{exit.predat_catre}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Solicitant</div>
              <div className="font-semibold">{exit.solicitant || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Destinație</div>
              <div className="font-semibold">{exit.destinatie}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Înregistrată de</div>
              <div className="font-semibold">{exit.created_by}</div>
            </div>
            {exit.observatii && (
              <div className="sm:col-span-2">
                <div className="text-xs text-slate-500">Observații</div>
                <div>{exit.observatii}</div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-2">Nr.</th>
                  <th className="px-3 py-2">Denumire</th>
                  <th className="px-3 py-2">Mijloc fix</th>
                  <th className="px-3 py-2">Cod scanat</th>
                  <th className="px-3 py-2 text-right">Cantitate</th>
                  <th className="px-3 py-2 text-right">Stoc rămas</th>
                </tr>
              </thead>
              <tbody>
                {exit.items.map((it, i) => (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Link to={`/stock/${it.stock_item_id}/movements`} className="hover:underline">
                        {it.name}
                      </Link>
                      {descriereLabel(it.description, it.name) && (
                        <div className="text-xs text-slate-600">Descriere: {descriereLabel(it.description, it.name)}</div>
                      )}
                      {it.observatii && <div className="text-xs italic text-slate-600">Obs.: {it.observatii}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{it.mijloc_fix || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.barcode || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{it.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{it.quantity_after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-3 py-2" colSpan={4}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{exit.total}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
