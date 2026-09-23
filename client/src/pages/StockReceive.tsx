import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import { api, ApiError } from '../lib/api';
import type { StockItem } from '../lib/types';

type CatalogItem = {
  mijloc_fix: string;
  mijloc_fix_orig: string | null;
  clasa: string | null;
  denumire1: string;
  denumire2: string | null;
  description: string | null;
  numar_serial: string | null;
};

type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; code: string }
  | { status: 'hit'; code: string; item: CatalogItem }
  | { status: 'miss'; code: string };

export default function StockReceive() {
  const [manual, setManual] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [sourceFrom, setSourceFrom] = useState('');
  const [qty, setQty] = useState(1);
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const doLookup = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setError('');
    setSuccess('');
    setLookup({ status: 'loading', code });
    try {
      const data = await api<{ found: boolean; item?: CatalogItem; code: string }>(
        `/api/catalog/lookup?code=${encodeURIComponent(code)}`
      );
      if (data.found && data.item) {
        setLookup({ status: 'hit', code: data.code || code, item: data.item });
      } else {
        setLookup({ status: 'miss', code: data.code || code });
      }
    } catch (e) {
      setLookup({ status: 'idle' });
      setError(e instanceof Error ? e.message : 'Eroare lookup');
    }
  }, []);

  async function confirm() {
    if (lookup.status !== 'hit' && lookup.status !== 'miss') return;
    if (!sourceFrom.trim()) {
      setError('Completează „De unde a venit”');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api<{ item: StockItem; catalogHit: boolean }>('/api/stock/receive', {
        method: 'POST',
        body: JSON.stringify({
          code: lookup.code,
          quantity: qty,
          source_from: sourceFrom.trim(),
          place: place.trim() || undefined,
        }),
      });
      const name = data.item.name;
      setSuccess(
        data.catalogHit
          ? `Adăugat/actualizat: ${name} (cant. ${data.item.quantity})`
          : `Adăugat ca NECUNOSCUT: ${name} (cant. ${data.item.quantity})`
      );
      setLookup({ status: 'idle' });
      setManual('');
      setQty(1);
      // keep source_from for consecutive scans from same origin
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Eroare la salvare');
    } finally {
      setBusy(false);
    }
  }

  const code =
    lookup.status === 'hit' || lookup.status === 'miss' || lookup.status === 'loading'
      ? lookup.code
      : '';

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Intrare stoc</h1>
        <Link to="/stock" className="text-sm text-blue-600 hover:underline">
          ← Înapoi la stoc
        </Link>
      </div>
      <p className="text-sm text-slate-600">
        Scanează codul MIJLOC_FIX (sau ORIG). Dacă e în catalogul SMISS, denumirea se completează
        automat. Altfel se salvează ca <span className="font-mono">NECUNOSCUT</span> (evidențiat
        galben).
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <BarcodeScanner onScan={(c) => void doLookup(c)} />
        <div className="flex gap-2">
          <input
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
            placeholder="Sau introdu codul manual…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void doLookup(manual);
              }
            }}
          />
          <button
            type="button"
            onClick={() => void doLookup(manual)}
            className="bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Caută
          </button>
        </div>
      </div>

      {lookup.status === 'loading' && (
        <div className="text-sm text-slate-500">Se caută în catalog: {lookup.code}…</div>
      )}

      {lookup.status === 'hit' && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Găsit în catalog SMISS
          </div>
          <div className="font-semibold text-emerald-950">{lookup.item.denumire1}</div>
          {lookup.item.denumire2 && (
            <div className="text-sm text-emerald-900">{lookup.item.denumire2}</div>
          )}
          {lookup.item.description && (
            <div className="text-xs text-emerald-800/80">{lookup.item.description}</div>
          )}
          <div className="text-xs font-mono text-emerald-900 pt-1">
            MF: {lookup.item.mijloc_fix}
            {lookup.item.mijloc_fix_orig ? ` · ORIG: ${lookup.item.mijloc_fix_orig}` : ''}
            {` · scan: ${lookup.code}`}
          </div>
        </div>
      )}

      {lookup.status === 'miss' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Negăsit în catalog
          </div>
          <div className="font-semibold text-amber-950">NECUNOSCUT {lookup.code}</div>
          <div className="text-xs text-amber-900">
            Se va adăuga cu flag uncatalogued (afișat galben în stoc). Poți completa sursa și
            confirma.
          </div>
        </div>
      )}

      {(lookup.status === 'hit' || lookup.status === 'miss') && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              De unde a venit <span className="text-red-600">*</span>
            </label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={sourceFrom}
              onChange={(e) => setSourceFrom(e.target.value)}
              placeholder="ex. transfer BT / furnizor / retur magazie…"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cantitate</label>
              <input
                type="number"
                min={1}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Locație (opțional)
              </label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="ex. Depozit A"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={busy || !sourceFrom.trim()}
            onClick={() => void confirm()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-lg text-sm"
          >
            {busy ? 'Se salvează…' : `Confirmă intrare (${code})`}
          </button>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {success}
        </div>
      )}
    </div>
  );
}
