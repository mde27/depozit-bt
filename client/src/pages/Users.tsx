import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCompanies } from '../lib/companies';

interface U {
  id: number;
  username: string;
  role: string;
  company: string | null;
  created_at: string;
}

interface Edit {
  role: string;
  company: string;
  password: string;
}

const ROLES = ['admin', 'user1', 'user2', 'user3', 'user4'];

export default function Users() {
  const { user, refresh } = useAuth();
  const { companies, reload: reloadCompanies } = useCompanies();
  const [users, setUsers] = useState<U[]>([]);
  const [form, setForm] = useState({
    username: '',
    password: '',
    role: 'user1',
    company: '',
  });
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const data = await api<{ users: U[] }>('/api/users');
    setUsers(data.users);
  }

  useEffect(() => {
    if (user?.role === 'admin') load().catch((e) => setError(e.message));
  }, [user?.role]);

  if (user?.role !== 'admin') {
    return <p className="text-red-600">Doar admin</p>;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    if (form.role === 'user1' && !form.company.trim()) {
      setError('Firma este obligatorie pentru utilizatorii user1');
      return;
    }
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          company: form.company.trim() || null,
        }),
      });
      setMsg('Utilizator creat');
      setForm({ username: '', password: '', role: 'user1', company: '' });
      await load();
      void reloadCompanies();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eroare');
    }
  }

  function startEdit(u: U) {
    setEdits((prev) => ({
      ...prev,
      [u.id]: { role: u.role, company: u.company ?? '', password: '' },
    }));
  }

  function cancelEdit(id: number) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function patchEdit(id: number, patch: Partial<Edit>) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function saveEdit(u: U) {
    const ed = edits[u.id];
    if (!ed) return;
    setError('');
    setMsg('');
    if (ed.role === 'user1' && !ed.company.trim()) {
      setError(`Firma este obligatorie pentru utilizatorii user1 (${u.username})`);
      return;
    }
    setSavingId(u.id);
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          role: ed.role,
          company: ed.company.trim() || null,
          ...(ed.password.trim() ? { password: ed.password } : {}),
        }),
      });
      setMsg(
        `Utilizator ${u.username} actualizat${ed.password.trim() ? ' (parolă resetată)' : ''}`
      );
      cancelEdit(u.id);
      await load();
      void reloadCompanies();
      if (u.id === user?.id) await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eroare');
    } finally {
      setSavingId(null);
    }
  }

  const inputCls = 'w-full border border-slate-300 rounded-lg px-2 py-1 text-sm';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Utilizatori</h1>
      <datalist id="users-companies">
        {companies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {msg && <p className="text-emerald-600 text-sm">{msg}</p>}
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Companie</th>
              <th className="px-3 py-2">Parolă nouă</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const ed = edits[u.id];
              const missing = u.role === 'user1' && !u.company?.trim();
              return (
                <tr key={u.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">{u.id}</td>
                  <td className="px-3 py-2 font-medium">{u.username}</td>
                  <td className="px-3 py-2">
                    {ed ? (
                      <select
                        className={inputCls}
                        value={ed.role}
                        onChange={(e) => patchEdit(u.id, { role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      u.role
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {ed ? (
                      <input
                        className={inputCls}
                        list="users-companies"
                        autoComplete="off"
                        placeholder={ed.role === 'user1' ? 'firmă (obligatoriu)' : 'firmă (opțional)'}
                        value={ed.company}
                        required={ed.role === 'user1'}
                        onChange={(e) => patchEdit(u.id, { company: e.target.value })}
                      />
                    ) : missing ? (
                      <span className="text-amber-700 font-medium">lipsă — setează firma</span>
                    ) : (
                      u.company || '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {ed ? (
                      <input
                        type="password"
                        className={inputCls}
                        placeholder="neschimbată"
                        autoComplete="new-password"
                        value={ed.password}
                        onChange={(e) => patchEdit(u.id, { password: e.target.value })}
                      />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {ed ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={savingId === u.id}
                          onClick={() => void saveEdit(u)}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 rounded-lg text-xs font-medium"
                        >
                          {savingId === u.id ? 'Se salvează…' : 'Salvează'}
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelEdit(u.id)}
                          className="text-slate-600 hover:bg-slate-100 px-2 py-1 rounded-lg text-xs"
                        >
                          Renunță
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(u)}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        Editează
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={onSubmit}
        className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 max-w-md"
      >
        <h2 className="font-semibold">Adaugă user</h2>
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          required
        />
        <input
          type="password"
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <select
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder={form.role === 'user1' ? 'firmă (obligatoriu pentru user1)' : 'firmă (opțional)'}
            list="users-companies"
            autoComplete="off"
            value={form.company}
            required={form.role === 'user1'}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
          {form.role === 'user1' && (
            <p className="text-[11px] text-slate-500 mt-1">
              user1 vede doar articolele din stoc ale acestei firme.
            </p>
          )}
        </div>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Creează
        </button>
      </form>
    </div>
  );
}
