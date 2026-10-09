import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatRoTime } from '../lib/time';
import {
  createScanDebouncer,
  DEFAULT_SCAN_DEBOUNCE_MS,
  normalizeScannedCode,
} from '../lib/scanDebounce';
import {
  isScanSoundMuted,
  scanFeedback,
  setScanSoundMuted,
  unlockScanAudio,
} from '../lib/scanFeedback';
import {
  addScan,
  draftPayload,
  draftProblems,
  draftTotal,
  DEFAULT_PREDAT_DE,
  emptyDraft,
  loadDraft,
  removeLine,
  saveDraft,
  setLineNote,
  setLineQuantity,
  withDefaultPredatDe,
  type ExitDraft,
} from '../lib/stockExit';
import { downloadReceipt } from '../lib/receipt';
import { descriereLabel } from '../lib/descriere';
import type { StockExit as StockExitT } from '../lib/types';

type LookupResponse = {
  found: boolean;
  item?: { denumire1: string };
  inStock?: boolean;
  stock?: { id: number; name: string; name2?: string | null; description?: string | null; mijloc_fix: string | null; quantity: number } | null;
  code: string;
};

type Flash = { id: number; kind: 'ok' | 'warn' | 'error'; code: string; text: string };

const store = () => (typeof window !== 'undefined' ? window.localStorage : undefined);
const inputCls =
  'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm disabled:bg-slate-100';

export default function StockExit() {
  const { user } = useAuth();
  const [draft, setDraftState] = useState<ExitDraft>(
    () => {
      const saved = loadDraft(store());
      return saved ? withDefaultPredatDe(saved) : emptyDraft(DEFAULT_PREDAT_DE);
    }
  );
  const [manual, setManual] = useState('');
  const [muted, setMuted] = useState<boolean>(isScanSoundMuted);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<StockExitT | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const debouncerRef = useRef(createScanDebouncer(DEFAULT_SCAN_DEBOUNCE_MS));
  const busyRef = useRef(false);
  const submitRef = useRef(false);
  const draftRef = useRef(draft);
  const flashTimer = useRef<number | null>(null);

  const setDraft = useCallback((next: ExitDraft) => {
    draftRef.current = next;
    setDraftState(next);
    saveDraft(store(), next);
  }, []);

  useEffect(() => {
    // ciornă salvată cu „Ida” sau gol → „Predat de” implicit (și salvăm corecția)
    const stored = loadDraft(store());
    if (stored && stored.predat_de !== draftRef.current.predat_de) saveDraft(store(), draftRef.current);
  }, []);

  useEffect(() => () => void (flashTimer.current && window.clearTimeout(flashTimer.current)), []);

  const show = useCallback((f: Omit<Flash, 'id'>) => {
    const id = Date.now();
    setFlash({ ...f, id });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(
      () => setFlash((cur) => (cur && cur.id === id ? null : cur)),
      f.kind === 'error' ? 3800 : 2200
    );
  }, []);

  const addCode = useCallback(
    async (code: string) => {
      busyRef.current = true;
      setError('');
      try {
        const data = await api<LookupResponse>(`/api/catalog/lookup?code=${encodeURIComponent(code)}`);
        const stock = data.inStock && data.stock ? data.stock : null;
        if (!stock) {
          scanFeedback('error');
          show({
            kind: 'error',
            code,
            text: data.found
              ? `${data.item?.denumire1 ?? 'Articolul'} nu este în stoc — nu poate ieși.`
              : 'Cod necunoscut — nu există în stoc.',
          });
          return;
        }
        const r = addScan(draftRef.current, data.code || code, stock);
        if (r.result === 'empty') {
          scanFeedback('error');
          show({ kind: 'error', code, text: `${stock.name} — stoc 0, nu poate ieși.` });
          return;
        }
        setDraft(r.draft);
        if (r.result === 'max') {
          scanFeedback('warn');
          show({ kind: 'warn', code, text: `${stock.name} — ai ajuns la tot stocul (${stock.quantity} buc.).` });
        } else {
          scanFeedback('ok');
          show({
            kind: 'ok',
            code,
            text: `Adăugat: ${stock.name}. Scanează următorul articol sau confirmă la final.`,
          });
        }
      } catch (e) {
        scanFeedback('error');
        show({ kind: 'error', code, text: e instanceof ApiError ? e.message : 'Eroare. Verifică conexiunea.' });
      } finally {
        busyRef.current = false;
        debouncerRef.current.touch(code);
      }
    },
    [setDraft, show]
  );

  const onCameraRead = useCallback(
    (raw: string) => {
      const code = normalizeScannedCode(raw);
      if (!code) return;
      const d = debouncerRef.current;
      if (busyRef.current) {
        d.touch(code);
        return;
      }
      if (!d.accept(code)) return;
      void addCode(code);
    },
    [addCode]
  );

  function submitManual() {
    unlockScanAudio();
    const code = normalizeScannedCode(manual);
    if (!code || busyRef.current) return;
    setManual('');
    void addCode(code);
  }

  function toggleMute() {
    unlockScanAudio();
    const next = !muted;
    setMuted(next);
    setScanSoundMuted(next);
    if (!next) scanFeedback('ok');
  }

  function askConfirm() {
    if (submitRef.current) return;
    const problems = draftProblems(draftRef.current);
    if (problems.length) {
      setError(problems[0]);
      return;
    }
    setError('');
    setAsking(true);
  }

  async function confirmExit() {
    if (submitRef.current) return;
    const problems = draftProblems(draftRef.current);
    if (problems.length) {
      setAsking(false);
      setError(problems[0]);
      return;
    }
    submitRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const res = await api<{ exit: StockExitT }>('/api/stock-exits', {
        method: 'POST',
        body: JSON.stringify(draftPayload(draftRef.current)),
      });
      saveDraft(store(), null);
      setAsking(false);
      setDone(res.exit);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setAsking(false);
      setError(e instanceof ApiError ? e.message : 'Nu s-a putut salva. Verifică conexiunea și reîncearcă.');
    } finally {
      submitRef.current = false;
      setSubmitting(false);
    }
  }

  function startNew() {
    const next = emptyDraft(DEFAULT_PREDAT_DE);
    setDraft(next);
    setDone(null);
    setError('');
    debouncerRef.current.reset();
  }

  function discardDraft() {
    if (!window.confirm('Renunți la ieșirea începută? Lista scanată se pierde.')) return;
    startNew();
  }

  async function getReceipt(exit: StockExitT) {
    setReceiptBusy(true);
    try {
      await downloadReceipt(exit);
    } catch {
      setError('Bonul nu a putut fi generat. Reîncearcă.');
    } finally {
      setReceiptBusy(false);
    }
  }

  if (user && user.role !== 'admin' && user.role !== 'user2') {
    return <p className="text-red-600">Nu ai acces la ieșirile din stoc.</p>;
  }

  // ------------------------------------------------------------ confirmare
  if (done) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <div className="rounded-2xl border border-success-200 bg-success-50 p-5">
          <div className="text-success-800 font-semibold text-sm">Ieșire confirmată și închisă</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{done.code}</div>
          <div className="text-sm text-slate-600 mt-1">{formatRoTime(done.created_at)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm space-y-1.5">
          <div>
            <span className="text-slate-500">Predat de:</span> <strong>{done.predat_de}</strong>
          </div>
          <div>
            <span className="text-slate-500">Predat către:</span> <strong>{done.predat_catre}</strong>
          </div>
          <div>
            <span className="text-slate-500">Solicitant:</span> <strong>{done.solicitant || '—'}</strong>
          </div>
          <div>
            <span className="text-slate-500">Destinație:</span> <strong>{done.destinatie}</strong>
          </div>
          {done.observatii && (
            <div>
              <span className="text-slate-500">Observații:</span> {done.observatii}
            </div>
          )}
          <ul className="divide-y divide-slate-100 pt-2">
            {done.items.map((it) => (
              <li key={it.id} className="py-2 flex justify-between gap-3">
                <span className="min-w-0 break-words">
                  {it.name}
                  <span className="block text-xs text-slate-500 font-mono">{it.barcode}</span>
                  {descriereLabel(it.description, it.name) && (
                    <span className="block text-xs text-slate-600">Descriere: {descriereLabel(it.description, it.name)}</span>
                  )}
                  {it.observatii && <span className="block text-xs italic text-slate-600">Obs.: {it.observatii}</span>}
                </span>
                <span className="font-semibold tabular-nums whitespace-nowrap">{it.quantity} buc.</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
            <span>Total</span>
            <span>{done.total} buc.</span>
          </div>
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="button"
          onClick={() => getReceipt(done)}
          disabled={receiptBusy}
          className="w-full min-h-[56px] rounded-xl bg-brand-700 text-white font-semibold text-base hover:bg-brand-800 disabled:opacity-60 touch-manipulation"
        >
          {receiptBusy ? 'Se generează…' : 'Descarcă bonul (Word)'}
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={startNew}
            className="min-h-[48px] rounded-xl border border-slate-300 bg-white font-medium hover:bg-slate-50"
          >
            Începe o ieșire nouă (alt bon)
          </button>
          <Link
            to={`/stock/iesiri/${done.id}`}
            className="min-h-[48px] rounded-xl border border-slate-300 bg-white font-medium hover:bg-slate-50 flex items-center justify-center"
          >
            Vezi ieșirea
          </Link>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ ciornă
  const total = draftTotal(draft);
  const n = draft.lines.length;
  const nArt = `${n} ${n === 1 ? 'articol' : 'articole'}`;
  const problems = draftProblems(draft);
  const field = (key: 'predat_de' | 'predat_catre' | 'solicitant' | 'destinatie', label: string, ph: string) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label} <span className="text-red-600">*</span>
      </label>
      <input
        className={inputCls}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draftRef.current, [key]: e.target.value })}
        placeholder={ph}
        disabled={submitting}
      />
    </div>
  );

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ieșire stoc</h1>
          <ol className="text-sm text-slate-600 mt-1 space-y-0.5" aria-label="Pași">
            <li>1. Scanează toate articolele</li>
            <li>2. Completează predarea</li>
            <li>3. Confirmă o singură dată la final</li>
          </ol>
          <p className="text-xs text-slate-500 mt-1">Toate articolele scanate intră pe același bon. Stocul scade abia la confirmare.</p>
        </div>
        <Link to="/stock/iesiri" className="text-sm text-brand-700 hover:underline whitespace-nowrap pt-1">
          Ieșiri stoc →
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800">1. Scanează toate articolele</span>
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={!muted}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 touch-manipulation"
          >
            <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
            {muted ? 'Sunet oprit' : 'Sunet pornit'}
          </button>
        </div>
        <BarcodeScanner
          size="large"
          debounceMs={0}
          showFlash={false}
          onScan={onCameraRead}
          onUserStart={unlockScanAudio}
          startLabel="Pornește scanarea"
          stopLabel={`Stop scanare (${nArt})`}
        />
        <div className="rounded-xl border border-slate-200 bg-slate-50/50" data-testid="exit-lines">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <span className="font-semibold text-sm">Articole care ies ({n})</span>
            <span className="text-sm text-slate-600">
              {draft.lines.length} {draft.lines.length === 1 ? 'articol' : 'articole'} · <strong>{total} buc.</strong>
            </span>
          </div>
          {draft.lines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">Nimic scanat încă. Scanează primul articol.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {draft.lines.map((l, i) => (
                <li key={l.stock_item_id} className="px-3 py-3">
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0 w-7 h-7 rounded-full bg-brand-700 text-white text-sm font-bold flex items-center justify-center tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900 break-words">{l.name}</div>
                      <div className="text-xs text-slate-500 font-mono break-all">
                        {l.code}
                        {l.mijloc_fix && l.mijloc_fix !== l.code ? ` · MF ${l.mijloc_fix}` : ''}
                      </div>
                      {descriereLabel(l.description, l.name) && (
                      <div className="text-xs text-slate-600">Descriere: {descriereLabel(l.description, l.name)}</div>
                    )}
                    <div className="text-xs text-slate-500">În stoc: {l.available} buc.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft(removeLine(draftRef.current, l.stock_item_id))}
                      className="text-red-600 text-sm px-2 h-9 rounded-lg hover:bg-red-50 self-start"
                      aria-label={`Scoate ${l.name}`}
                      disabled={submitting}
                    >
                      Scoate
                    </button>
                  </div>
                  <div className="mt-2 ml-9 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Mai puțin"
                      onClick={() => setDraft(setLineQuantity(draftRef.current, l.stock_item_id, l.quantity - 1))}
                      disabled={submitting || l.quantity <= 1}
                      className="h-11 w-11 rounded-lg border border-slate-300 text-xl font-semibold disabled:opacity-40 touch-manipulation"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={l.available}
                      value={l.quantity}
                      onChange={(e) =>
                        setDraft(setLineQuantity(draftRef.current, l.stock_item_id, Number(e.target.value)))
                      }
                      className="h-11 w-16 text-center border border-slate-300 rounded-lg text-base tabular-nums"
                      aria-label="Cantitate"
                    />
                    <button
                      type="button"
                      aria-label="Mai mult"
                      onClick={() => setDraft(setLineQuantity(draftRef.current, l.stock_item_id, l.quantity + 1))}
                      disabled={submitting || l.quantity >= l.available}
                      className="h-11 w-11 rounded-lg border border-slate-300 text-xl font-semibold disabled:opacity-40 touch-manipulation"
                    >
                      +
                    </button>
                    <span className="text-sm text-slate-500">buc.</span>
                  </div>
                  <input
                    className="mt-2 ml-9 w-[calc(100%-2.25rem)] border border-slate-300 rounded-lg px-3 py-2 text-base sm:text-sm"
                    value={l.observatii ?? ''}
                    onChange={(e) => setDraft(setLineNote(draftRef.current, l.stock_item_id, e.target.value))}
                    placeholder="Notă pe bon (opțional), ex. ce este dacă nu are cod BT"
                    aria-label={`Notă pentru ${l.name}`}
                    maxLength={200}
                    disabled={submitting}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {flash && (
          <div
            role="status"
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              flash.kind === 'ok'
                ? 'bg-success-50 text-success-800 border border-success-200'
                : flash.kind === 'warn'
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            <span className="font-mono text-xs block opacity-80">{flash.code}</span>
            {flash.text}
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitManual();
          }}
        >
          <input
            className={inputCls}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="sau tastează codul"
            inputMode="text"
            autoComplete="off"
          />
          <button
            type="submit"
            className="min-h-[44px] px-4 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900"
          >
            Adaugă
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">2. Completează predarea</div>
        {field('predat_de', 'Predat de', 'cine predă')}
        {field('predat_catre', 'Predat către', 'numele persoanei care primește')}
        {field('solicitant', 'Solicitant', 'cine a cerut articolele')}
        {field('destinatie', 'Destinație', 'unde merg articolele')}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Observații (apar pe bon)</label>
          <textarea
            className={inputCls}
            rows={2}
            value={draft.observatii}
            onChange={(e) => setDraft({ ...draftRef.current, observatii: e.target.value })}
            disabled={submitting}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2" role="alert">
          {error}
        </p>
      )}
      <div className="text-sm font-semibold text-slate-800 pt-1">3. Confirmă o singură dată la final</div>
      <button
        type="button"
        onClick={askConfirm}
        disabled={submitting || problems.length > 0}
        className="w-full min-h-[56px] rounded-xl bg-brand-700 text-white font-semibold text-base hover:bg-brand-800 disabled:opacity-50 touch-manipulation"
      >
        {submitting ? 'Se salvează…' : `Am terminat – confirmă ieșirea (${nArt}, ${total} buc.)`}
      </button>
      {problems.length > 0 && draft.lines.length > 0 && (
        <p className="text-xs text-slate-500 text-center">{problems[0]}</p>
      )}
      {(draft.lines.length > 0 || draft.predat_catre || draft.solicitant || draft.destinatie) && (
        <button
          type="button"
          onClick={discardDraft}
          disabled={submitting}
          className="w-full text-sm text-slate-500 hover:text-red-600 py-2"
        >
          Renunță la această ieșire
        </button>
      )}

      {asking && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-confirm-title"
          onClick={() => !submitting && setAsking(false)}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="exit-confirm-title" className="text-lg font-bold text-slate-900">
              Ai scanat tot? Se creează UN singur bon cu:
            </h2>
            <ol className="mt-3 overflow-y-auto divide-y divide-slate-100 border-y border-slate-100 min-h-0" data-testid="confirm-lines">
              {draft.lines.map((l, i) => (
                <li key={l.stock_item_id} className="py-2 flex gap-2 text-sm">
                  <span className="font-bold tabular-nums w-6 shrink-0">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">
                    {l.name}
                    {descriereLabel(l.description, l.name) && (
                      <span className="block text-xs text-slate-600">Descriere: {descriereLabel(l.description, l.name)}</span>
                    )}
                    {l.observatii?.trim() && (
                      <span className="block text-xs italic text-slate-600">Obs.: {l.observatii.trim()}</span>
                    )}
                  </span>
                  <span className="font-semibold tabular-nums whitespace-nowrap">{l.quantity} buc.</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 text-sm space-y-1">
              <div>
                Total: <strong>{nArt}, {total} buc.</strong>
              </div>
              <div>
                <span className="text-slate-500">Predat către:</span> <strong>{draft.predat_catre}</strong>
              </div>
              <div>
                <span className="text-slate-500">Solicitant:</span> <strong>{draft.solicitant}</strong>
              </div>
              <div>
                <span className="text-slate-500">Destinație:</span> <strong>{draft.destinatie}</strong>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAsking(false)}
                disabled={submitting}
                className="min-h-[52px] rounded-xl border border-slate-300 bg-white font-semibold hover:bg-slate-50 touch-manipulation"
              >
                Mai scanez
              </button>
              <button
                type="button"
                onClick={confirmExit}
                disabled={submitting}
                className="min-h-[52px] rounded-xl bg-brand-700 text-white font-semibold hover:bg-brand-800 disabled:opacity-60 touch-manipulation"
              >
                {submitting ? 'Se salvează…' : 'Da, confirmă'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
