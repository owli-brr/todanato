import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setOnAuthLost } from './api';

export interface Me {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  mustChangePassword: boolean;
  role: { key: string; name: string; scope: 'GLOBAL' | 'ORGANIZATION' | 'ASSOCIATION' };
  permissions: string[];
  association: { id: string; name: string; code: string } | null;
  organization: { id: string; name: string } | null;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (...perms: string[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const reload = useCallback(async () => {
    setUser(await api.get<Me>('/auth/me'));
  }, []);

  useEffect(() => {
    setOnAuthLost(() => { setAccessToken(null); setUser(null); qc.clear(); });
    // Restore the session from the refresh cookie on page load.
    refreshSession()
      .then(async (ok) => { if (ok) await reload(); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [qc, reload]);

  // Refresh the short-lived access token in the background.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { refreshSession(); }, 12 * 60 * 1000);
    return () => clearInterval(t);
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ accessToken: string; user: Me }>('/auth/login', { email, password });
    setAccessToken(r.accessToken);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const set = new Set(user?.permissions ?? []);
    return { user, loading, login, logout, reload, can: (...p) => p.every((x) => set.has(x)) };
  }, [user, loading, login, logout, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
