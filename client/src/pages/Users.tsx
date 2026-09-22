import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

interface U {
  id: number;
  username: string;
  role: string;
  company: string | null;
  created_at: string;
}

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState<U[]>([]);
  const [form, setForm] = useState({
    username: '',
    password: '',
    role: 'user1',
    company: '',
  });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const data = await api<{ users: U[] }>('/api/users');
    setUsers(data.users);
  }

  useEffect(() => {
    if (user?.role === 'admin') load().catch((e) => setError(e.message));
  }, [user]);

  if (user?.role !== 'admin') {
    return <p className="text-red-600">Doar admin</p>;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          company: form.company || null,
        }),
      });
      setMsg('Utilizator creat');
      setForm({ username: '', password: '', role: 'user1', company: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eroare');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Utilizatori</h1>
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Companie</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{u.id}</td>
                <td className="px-3 py-2 font-medium">{u.username}</td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2">{u.company || '—'}</td>
              </tr>
            ))}
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
          {['admin', 'user1', 'user2', 'user3', 'user4'].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="company (opțional)"
          value={form.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {msg && <p className="text-emerald-600 text-sm">{msg}</p>}
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Creează
        </button>
      </form>
    </div>
  );
}
