import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { downloadCsv, toCsv, type ExportCell, type ExportColumn } from '../lib/csv';
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from '../lib/dates';

type Kind = 'stock' | 'movements' | 'tickets';

interface Options {
  kinds: Kind[];
  companyLocked: string | null;
  companies: string[];
  places: string[];
  reasons: { code: string; label: string }[];
  statuses: { code: string; label: string }[];
  creators: string[];
  limit: number;
  today: string;
}

interface ExportResult {
  kind: Kind;
  columns: ExportColumn[];
  rows: ExportCell[][];
  total: number;
  truncated: boolean;
  limit: number;
  filename: string;
}

const KIND_LABELS: Record<Kind, { title: string; desc: string }> = {
  stock: { title: 'Stoc curent', desc: 'Articolele din stoc, cu cantitățile de acum' },
  movements: { title: 'Mișcări stoc', desc: 'Intrări, ieșiri, retururi și corecții pe o perioadă' },
  tickets: { title: 'Cereri', desc: 'Tichetele create într-o perioadă (sumar sau pe linii)' },
};

const NO_COMPANY = '__none__';
const PREVIEW_ROWS = 10;

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function Exports() {
  const { user } = useAuth();
  const [options, setOptions] = useState<Options | null>(null);
  const [kind, setKind] = useState<Kind>('stock');

  // filtre
  const [company, setCompany] = useState('');
  const [place, setPlace] = useState('');
  const [uncatalogued, setUncatalogued] = useState(false);
  const [inStock, setInStock] = useState(false);
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creator, setCreator] = useState('');
  const [variant, setVariant] = useState<'summary' | 'detailed'>('summary');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);

  useEffect(() => {
    api<Options>('/api/exports/options')
      .then((o) => {
        setOptions(o);
        setKind(o.kinds[0] ?? 'tickets');
        const r = presetRange('thisMonth', o.today);
        setFrom(r.from);
        setTo(r.to);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Eroare la încărcare'));
  }, []);

  const isUser1 = user?.role === 'user1';
  const usesPeriod = kind === 'movements' || kind === 'tickets';

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (kind !== 'tickets' || !isUser1) {
      if (company && !options?.companyLocked) q.set('company', company);
    }
    if (kind === 'stock') {
      if (place) q.set('place', place);
      if (uncatalogued) q.set('uncatalogued', '1');
      if (inStock) q.set('in_stock', '1');
    }
    if (usesPeriod) {
      if (from) q.set('from', from);
      if (to) q.set('to', to);
    }
    if (kind === 'movements') {
      if (reason) q.set('reason', reason);
      if (search.trim()) q.set('q', search.trim());
    }
    if (kind === 'tickets') {
      q.set('variant', variant);
      if (status) q.set('status', status);
      if (creator && !isUser1) q.set('created_by', creator);
    }
    return q.toString();
  }, [
    kind,
    company,
    place,
    uncatalogued,
    inStock,
    from,
    to,
    reason,
    search,
    status,
    creator,
    variant,
    usesPeriod,
    isUser1,
    options?.companyLocked,
  ]);

  // Orice schimbare de filtre invalidează previzualizarea
  useEffect(() => {
    setResult(null);
  }, [query]);

  function applyPreset(p: PeriodPreset) {
    setPreset(p);
    if (p !== 'custom') {
      const r = presetRange(p, options?.today);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  async function fetchExport(): Promise<ExportResult | null> {
    if (usesPeriod && from && to && from > to) {
      setError('Data „de la” este după data „până la”.');
      return null;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api<ExportResult>(`/api/exports/${kind}?${query}`);
      setResult(data);
      return data;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Eroare la export');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const data = result ?? (await fetchExport());
    if (!data) return;
    if (data.rows.length === 0) {
      setError('Nu există rânduri pentru filtrele alese.');
      return;
    }
    downloadCsv(data.filename, toCsv(data.columns, data.rows));
  }

  if (!options) {
    return error ? (
      <p className="text-red-600">{error}</p>
    ) : (
      <p className="text-slate-400">Se încarcă…</p>
    );
  }

  const companySelect = (label: string) =>
    options.companyLocked ? (
      <Field label={label}>
        <div className="px-3 py-2 text-sm rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
          {options.companyLocked}
        </div>
      </Field>
    ) : (
      <Field label={label}>
        <select className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">Toate firmele</option>
          <option value={NO_COMPANY}>(fără firmă)</option>
          {options.companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
    );

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Exporturi</h1>
        <p className="text-sm text-slate-500">
          Fișiere CSV pentru Excel (separator „;”, diacritice corecte). Orele sunt în ora României.
        </p>
      </div>

      {options.kinds.length > 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {options.kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`text-left rounded-xl border px-4 py-3 transition ${
                kind === k
                  ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="font-semibold text-slate-900 text-sm">{KIND_LABELS[k].title}</div>
              <div className="text-xs text-slate-500">{KIND_LABELS[k].desc}</div>
            </button>
          ))}
        </div>
      )}

      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <h2 className="font-semibold text-slate-800">
          {KIND_LABELS[kind].title} — filtre
        </h2>

        {usesPeriod && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {PERIOD_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                    preset === p.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="De la (inclusiv)">
                <input
                  type="date"
                  className={inputCls}
                  value={from}
                  onChange={(e) => {
                    setPreset('custom');
                    setFrom(e.target.value);
                  }}
                />
              </Field>
              <Field label="Până la (inclusiv)">
                <input
                  type="date"
                  className={inputCls}
                  value={to}
                  onChange={(e) => {
                    setPreset('custom');
                    setTo(e.target.value);
                  }}
                />
              </Field>
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {kind === 'stock' && (
            <>
              {companySelect('Firmă')}
              <Field label="Locație">
                <select className={inputCls} value={place} onChange={(e) => setPlace(e.target.value)}>
                  <option value="">Toate locațiile</option>
                  <option value={NO_COMPANY}>(fără locație)</option>
                  {options.places.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={uncatalogued}
                  onChange={(e) => setUncatalogued(e.target.checked)}
                />
                Doar articole necunoscute (necatalogate)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />
                Doar cu cantitate &gt; 0
              </label>
            </>
          )}

          {kind === 'movements' && (
            <>
              {companySelect('Firmă')}
              <Field label="Motiv">
                <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Toate motivele</option>
                  {options.reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Caută articol (SKU, barcode, denumire, MF)">
                  <input
                    className={inputCls}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ex. palet / 5901234…"
                  />
                </Field>
              </div>
            </>
          )}

          {kind === 'tickets' && (
            <>
              <Field label="Variantă">
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['summary', 'Sumar (1 rând / cerere)'],
                      ['detailed', 'Detaliat (1 rând / articol)'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVariant(v)}
                      className={`px-2 py-2 rounded-lg text-xs font-medium ${
                        variant === v
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Status">
                <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Toate statusurile</option>
                  {options.statuses.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              {isUser1 ? (
                <p className="sm:col-span-2 text-xs text-slate-500">
                  Se exportă doar cererile create de tine.
                </p>
              ) : (
                <>
                  {companySelect('Firmă (a celui care a creat cererea)')}
                  <Field label="Creat de">
                    <select
                      className={inputCls}
                      value={creator}
                      onChange={(e) => setCreator(e.target.value)}
                    >
                      <option value="">Toți utilizatorii</option>
                      {options.creators.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
            </>
          )}
        </div>

        {options.companyLocked && kind !== 'tickets' && (
          <p className="text-xs text-slate-500">
            Exportul include doar articolele firmei tale: <strong>{options.companyLocked}</strong>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void fetchExport()}
            className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
          >
            {busy ? 'Se încarcă…' : 'Previzualizare'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void download()}
            className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            Descarcă CSV
          </button>
        </div>
      </section>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-slate-800">
              {result.total.toLocaleString('ro-RO')} rânduri
            </h2>
            <span className="text-xs text-slate-500 font-mono">{result.filename}</span>
          </div>
          {result.truncated && (
            <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Rezultatul depășește limita de {result.limit.toLocaleString('ro-RO')} rânduri — fișierul
              va conține doar primele {result.limit.toLocaleString('ro-RO')}. Restrânge perioada sau
              filtrele.
            </div>
          )}
          {result.rows.length > 0 ? (
            <>
              <div className="overflow-x-auto border border-slate-100 rounded-lg">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c.key} className="px-2 py-1.5 whitespace-nowrap font-semibold">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {result.columns.map((c, j) => (
                          <td
                            key={c.key}
                            className={`px-2 py-1.5 whitespace-nowrap ${
                              c.type === 'number' ? 'text-right tabular-nums' : ''
                            } ${c.type === 'code' ? 'font-mono' : ''}`}
                          >
                            {r[j] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length > PREVIEW_ROWS && (
                <p className="text-xs text-slate-500">
                  Previzualizare: primele {PREVIEW_ROWS} rânduri.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">Nu există rânduri pentru filtrele alese.</p>
          )}
        </section>
      )}
    </div>
  );
}
