import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth, ROLE_LABELS } from '../lib/auth';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition ${
    isActive
      ? 'bg-slate-900 text-white shadow-sm'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

export default function Layout() {
  const { user, logout } = useAuth();
  const role = user?.role;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-md shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <Link to="/dashboard" className="flex items-center gap-2.5 group">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-900 to-blue-700 text-white text-sm font-bold shadow-md shadow-blue-900/20 group-hover:scale-105 transition">
              BT
            </span>
            <div className="leading-tight">
              <div className="font-bold text-slate-900 tracking-tight">Depozit BT</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Logistics
              </div>
            </div>
          </Link>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/dashboard" className={linkClass}>
              Dashboard
            </NavLink>
            {(role === 'user1' || role === 'admin') && (
              <NavLink to="/cerere" className={linkClass}>
                Cerere nouă
              </NavLink>
            )}
            <NavLink to="/tichete" className={linkClass}>
              Tichete
            </NavLink>
            {(role === 'admin' || role === 'user2') && (
              <NavLink to="/stock" className={linkClass}>
                Stoc
              </NavLink>
            )}
            {role === 'admin' && (
              <>
                <NavLink to="/logs" className={linkClass}>
                  Jurnal
                </NavLink>
                <NavLink to="/users" className={linkClass}>
                  Users
                </NavLink>
              </>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600 flex items-center gap-2">
              <span className="font-medium text-slate-800">{user?.username}</span>
              <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full ring-1 ring-slate-200/80">
                {role ? ROLE_LABELS[role] : ''}
              </span>
            </span>
            <button
              onClick={() => logout()}
              className="text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg font-medium transition"
            >
              Ieșire
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-4 border-t border-slate-200/60">
        Depozit BT · ticketing &amp; stoc
      </footer>
    </div>
  );
}
