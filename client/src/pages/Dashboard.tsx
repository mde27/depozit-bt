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
      color: 'from-slate-900 via-slate-800 to-brand-700',
      icon: '📝',
    });
  }
  cards.push({
    to: '/tichete',
    title: 'Tichete',
    desc:
      role === 'user2'
        ? 'Comenzi de trimis și retururi de recepționat'
        : role === 'user3'
          ? 'Comenzi de livrat'
          : role === 'user4'
            ? 'Retururi de predat'
            : role === 'user1'
              ? 'Cererile tale și cele de corectat'
              : 'Toate tichetele și starea lor',
    color: 'from-brand-800 to-teal-700',
    icon: '🎫',
  });
  if (role === 'admin' || role === 'user2' || role === 'user1') {
    cards.push({
      to: '/stock',
      title: 'Stoc live',
      desc:
        role === 'user1'
          ? user?.company
            ? `Articolele firmei ${user.company} (doar vizualizare)`
            : 'Doar vizualizare — contul nu are firmă setată'
          : 'Cantități și coduri de bare',
      color: 'from-slate-700 to-slate-900',
      icon: '📦',
    });
  }
  if (role) {
    cards.push({
      to: '/exporturi',
      title: 'Exporturi',
      desc:
        role === 'user3' || role === 'user4'
          ? 'Descarcă cererile pentru Excel'
          : 'Descarcă stocul, mișcările și cererile pentru Excel',
      color: 'from-brand-700 to-brand-900',
      icon: '⬇️',
    });
  }
  if (role === 'admin') {
    cards.push({
      to: '/logs',
      title: 'Jurnal',
      desc: 'Istoric activitate',
      color: 'from-slate-800 to-brand-900',
      icon: '📋',
    });
    cards.push({
      to: '/users',
      title: 'Utilizatori',
      desc: 'Gestionare conturi',
      color: 'from-slate-600 to-slate-800',
      icon: '👤',
    });
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 mb-1">
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
    </div>
  );
}
