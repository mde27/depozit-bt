import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import BarcodeScan, { scansPayload } from '../components/BarcodeScan';
import StatusBadge from '../components/StatusBadge';
import type { ScanLine, Ticket } from '../lib/types';

type Stage = 'send' | 'deliver' | 'return_out' | 'receive_back';

const STAGE_META: Record<
  Stage,
  { title: string; action: string; hint: string; compareOrder: boolean; allowMismatchComment?: boolean }
> = {
  send: {
    title: 'Trimitere — scanare',
    action: 'SEND',
    hint: 'Scanează exact articolele și cantitățile din comandă. Dacă totul se potrivește, confirmă trimiterea. Dacă ceva lipsește sau diferă, scrie un comentariu și trimite cererea la corectat.',
    compareOrder: true,
    allowMismatchComment: true,
  },
  deliver: {
    title: 'Livrare — ce s-a livrat',
    action: 'DELIVER',
    hint: 'Înregistrează ce a primit clientul. Stocul nu se modifică.',
    compareOrder: false,
  },
  return_out: {
    title: 'Predare retur — ce se trimite înapoi',
    action: 'RETURN_OUT',
    hint: 'Poate fi diferit de comandă. Stocul nu se modifică.',
    compareOrder: false,
  },
  receive_back: {
    title: 'Recepție retur — ce a ajuns în magazie',
    action: 'RECEIVE_BACK',
    hint: 'Scanează ce a ajuns în magazie. Articolele intră înapoi în stoc, iar tichetul se închide.',
    compareOrder: false,
  },
};

export default function TicketScanPage() {
  const { id, stage: stageParam } = useParams();
  const stage = (stageParam || 'send') as Stage;
  const meta = STAGE_META[stage];
  const nav = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [lines, setLines] = useState<ScanLine[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!meta) return;
    api<{ ticket: Ticket }>(`/api/tickets/${id}`)
      .then((d) => setTicket(d.ticket))
      .catch((e) => setError(e.message));
  }, [id, meta]);

  if (!meta) {
    return <p className="text-red-600">Pagina nu există.</p>;
  }

  async function submit(action: string) {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ ticket: Ticket }>(`/api/tickets/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          comment: comment || undefined,
          scans: scansPayload(lines),
        }),
      });
      nav(`/tichete/${data.ticket.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Eroare');
    } finally {
      setBusy(false);
    }
  }

  const expected =
    meta.compareOrder && ticket?.items
      ? ticket.items.map((it) => ({
          barcode: it.barcode,
          name: it.stock_name,
          ordered_qty: it.ordered_qty,
        }))
      : undefined;

  return (
    <div className="space-y-4 max-w-xl">
      <Link to={`/tichete/${id}`} className="text-sm text-brand-700 hover:underline">
        ← Înapoi la tichet
      </Link>
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-bold">{meta.title}</h1>
        {ticket && <StatusBadge status={ticket.status} />}
      </div>
      {ticket && (
        <p className="text-sm text-slate-600">
          <span className="font-mono">{ticket.ticket_code}</span> · {ticket.client_name}
        </p>
      )}

      <BarcodeScan
        hint={meta.hint}
        expected={expected}
        onChange={setLines}
      />

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Comentariu</label>
        <textarea
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={
            meta.allowMismatchComment
              ? 'Obligatoriu pentru „Trimite la corectat”'
              : 'Opțional'
          }
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || lines.length === 0}
          onClick={() => submit(meta.action)}
          className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm"
        >
          {stage === 'send'
            ? 'Confirmă trimiterea'
            : stage === 'deliver'
              ? 'Confirmă livrarea'
              : stage === 'return_out'
                ? 'Confirmă predarea returului'
                : 'Confirmă recepția'}
        </button>
        {meta.allowMismatchComment && (
          <button
            disabled={busy || !comment.trim()}
            onClick={() => submit('SEND_WITH_COMMENT')}
            className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm"
          >
            Trimite la corectat
          </button>
        )}
      </div>
    </div>
  );
}
