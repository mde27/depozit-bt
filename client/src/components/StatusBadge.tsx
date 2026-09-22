const colors: Record<string, string> = {
  ORDERED: 'bg-amber-50 text-amber-800 ring-amber-200',
  NEEDS_FIX: 'bg-orange-50 text-orange-800 ring-orange-200',
  SENT: 'bg-sky-50 text-sky-800 ring-sky-200',
  DELIVERED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  RETURNING: 'bg-violet-50 text-violet-800 ring-violet-200',
  CLOSED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const dots: Record<string, string> = {
  ORDERED: 'bg-amber-500',
  NEEDS_FIX: 'bg-orange-500',
  SENT: 'bg-sky-500',
  DELIVERED: 'bg-emerald-500',
  RETURNING: 'bg-violet-500',
  CLOSED: 'bg-slate-400',
};

const labels: Record<string, string> = {
  ORDERED: 'Comandat',
  NEEDS_FIX: 'De corectat',
  SENT: 'Trimis',
  DELIVERED: 'Livrat',
  RETURNING: 'Retur în curs',
  CLOSED: 'Închis',
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${
        colors[status] || 'bg-slate-100 text-slate-700 ring-slate-200'
      }`}
      title={status}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${dots[status] || 'bg-slate-400'}`}
        aria-hidden
      />
      {labels[status] || status}
    </span>
  );
}
