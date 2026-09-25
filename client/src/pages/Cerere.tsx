import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { StockItem, Ticket, TicketInfo } from '../lib/types';
import { useAuth } from '../lib/auth';

const emptyInfo: TicketInfo = {
  pm_client: '',
  phones: '',
  pickup_address: '',
  delivery_address: '',
  pickup_county: '',
  pickup_locality: '',
  delivery_county: '',
  delivery_locality: '',
  pickup_date: '',
  delivery_date: '',
  time_interval: '',
  return_request: false,
  return_details: '',
  comments: '',
  recipient: '',
};

export default function Cerere() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const { user } = useAuth();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [clientName, setClientName] = useState('');
  const [info, setInfo] = useState<TicketInfo>({ ...emptyInfo });
  const [lines, setLines] = useState<{ stock_item_id: number; ordered_qty: number }[]>([
    { stock_item_id: 0, ordered_qty: 1 },
  ]);
  const [fixComment, setFixComment] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: StockItem[] }>('/api/stock').then((d) => setStock(d.items));
  }, []);

  useEffect(() => {
    if (!id) return;
    api<{ ticket: Ticket }>(`/api/tickets/${id}`).then((d) => {
      const t = d.ticket;
      setClientName(t.client_name);
      setFixComment(t.fix_comment || null);
      if (t.info) {
        setInfo({
          ...emptyInfo,
          ...t.info,
          return_request: Boolean(t.info.return_request),
        });
      }
      if (t.items?.length) {
        setLines(
          t.items.map((it) => ({
            stock_item_id: it.stock_item_id,
            ordered_qty: it.ordered_qty,
          }))
        );
      }
    });
  }, [id]);

  if (user && user.role !== 'user1' && user.role !== 'admin') {
    return <p className="text-red-600">Doar user1 / admin pot crea cereri.</p>;
  }

  function setLine(i: number, patch: Partial<{ stock_item_id: number; ordered_qty: number }>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const payload = {
      client_name: clientName,
      info: {
        ...info,
        return_request: Boolean(info.return_request),
      },
      items: lines.filter((l) => l.stock_item_id && l.ordered_qty > 0),
    };
    try {
      const data = editing
        ? await api<{ ticket: Ticket }>(`/api/tickets/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await api<{ ticket: Ticket }>('/api/tickets', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      nav(`/tichete/${data.ticket.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eroare');
    } finally {
      setBusy(false);
    }
  }

  const field = (
    key: keyof TicketInfo,
    label: string,
    type: string = 'text',
    opts?: { full?: boolean }
  ) => (
    <div className={opts?.full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        value={String(info[key] ?? '')}
        onChange={(e) => setInfo({ ...info, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">
        {editing ? 'Corectează cererea' : 'Cerere nouă'}
      </h1>
      <p className="text-slate-500 text-sm mb-4">
        Formular ridicare / livrare (ca Depozit BT)
      </p>

      {fixComment && (
        <div className="mb-4 text-sm bg-orange-50 border border-orange-200 text-orange-900 rounded-xl px-4 py-3">
          <strong>Observație magazie:</strong> {fixComment}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">Client & contact</h2>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nume client *</label>
            <input
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {field('pm_client', 'PM / Client (persoană contact)')}
            {field('phones', 'Telefoane')}
            {field('recipient', 'Destinatar')}
            {field('time_interval', 'Interval orar')}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">Ridicare</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {field('pickup_address', 'Adresă ridicare', 'text', { full: true })}
            {field('pickup_county', 'Județ ridicare')}
            {field('pickup_locality', 'Localitate ridicare')}
            {field('pickup_date', 'Data ridicare', 'date')}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">Livrare</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {field('delivery_address', 'Adresă livrare', 'text', { full: true })}
            {field('delivery_county', 'Județ livrare')}
            {field('delivery_locality', 'Localitate livrare')}
            {field('delivery_date', 'Data livrare', 'date')}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">Retur & comentarii</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(info.return_request)}
              onChange={(e) => setInfo({ ...info, return_request: e.target.checked })}
            />
            Solicitare retur
          </label>
          {field('return_details', 'Detalii retur', 'text', { full: true })}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Comentarii</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              rows={2}
              value={String(info.comments ?? '')}
              onChange={(e) => setInfo({ ...info, comments: e.target.value })}
            />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Articole din stoc</h2>
              {user?.role === 'user1' && (
                <p className="text-xs text-slate-500">
                  {user.company?.trim()
                    ? `Vezi doar articolele firmei: ${user.company}`
                    : 'Contul tău nu are o firmă setată. Cere administratorului să o completeze.'}
                </p>
              )}
            </div>
            <button
              type="button"
              className="text-sm text-blue-600 font-medium"
              onClick={() => setLines([...lines, { stock_item_id: 0, ordered_qty: 1 }])}
            >
              + Adaugă linie
            </button>
          </div>
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-slate-600 mb-1">Articol</label>
                <select
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={line.stock_item_id || ''}
                  onChange={(e) => setLine(i, { stock_item_id: Number(e.target.value) })}
                >
                  <option value="">Alege…</option>
                  {stock.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.barcode} — stoc {s.quantity}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="block text-xs font-medium text-slate-600 mb-1">Cant.</label>
                <input
                  type="number"
                  min={1}
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={line.ordered_qty}
                  onChange={(e) => setLine(i, { ordered_qty: Number(e.target.value) })}
                />
              </div>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="text-red-600 text-sm px-2 py-2"
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                >
                  Șterge
                </button>
              )}
            </div>
          ))}
        </section>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg px-6 py-2.5"
        >
          {busy
            ? 'Se salvează…'
            : editing
              ? 'Retrimite (ORDERED)'
              : 'Creează tichet (ORDERED)'}
        </button>
      </form>
    </div>
  );
}
