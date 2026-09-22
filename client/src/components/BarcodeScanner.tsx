import { useEffect, useId, useRef, useState } from 'react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';

interface Props {
  onScan: (barcode: string) => void;
  /** Debounce window for the same code (ms). Default 1500 */
  debounceMs?: number;
  className?: string;
}

/**
 * Live camera barcode/QR scanner using html5-qrcode (lazy-loaded).
 * Requires HTTPS or localhost for getUserMedia.
 * Prefers rear camera on phones (facingMode: environment).
 * Safe when camera is missing — shows a message, no crash.
 */
export default function BarcodeScanner({
  onScan,
  debounceMs = 1500,
  className = '',
}: Props) {
  const reactId = useId().replace(/:/g, '');
  const elementId = `bt-qr-reader-${reactId}`;
  const scannerRef = useRef<Html5QrcodeType | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    return () => {
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s
          .stop()
          .then(() => s.clear())
          .catch(() => {
            try {
              s.clear();
            } catch {
              /* ignore */
            }
          });
      }
    };
  }, []);

  async function start() {
    setError('');
    setStarting(true);
    try {
      if (typeof window === 'undefined') {
        throw new Error('Camera disponibilă doar în browser');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera indisponibilă în acest browser. Folosește introducerea manuală sau deschide pe HTTPS / localhost.'
        );
      }

      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

      const scanner = new Html5Qrcode(elementId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 8,
          qrbox: (viewW, viewH) => {
            const w = Math.min(280, Math.floor(viewW * 0.85));
            const h = Math.min(160, Math.floor(viewH * 0.35));
            return { width: w, height: h };
          },
          aspectRatio: 1.777,
        },
        (decodedText) => {
          const code = String(decodedText || '').trim();
          if (!code) return;
          const now = Date.now();
          if (
            lastRef.current.code === code &&
            now - lastRef.current.at < debounceMs
          ) {
            return;
          }
          lastRef.current = { code, at: now };
          setFlash(code);
          onScanRef.current(code);
          window.setTimeout(() => setFlash((f) => (f === code ? '' : f)), 1200);
        },
        () => {
          /* frame miss — ignore */
        }
      );
      setActive(true);
    } catch (e: unknown) {
      scannerRef.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      const name =
        e && typeof e === 'object' && 'name' in e
          ? String((e as { name: string }).name)
          : '';
      if (name === 'NotAllowedError' || /permission|denied|NotAllowed/i.test(msg)) {
        setError(
          'Acces cameră refuzat. Activează permisiunea în browser, apoi încearcă din nou. Poți introduce barcode-ul manual.'
        );
      } else if (name === 'NotFoundError' || /not found|no camera/i.test(msg)) {
        setError(
          'Nicio cameră detectată pe acest dispozitiv. Folosește introducerea manuală.'
        );
      } else {
        setError(msg || 'Nu s-a putut porni camera');
      }
      setActive(false);
      try {
        const el = document.getElementById(elementId);
        if (el) el.innerHTML = '';
      } catch {
        /* ignore */
      }
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    setStarting(true);
    const s = scannerRef.current;
    scannerRef.current = null;
    try {
      if (s?.isScanning) {
        await s.stop();
      }
      s?.clear();
    } catch {
      try {
        s?.clear();
      } catch {
        /* ignore */
      }
    } finally {
      setActive(false);
      setStarting(false);
      setFlash('');
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!active ? (
          <button
            type="button"
            disabled={starting}
            onClick={() => void start()}
            className="bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {starting ? 'Se pornește…' : '📷 Pornește camera'}
          </button>
        ) : (
          <button
            type="button"
            disabled={starting}
            onClick={() => void stop()}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Oprește camera
          </button>
        )}
        {flash && (
          <span className="text-xs font-mono bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full animate-pulse">
            Scanat: {flash}
          </span>
        )}
      </div>

      <div
        id={elementId}
        className={`overflow-hidden rounded-xl border border-slate-200 bg-black/90 ${
          active ? 'min-h-[200px]' : 'min-h-0'
        }`}
      />

      {error && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {!active && !error && (
        <p className="text-xs text-slate-400">
          Camera necesită <strong>localhost</strong> sau <strong>HTTPS</strong>. Pe telefon se
          preferă camera din spate. Debounce ~1.5s pe același cod.
        </p>
      )}
    </div>
  );
}
