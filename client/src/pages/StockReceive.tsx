import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import { api, ApiError } from '../lib/api';
import { formatRoTime } from '../lib/time';
import { useAuth } from '../lib/auth';
import { useCompanies } from '../lib/companies';
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

type Mode = 'single' | 'continuous';

/** One camera/manual read in continuous mode (this browser session only). */
type SessionRow = {
  id: number;
  code: string;
  at: number;
  status: 'saving' | 'ok' | 'error';
  name?: string;
  catalogHit?: boolean;
  qtyAfter?: number;
  error?: string;
};

type Confirmation = {
  id: number;
  kind: 'ok' | 'warn' | 'error';
  code: string;
  text: string;
};

const MODE_KEY = 'depozitbt.receiveMode';
const CONFIRM_MS = 2200;

function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'continuous' ? 'continuous' : 'single';
  } catch {
    return 'single';
  }
}

function fmtTime(ms: number) {
  return formatRoTime(ms, 'time');
}

export default function StockReceive() {
  const { user } = useAuth();
  const { companies, reload: reloadCompanies } = useCompanies();
  const [manual, setManual] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [sourceFrom, setSourceFrom] = useState('');
  const [company, setCompany] = useState('');
  const [qty, setQty] = useState(1);
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // --- scanning UX state ---
  const [mode, setModeState] = useState<Mode>(readMode);
  const [muted, setMuted] = useState<boolean>(isScanSoundMuted);
  const [cameraOn, setCameraOn] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const debouncerRef = useRef(createScanDebouncer(DEFAULT_SCAN_DEBOUNCE_MS));
  const savingRef = useRef(false);
  const nextIdRef = useRef(1);
  const confirmTimer = useRef<number | null>(null);
  const scanCardRef = useRef<HTMLDivElement | null>(null);
  // latest session fields for the camera callback
  const fieldsRef = useRef({ sourceFrom, company, place });
  fieldsRef.current = { sourceFrom, company, place };

  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    []
  );

  function setMode(m: Mode) {
    setModeState(m);
    setError('');
    setSuccess('');
    debouncerRef.current.reset();
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }

  function toggleMute() {
    unlockScanAudio(); // this tap is a user gesture -> good moment to unlock iOS audio
    const next = !muted;
    setMuted(next);
    setScanSoundMuted(next);
    if (!next) scanFeedback('ok'); // preview beep when turning sound on
  }

  const showConfirmation = useCallback((c: Omit<Confirmation, 'id'>) => {
    const id = Date.now();
    setConfirmation({ ...c, id });
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(
      () => setConfirmation((cur) => (cur && cur.id === id ? null : cur)),
      c.kind === 'error' ? CONFIRM_MS + 1500 : CONFIRM_MS
    );
  }, []);

  // ---------------- single-scan mode (lookup -> review -> confirm) ----------------
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
        scanFeedback('ok');
      } else {
        setLookup({ status: 'miss', code: data.code || code });
        scanFeedback('warn');
      }
    } catch (e) {
      setLookup({ status: 'idle' });
      setError(e instanceof Error ? e.message : 'Eroare la căutare');
      scanFeedback('error');
    }
  }, []);

  async function confirm() {
    if (lookup.status !== 'hit' && lookup.status !== 'miss') return;
    if (!company.trim()) {
      setError('Completează „Firmă”');
      return;
    }
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
          company: company.trim(),
          place: place.trim() || undefined,
        }),
      });
      const name = data.item.name;
      setSuccess(
        data.catalogHit
          ? `Adăugat/actualizat: ${name} (cant. ${data.item.quantity})`
          : `Adăugat ca articol necunoscut: ${name} (cant. ${data.item.quantity})`
      );
      setLookup({ status: 'idle' });
      setManual('');
      setQty(1);
      void reloadCompanies();
      // keep source_from and company for consecutive scans from same origin
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Eroare la salvare');
      scanFeedback('error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------- continuous mode (scan -> add qty 1 -> resume) ----------------
  const sessionFieldsOk = Boolean(sourceFrom.trim() && company.trim());

  const addContinuous = useCallback(
    async (code: string, retryId?: number) => {
      const f = fieldsRef.current;
      if (!f.sourceFrom.trim() || !f.company.trim()) {
        setError('Completează „De unde a venit” și „Firmă” înainte de scanare.');
        scanFeedback('error');
        return;
      }
      savingRef.current = true;
      const id = retryId ?? nextIdRef.current++;
      const at = Date.now();
      setRows((prev) =>
        retryId
          ? prev.map((r) => (r.id === id ? { ...r, status: 'saving', error: undefined } : r))
          : [{ id, code, at, status: 'saving' }, ...prev]
      );
      try {
        const data = await api<{ item: StockItem; catalogHit: boolean }>('/api/stock/receive', {
          method: 'POST',
          body: JSON.stringify({
            code,
            quantity: 1,
            source_from: f.sourceFrom.trim(),
            company: f.company.trim(),
            place: f.place.trim() || undefined,
          }),
        });
        const hit = Boolean(data.catalogHit);
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: 'ok',
                  name: data.item.name,
                  catalogHit: hit,
                  qtyAfter: data.item.quantity,
                }
              : r
          )
        );
        scanFeedback(hit ? 'ok' : 'warn');
        showConfirmation({
          kind: hit ? 'ok' : 'warn',
          code,
          text: hit ? data.item.name : 'Articol necunoscut — adăugat în stoc',
        });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Eroare la salvare. Verifică conexiunea.';
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'error', error: msg } : r)));
        scanFeedback('error');
        showConfirmation({ kind: 'error', code, text: msg });
      } finally {
        savingRef.current = false;
        // a code still in front of the camera stays "seen" -> not re-added
        debouncerRef.current.touch(code);
      }
    },
    [showConfirmation]
  );

  /** Raw decodes from the camera (debounce done here, not in the scanner). */
  const onCameraRead = useCallback(
    (raw: string) => {
      const code = normalizeScannedCode(raw);
      if (!code) return;
      const d = debouncerRef.current;
      if (mode === 'continuous') {
        if (savingRef.current) {
          // previous item still saving: remember we saw it, pick up the next code afterwards
          d.touch(code);
          return;
        }
        if (!d.accept(code)) return;
        void addContinuous(code);
      } else {
        if (!d.accept(code)) return;
        void doLookup(code);
      }
    },
    [mode, addContinuous, doLookup]
  );

  function submitManual() {
    unlockScanAudio();
    const code = normalizeScannedCode(manual);
    if (!code) return;
    if (mode === 'continuous') {
      if (savingRef.current) return;
      setManual('');
      void addContinuous(code);
    } else {
      void doLookup(code);
    }
  }

  function newSession() {
    setRows([]);
    setConfirmation(null);
    debouncerRef.current.reset();
  }

  function onCameraActive(active: boolean) {
    setCameraOn(active);
    if (active) {
      setError('');
      setSuccess('');
      // bring the camera + Stop button right under the sticky header (phones)
      window.requestAnimationFrame(() => {
        const card = scanCardRef.current;
        if (!card) return;
        const header = document.querySelector('header');
        const offset = (header?.getBoundingClientRect().height ?? 0) + 8;
        const top = card.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });
    } else if (mode === 'continuous') {
      void reloadCompanies(); // new companies may have been typed for this session
    }
  }

  const okRows = rows.filter((r) => r.status === 'ok');
  const okCount = okRows.length;
  const warnCount = okRows.filter((r) => !r.catalogHit).length;
  const errCount = rows.filter((r) => r.status === 'error').length;
  const savingNow = rows.some((r) => r.status === 'saving');

  const code =
    lookup.status === 'hit' || lookup.status === 'miss' || lookup.status === 'loading'
      ? lookup.code
      : '';

  if (user && user.role !== 'admin' && user.role !== 'user2') {
    return <p className="text-red-600">Nu ai acces la intrările în stoc.</p>;
  }

  const continuous = mode === 'continuous';
  const fieldsLocked = continuous && cameraOn;

  const sourceField = (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        De unde a venit <span className="text-red-600">*</span>
      </label>
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm disabled:bg-slate-100 disabled:text-slate-500"
        value={sourceFrom}
        onChange={(e) => setSourceFrom(e.target.value)}
        placeholder="ex. transfer BT / furnizor / retur magazie…"
        required
        disabled={fieldsLocked}
      />
    </div>
  );

  const companyField = (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        Firmă <span className="text-red-600">*</span>
      </label>
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm disabled:bg-slate-100 disabled:text-slate-500"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="ex. BT / numele firmei"
        list="stock-receive-companies"
        autoComplete="off"
        disabled={fieldsLocked}
      />
      <datalist id="stock-receive-companies">
        {companies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p className="text-[11px] text-slate-500 mt-1">
        Alege o firmă din listă. Articolul va fi vizibil doar clienților acestei firme.
      </p>
    </div>
  );

  const placeField = (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">Locație (opțional)</label>
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm disabled:bg-slate-100 disabled:text-slate-500"
        value={place}
        onChange={(e) => setPlace(e.target.value)}
        placeholder="ex. Depozit A"
        disabled={fieldsLocked}
      />
    </div>
  );

  return (
    <div className="space-y-4 max-w-xl pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Intrare stoc</h1>
        <Link to="/stock" className="text-sm text-brand-700 hover:underline">
          ← Înapoi la stoc
        </Link>
      </div>

      {/* Mode switch */}
      <div
        role="tablist"
        aria-label="Mod scanare"
        className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1"
      >
        {(
          [
            ['single', 'Un articol', 'verifici și confirmi'],
            ['continuous', 'Scanare continuă', '1 buc. / scanare'],
          ] as const
        ).map(([m, label, sub]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={cameraOn || savingNow}
            onClick={() => setMode(m)}
            className={`min-h-[48px] rounded-lg px-2 py-1.5 text-sm font-semibold leading-tight transition touch-manipulation disabled:cursor-not-allowed ${
              mode === m
                ? 'bg-white text-brand-800 shadow-sm ring-1 ring-brand-200'
                : 'text-slate-600 hover:text-slate-900 disabled:opacity-50'
            }`}
          >
            {label}
            <span className="block text-[11px] font-normal text-slate-500">{sub}</span>
          </button>
        ))}
      </div>

      <p className="text-sm text-slate-600">
        {continuous ? (
          <>
            Completează o dată datele de mai jos, apoi scanează articol după articol. Fiecare
            scanare adaugă <strong>1 buc.</strong> în stoc imediat; camera rămâne deschisă. Pentru
            încă o bucată cu același cod, ia camera de pe cod o clipă și scanează din nou.
            Articolele care nu sunt în catalog se salvează ca necunoscute (galben).
          </>
        ) : (
          <>
            Scanează codul de mijloc fix de pe etichetă. Dacă articolul este în catalog, denumirea
            se completează automat. Altfel se salvează ca necunoscut (evidențiat cu galben).
          </>
        )}
      </p>

      {continuous && !fieldsLocked && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Date sesiune</h2>
          {sourceField}
          {companyField}
          {placeField}
        </div>
      )}

      {continuous && fieldsLocked && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
          <div className="break-words">
            <span className="text-slate-500">De unde:</span> <strong>{sourceFrom}</strong>
            {' · '}
            <span className="text-slate-500">Firmă:</span> <strong>{company}</strong>
            {place.trim() && (
              <>
                {' · '}
                <span className="text-slate-500">Locație:</span> <strong>{place}</strong>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500">Oprește scanarea ca să modifici.</div>
        </div>
      )}

      <div ref={scanCardRef} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800">
            {continuous ? 'Scanare continuă' : 'Scanare'}
          </span>
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={!muted}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 touch-manipulation"
            title={muted ? 'Pornește sunetul la scanare' : 'Oprește sunetul la scanare'}
          >
            <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
            {muted ? 'Sunet oprit' : 'Sunet pornit'}
          </button>
        </div>

        {continuous && cameraOn && (
          <div className="flex items-center justify-between rounded-lg bg-brand-900 text-white px-3 py-2">
            <span className="text-sm">Scanate în sesiune</span>
            <span className="text-2xl font-bold tabular-nums" aria-live="polite">
              {okCount}
            </span>
          </div>
        )}

        <BarcodeScanner
          key={mode}
          size="large"
          debounceMs={0}
          showFlash={false}
          onScan={onCameraRead}
          onUserStart={unlockScanAudio}
          onActiveChange={onCameraActive}
          startDisabled={continuous && !sessionFieldsOk}
          startLabel={continuous ? 'Pornește scanarea' : 'Scanează un cod'}
          stopLabel={continuous ? `Stop scanare (${okCount} scanate)` : 'Oprește camera'}
          hint={
            continuous && !sessionFieldsOk ? (
              <span className="text-amber-700">
                Completează „De unde a venit” și „Firmă” ca să pornești scanarea.
              </span>
            ) : (
              <>
                Permite accesul la cameră când ți se cere. Se folosește camera din spate.
              </>
            )
          }
        />

        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm font-mono"
            placeholder="Sau introdu codul manual…"
            value={manual}
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitManual();
              }
            }}
          />
          <button
            type="button"
            onClick={submitManual}
            disabled={continuous && (!sessionFieldsOk || savingNow)}
            className="min-h-[44px] bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {continuous ? 'Adaugă' : 'Caută'}
          </button>
        </div>
      </div>

      {/* ---------- continuous: session list ---------- */}
      {continuous && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
            <div>
              <div className="font-semibold text-slate-800">
                Scanate în această sesiune: <span className="tabular-nums">{okCount}</span>
              </div>
              {(warnCount > 0 || errCount > 0) && (
                <div className="text-xs text-slate-500">
                  {warnCount > 0 && (
                    <span className="text-amber-700">{warnCount} necatalogate</span>
                  )}
                  {warnCount > 0 && errCount > 0 && ' · '}
                  {errCount > 0 && <span className="text-red-600">{errCount} erori</span>}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={newSession}
              disabled={cameraOn || savingNow || rows.length === 0}
              className="min-h-[40px] text-sm px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Sesiune nouă
            </button>
          </div>
          <ul className="divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
            {rows.length === 0 && (
              <li className="px-4 py-6 text-sm text-slate-400 text-center">
                Niciun articol scanat încă.
              </li>
            )}
            {rows.map((r) => (
              <li
                key={r.id}
                className={`px-4 py-2.5 text-sm flex items-start justify-between gap-3 ${
                  r.status === 'error'
                    ? 'bg-red-50'
                    : r.status === 'ok' && !r.catalogHit
                      ? 'bg-amber-50'
                      : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="font-mono text-slate-900 break-all">{r.code}</div>
                  <div className="text-slate-700 break-words">
                    {r.status === 'saving' && <span className="text-slate-400">Se salvează…</span>}
                    {r.status === 'ok' &&
                      (r.catalogHit ? (
                        r.name
                      ) : (
                        <span className="text-amber-800">
                          <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-200/70 px-1.5 py-0.5 rounded mr-1">
                            necatalogat
                          </span>
                          {r.name}
                        </span>
                      ))}
                    {r.status === 'error' && <span className="text-red-700">{r.error}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] text-slate-400 tabular-nums">{fmtTime(r.at)}</div>
                  {r.status === 'ok' && (
                    <div className="text-[11px] text-slate-500 tabular-nums">stoc: {r.qtyAfter}</div>
                  )}
                  {r.status === 'error' && (
                    <button
                      type="button"
                      disabled={savingNow}
                      onClick={() => void addContinuous(r.code, r.id)}
                      className="mt-1 min-h-[36px] text-xs font-medium px-2.5 rounded-lg bg-red-600 text-white disabled:opacity-50"
                    >
                      Reîncearcă
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- single mode: lookup result + confirm form ---------- */}
      {!continuous && lookup.status === 'loading' && (
        <div className="text-sm text-slate-500">Se caută în catalog: {lookup.code}…</div>
      )}

      {!continuous && lookup.status === 'hit' && (
        <div className="rounded-xl border border-success-300 bg-success-50 px-4 py-3 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-success-800">
            Găsit în catalog
          </div>
          <div className="font-semibold text-success-950">{lookup.item.denumire1}</div>
          {lookup.item.denumire2 && (
            <div className="text-sm text-success-900">{lookup.item.denumire2}</div>
          )}
          {lookup.item.description && (
            <div className="text-xs text-success-800/80">{lookup.item.description}</div>
          )}
          <div className="text-xs font-mono text-success-900 pt-1">
            Mijloc fix: {lookup.item.mijloc_fix}
            {lookup.item.mijloc_fix_orig ? ` · Mijloc fix original: ${lookup.item.mijloc_fix_orig}` : ''}
            {` · Cod scanat: ${lookup.code}`}
          </div>
        </div>
      )}

      {!continuous && lookup.status === 'miss' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Negăsit în catalog
          </div>
          <div className="font-semibold text-amber-950">Articol necunoscut: {lookup.code}</div>
          <div className="text-xs text-amber-900">
            Se va adăuga ca articol necunoscut (evidențiat cu galben în stoc). Completează datele
            și confirmă.
          </div>
        </div>
      )}

      {!continuous && (lookup.status === 'hit' || lookup.status === 'miss') && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          {sourceField}
          {companyField}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cantitate</label>
              <input
                type="number"
                min={1}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm"
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            {placeField}
          </div>
          <button
            type="button"
            disabled={busy || !sourceFrom.trim() || !company.trim()}
            onClick={() => void confirm()}
            className="w-full min-h-[48px] bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-lg text-base sm:text-sm"
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
        <div
          role="status"
          className="flex items-start gap-2 text-sm text-success-900 bg-success-50 border border-success-300 border-l-4 border-l-success-500 rounded-lg px-3 py-2"
        >
          <span aria-hidden="true" className="font-bold text-success-700">
            ✓
          </span>
          <span>{success}</span>
        </div>
      )}

      {/* Scan confirmation toast (continuous mode) — fixed so it is visible above the camera */}
      {continuous && confirmation && (
        <div
          role="status"
          aria-live="assertive"
          className={`fixed inset-x-3 bottom-4 z-50 mx-auto max-w-xl rounded-2xl border-2 px-4 py-3 shadow-xl ${
            confirmation.kind === 'ok'
              ? 'bg-success-400 border-success-600 text-success-950'
              : confirmation.kind === 'warn'
                ? 'bg-amber-300 border-amber-500 text-amber-950'
                : 'bg-red-600 border-red-700 text-white'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none font-bold" aria-hidden="true">
              {confirmation.kind === 'ok' ? '✓' : confirmation.kind === 'warn' ? '!' : '✕'}
            </span>
            <div className="min-w-0">
              <div className="font-mono text-sm font-semibold break-all">{confirmation.code}</div>
              <div className="text-base font-semibold break-words">
                {confirmation.kind === 'error' ? `Eroare: ${confirmation.text}` : confirmation.text}
              </div>
            </div>
            <span className="ml-auto text-sm font-bold tabular-nums whitespace-nowrap">
              #{okCount}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
