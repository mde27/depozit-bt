import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export const STOCK_SEARCH_PLACEHOLDER = 'Caută după denumire, cod, mijloc fix, locație…';

interface Props {
  /** Valoarea aplicată (după debounce). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Text sub câmp, ex. „12 rezultate”. */
  count?: string | null;
  delayMs?: number;
  className?: string;
  label?: string;
}

/** Câmp de căutare comun: debounce ~200 ms, buton ×, prietenos pe telefon. */
export default function SearchBox({
  value,
  onChange,
  placeholder = STOCK_SEARCH_PLACEHOLDER,
  count,
  delayMs = 200,
  className = '',
  label = 'Caută',
}: Props) {
  const [text, setText] = useState(value);
  const cb = useRef(onChange);
  cb.current = onChange;
  const inputRef = useRef<HTMLInputElement>(null);

  // valoare schimbată din afară (ex. URL)
  useEffect(() => {
    setText((t) => (t.trim() === value.trim() ? t : value));
  }, [value]);

  useEffect(() => {
    if (text === value) return;
    const t = window.setTimeout(() => cb.current(text), delayMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delayMs]);

  return (
    <div className={`w-full sm:max-w-md ${className}`}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.63 3.64a.75.75 0 1 0 1.06-1.06l-3.64-3.63A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label={label}
          className="w-full min-h-[44px] border border-slate-300 rounded-lg pl-9 pr-11 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 [&::-webkit-search-cancel-button]:hidden"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              cb.current(text);
            } else if (e.key === 'Escape' && text) {
              setText('');
              cb.current('');
            }
          }}
        />
        {text && (
          <button
            type="button"
            aria-label="Șterge căutarea"
            onClick={() => {
              setText('');
              cb.current('');
              inputRef.current?.focus();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-xl leading-none text-slate-500 hover:text-slate-800"
          >
            ×
          </button>
        )}
      </div>
      {count ? <p className="mt-1 text-xs text-slate-500" aria-live="polite">{count}</p> : null}
    </div>
  );
}

/** Textul căutării păstrat în URL (?q=), ca să rămână după refresh. */
export function useUrlSearch(param = 'q'): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(param) ?? '';
  const set = (v: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v.trim()) next.set(param, v);
        else next.delete(param);
        return next;
      },
      { replace: true }
    );
  };
  return [value, set];
}

export function EmptySearch({ query }: { query: string }) {
  return (
    <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-6 text-center">
      Niciun rezultat pentru „{query.trim()}”
    </p>
  );
}
