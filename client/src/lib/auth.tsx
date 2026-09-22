import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';

export type Role = 'admin' | 'user1' | 'user2' | 'user3' | 'user4';

export interface User {
  id: number;
  username: string;
  role: Role;
  company: string | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  user1: 'Cereri (user1)',
  user2: 'Magazie (user2)',
  user3: 'Curier (user3)',
  user4: 'Retur (user4)',
};
