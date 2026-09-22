import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export default function Login() {
  const { user, loading, login } = useAuth();
  const [username, setUsername] = useState('user1');
  const [password, setPassword] = useState('user123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eroare autentificare');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgba(15,39,68,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,39,68,0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="relative w-full max-w-md bt-card p-8 sm:p-10">
        <div className="text-center mb-8">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-900 to-blue-700 text-white flex items-center justify-center text-2xl font-bold mb-4 shadow-lg shadow-blue-900/25">
            BT
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Depozit BT</h1>
          <p className="text-slate-500 text-sm mt-2 leading-relaxed">
            Magazie · barcode · cerere → trimitere → livrare → retur
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Utilizator</label>
            <input
              className="bt-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Parolă</label>
            <input
              type="password"
              className="bt-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5">
              {error}
            </div>
          )}
          <button type="submit" disabled={busy} className="bt-btn-primary w-full py-3">
            {busy ? 'Se autentifică…' : 'Autentificare'}
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-8 text-center leading-relaxed border-t border-slate-100 pt-5">
          Demo: <span className="font-mono text-slate-500">admin / admin123</span>
          <br />
          <span className="font-mono text-slate-500">user1–user4 / user123</span>
        </p>
      </div>
    </div>
  );
}
