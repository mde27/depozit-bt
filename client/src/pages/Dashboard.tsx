import { Link } from 'react-router-dom';
import { useAuth, ROLE_LABELS } from '../lib/auth';

export default function Dashboard() {
  const { user } = useAuth();
  const role = user?.role;

  const cards: { to: string; title: string; desc: string; color: string; icon: string }[] = [];

  if (role === 'user1' || role === 'admin') {
    cards.push({
      to: '/cerere',
      title: 'Cerere nouă',
      desc: 'Completează formularul de ridicare / livrare',
      color: 'from-slate-900 via-slate-800 to-blue-700',
      icon: '📝',
    });
  }
  cards.push({
    to: '/tichete',
    title: 'Tichete',
    desc:
      role === 'user2'
        ? 'Coadă ORDERED (trimitere) + RETURNING (recepție retur)'
        : role === 'user3'
          ? 'Coadă SENT — livrare'
          : role === 'user4'
            ? 'Coadă DELIVERED — retur outbound'
            : role === 'user1'
              ? 'Tichetele tale · corectează NEEDS_FIX'
              : 'Toate tichetele & statusuri',
    color: 'from-blue-700 to-sky-600',
    icon: '🎫',
  });
  if (role === 'admin' || role === 'user2') {
    cards.push({
      to: '/stock',
      title: 'Stoc live',
      desc: 'Cantități, barcode, ledger mișcări',
      color: 'from-slate-700 to-slate-900',
      icon: '📦',
    });
  }
  if (role === 'admin') {
    cards.push({
      to: '/logs',
      title: 'Jurnal',
      desc: 'Activity log',
      color: 'from-slate-800 to-blue-900',
      icon: '📋',
    });
    cards.push({
      to: '/users',
      title: 'Utilizatori',
      desc: 'Admin users stub',
      color: 'from-slate-600 to-slate-800',
      icon: '👤',
    });
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-600 mb-1">
          Bun venit
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          {user?.username}
        </h1>
        <p className="text-slate-500 mt-1">{role ? ROLE_LABELS[role] : ''}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link
            key={c.to + c.title}
            to={c.to}
            className={`rounded-2xl p-6 text-white bg-gradient-to-br ${c.color} shadow-lg shadow-slate-900/10 hover:scale-[1.02] hover:shadow-xl transition`}
          >
            <div className="text-2xl mb-3 opacity-90">{c.icon}</div>
            <h2 className="text-xl font-bold">{c.title}</h2>
            <p className="text-white/85 text-sm mt-1.5 leading-relaxed">{c.desc}</p>
          </Link>
        ))}
      </div>
      <div className="mt-8 bt-card p-5 text-sm text-slate-600">
        <h3 className="font-semibold text-slate-800 mb-3">Flux statusuri</h3>
        <ol className="list-decimal list-inside space-y-1.5">
          <li>
            <strong>user1</strong> creează → <code>ORDERED</code>
          </li>
          <li>
            <strong>user2</strong> Trimitere (scan match) → <code>SENT</code> (−stoc) sau cu
            comentariu → <code>NEEDS_FIX</code>
          </li>
          <li>
            <strong>user3</strong> scan livrare → <code>DELIVERED</code> (fără stoc)
          </li>
          <li>
            <strong>user4</strong> scan retur outbound → <code>RETURNING</code> (fără stoc)
          </li>
          <li>
            <strong>user2</strong> recepție retur (scan) → <code>CLOSED</code> (+stoc)
          </li>
        </ol>
      </div>
    </div>
  );
}
