import { FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { StockItem } from '../lib/types';
import ConfirmDialog from './ConfirmDialog';

type FieldKey =
  | 'sku'
  | 'barcode'
  | 'name'
  | 'name2'
  | 'description'
  | 'company'
  | 'place'
  | 'quantity'
  | 'comments'
  | 'mijloc_fix'
  | 'mijloc_fix_orig'
  | 'source_from';

const FIELDS: { key: FieldKey; label: string; required?: boolean; mono?: boolean; full?: boolean }[] =
  [
    { key: 'name', label: 'Denumire', required: true, full: true },
    { key: 'name2', label: 'Denumire 2', full: true },
    { key: 'sku', label: 'SKU', required: true, mono: true },
    { key: 'barcode', label: 'Cod de bare', mono: true },
    { key: 'mijloc_fix', label: 'Mijloc fix', mono: true },
    { key: 'mijloc_fix_orig', label: 'Mijloc fix original', mono: true },
    { key: 'company', label: 'Firmă' },
    { key: 'place', label: 'Locație' },
    { key: 'source_from', label: 'Sursă (de unde a venit)' },
    { key: 'quantity', label: 'Cantitate' },
    { key: 'description', label: 'Descriere', full: true },
    { key: 'comments', label: 'Comentarii', full: true },
  ];

type Form = Record<FieldKey, string>;

function toForm(it: StockItem): Form {
  const out = {} as Form;
  for (const f of FIELDS) {
    const v = (it as unknown as Record<string, unknown>)[f.key];
    out[f.key] = v == null ? '' : String(v);
  }
  return out;
}

interface Props {
  item: StockItem;
  companies: string[];
  onClose: () => void;
  onSaved: (item: StockItem) => void;
}

export default function StockEditModal({ item, companies, onClose, onSaved }: Props) {
  const initial = toForm(item);
  const [form, setForm] = useState<Form>(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changed = FIELDS.filter((f) => form[f.key].trim() !== initial[f.key].trim());

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (changed.length === 0) {
      setError('Nicio modificare de salvat.');
      return;
    }
    const q = Number(form.quantity);
    if (form.quantity.trim() === '' || !Number.isInteger(q) || q < 0) {
      setError('Cantitatea trebuie să fie un număr întreg ≥ 0');
      return;
    }
    setConfirming(true);
  }

  async function save() {
    setBusy(true);
    setError('');
    const payload: Record<string, string | number | null> = {};
    for (const f of changed) {
      payload[f.key] = f.key === 'quantity' ? Number(form.quantity) : form[f.key].trim() || null;
    }
    try {
      const data = await api<{ item: StockItem }>(`/api/stock/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setConfirming(false);
      onSaved(data.item);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : 'Eroare la salvare');
    } finally {
      setBusy(false);
    }
  }

  const qtyDelta = Number(form.quantity) - Number(item.quantity);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 sm:p-4">
      <form
        onSubmit={onSubmit}
        className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-xl"
      >
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">Editează articol</h2>
            <p className="text-xs text-slate-500 truncate">
              #{item.id} · {item.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:bg-slate-100 rounded-lg px-2 py-1 text-xl leading-none"
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 grid sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {f.label}
                {f.required && <span className="text-red-600"> *</span>}
              </label>
              {f.key === 'description' || f.key === 'comments' ? (
                <textarea
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  type={f.key === 'quantity' ? 'number' : 'text'}
                  inputMode={f.key === 'quantity' ? 'numeric' : undefined}
                  min={f.key === 'quantity' ? 0 : undefined}
                  step={f.key === 'quantity' ? 1 : undefined}
                  required={f.required || f.key === 'quantity'}
                  list={f.key === 'company' ? 'stock-edit-companies' : undefined}
                  autoComplete="off"
                  className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-sm ${
                    f.mono ? 'font-mono' : ''
                  }`}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              )}
              {f.key === 'quantity' && Number.isFinite(qtyDelta) && qtyDelta !== 0 && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Corecție {qtyDelta > 0 ? `+${qtyDelta}` : qtyDelta} — se înregistrează în istoricul mișcărilor.
                </p>
              )}
            </div>
          ))}
          <datalist id="stock-edit-companies">
            {companies.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        {error && (
          <div className="mx-5 mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200"
          >
            Anulează
          </button>
          <button
            type="submit"
            disabled={busy}
            className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 disabled:opacity-50"
          >
            Salvează
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        title="Confirmă modificările"
        message={
          <>
            <p>
              Sigur salvezi modificările pentru <strong>{item.name}</strong>?
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
              {changed.map((f) => (
                <li key={f.key}>
                  <span className="font-medium">{f.label}:</span>{' '}
                  <span className="line-through text-slate-400">{initial[f.key] || '—'}</span> →{' '}
                  <span className="text-slate-900">{form[f.key].trim() || '—'}</span>
                </li>
              ))}
            </ul>
          </>
        }
        confirmLabel="Salvează"
        busy={busy}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
