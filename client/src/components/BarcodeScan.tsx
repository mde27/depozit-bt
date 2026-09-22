import { FormEvent, useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { ScanLine } from '../lib/types';
import BarcodeScanner from './BarcodeScanner';

interface Props {
  title?: string;
  hint?: string;
  /** When set, show order comparison and require known stock barcodes (SEND flow) */
  expected?: { barcode: string | null; name: string; ordered_qty: number }[];
  onChange?: (lines: ScanLine[]) => void;
  initial?: ScanLine[];
  /**
   * If true (default when `expected` is set), unknown barcodes are blocked.
   * Otherwise unknown codes can be added with a warning.
   */
  requireKnownBarcode?: boolean;
}

export default function BarcodeScan({
  title = 'Scanare barcode',
  hint,
  expected,
  onChange,
  initial = [],
  requireKnownBarcode,
}: Props) {
  const blockUnknown = requireKnownBarcode ?? Boolean(expected?.length);
  const [lines, setLines] = useState<ScanLine[]>(initial);
  const [barcode, setBarcode] = useState('');
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; warn?: boolean } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const qtyRef = useRef(qty);
  qtyRef.current = qty;
  const toastTimer = useRef<number | null>(null);

  function showToast(text: string, warn = false) {
    setToast({ text, warn });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  }

  function update(next: ScanLine[]) {
    setLines(next);
    linesRef.current = next;
    onChange?.(next);
  }

  const addBarcode = useCallback(
    async (codeRaw: string, addQty?: number) => {
      const code = codeRaw.trim();
      if (!code) {
        setError('Introdu barcode');
        return;
      }
      const amount = addQty ?? qtyRef.current ?? 1;
      setBusy(true);
      setError('');
      try {
        let name: string | undefined;
        let sku: string | undefined;
        let barcodeValue = code;
        let unknown = false;

        try {
          const data = await api<{
            item: { barcode: string; name: string; sku: string };
          }>(`/api/stock/by-barcode/${encodeURIComponent(code)}`);
          barcodeValue = data.item.barcode || code;
          name = data.item.name;
          sku = data.item.sku;
        } catch (err) {
          if (blockUnknown) {
            const msg =
              err instanceof ApiError ? err.message : 'Barcode necunoscut în stoc';
            setError(msg);
            showToast(`Necunoscut: ${code}`, true);
            return;
          }
          unknown = true;
        }

        const current = linesRef.current;
        const existing = current.findIndex((l) => l.barcode === barcodeValue);
        let next: ScanLine[];
        if (existing >= 0) {
          next = current.map((l, i) =>
            i === existing
              ? { ...l, qty: l.qty + amount, unknown: l.unknown || unknown }
              : l
          );
        } else {
          next = [
            ...current,
            {
              barcode: barcodeValue,
              qty: amount,
              name: name || (unknown ? `(necunoscut)` : undefined),
              sku,
              unknown,
            },
          ];
        }
        update(next);
        setBarcode('');
        setQty(1);
        setHighlight(barcodeValue);
        window.setTimeout(() => setHighlight((h) => (h === barcodeValue ? null : h)), 2000);
        if (unknown) {
          showToast(`Adăugat cu avertisment: ${barcodeValue}`, true);
        } else {
          showToast(`+${amount} ${name || barcodeValue}`);
        }
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- update/onChange stable enough via refs
    [blockUnknown]
  );

  async function addLine(e: FormEvent) {
    e.preventDefault();
    await addBarcode(barcode, qty);
  }

  function remove(i: number) {
    update(lines.filter((_, idx) => idx !== i));
  }

  function setLineQty(i: number, q: number) {
    const n = Math.max(1, Number(q) || 1);
    update(lines.map((l, idx) => (idx === i ? { ...l, qty: n } : l)));
  }

  const scannedByBarcode = new Map<string, number>();
  for (const l of lines) {
    scannedByBarcode.set(l.barcode, (scannedByBarcode.get(l.barcode) || 0) + l.qty);
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>

      <BarcodeScanner
        onScan={(code) => {
          setBarcode(code);
          void addBarcode(code, 1);
        }}
      />

      {toast && (
        <div
          className={`text-sm rounded-lg px-3 py-2 border ${
            toast.warn
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
          role="status"
        >
          {toast.text}
        </div>
      )}

      <form onSubmit={addLine} className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Barcode (manual)
          </label>
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Tastează dacă camera nu e disponibilă…"
          />
        </div>
        <div className="w-24">
          <label className="block text-xs font-medium text-slate-600 mb-1">Cant.</label>
          <input
            type="number"
            min={1}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Adaugă
        </button>
      </form>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {lines.length === 0 && (
          <li className="px-3 py-4 text-sm text-slate-400 text-center">Nicio linie scanată</li>
        )}
        {lines.map((l, i) => (
          <li
            key={`${l.barcode}-${i}`}
            className={`px-3 py-2 flex justify-between gap-2 text-sm transition ${
              highlight === l.barcode ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''
            }`}
          >
            <div className="min-w-0">
              <div className="font-medium flex flex-wrap items-center gap-2">
                <span>{l.name || l.barcode}</span>
                {l.unknown && (
                  <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                    necunoscut
                  </span>
                )}
              </div>
              <div className="text-xs font-mono text-slate-500">
                {l.barcode} {l.sku ? `· ${l.sku}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min={1}
                className="w-16 border border-slate-200 rounded px-2 py-1 text-sm tabular-nums"
                value={l.qty}
                onChange={(e) => setLineQty(i, Number(e.target.value))}
                aria-label="Cantitate"
              />
              <button type="button" className="text-red-600 text-xs" onClick={() => remove(i)}>
                Șterge
              </button>
            </div>
          </li>
        ))}
      </ul>

      {expected && expected.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm">
          <h4 className="font-semibold mb-2">Comparare cu comanda</h4>
          <ul className="space-y-1">
            {expected.map((e) => {
              const scanned = e.barcode ? scannedByBarcode.get(e.barcode) || 0 : 0;
              const ok = scanned === e.ordered_qty;
              return (
                <li
                  key={e.barcode || e.name}
                  className={`flex justify-between ${ok ? 'text-emerald-700' : 'text-amber-700'}`}
                >
                  <span>
                    {e.name} <span className="font-mono text-xs">({e.barcode})</span>
                  </span>
                  <span className="tabular-nums font-medium">
                    {scanned} / {e.ordered_qty} {ok ? '✓' : '✗'}
                  </span>
                </li>
              );
            })}
          </ul>
          {(() => {
            const expectedCodes = new Set(expected.map((e) => e.barcode).filter(Boolean));
            const extras = lines.filter((l) => !expectedCodes.has(l.barcode));
            if (!extras.length) return null;
            return (
              <p className="text-red-600 text-xs mt-2">
                Extra: {extras.map((x) => `${x.barcode}×${x.qty}`).join(', ')}
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export function scansPayload(lines: ScanLine[]) {
  return lines.map((l) => ({ barcode: l.barcode, qty: l.qty }));
}
