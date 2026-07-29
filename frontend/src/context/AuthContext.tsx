import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, getToken, setToken } from '@/lib/api';
import type { AuthUser } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      // Auth may be disabled on the backend - try /me without a token.
      authApi
        .me()
        .then((me) => {
          setUser({
            id: me.userId ?? 'anonymous',
            email: me.email,
            displayName: me.email,
            roles: me.roles ?? ['admin'],
          });
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
      return;
    }

    authApi
      .me()
      .then((me) => {
        setUser({
          id: me.userId ?? me.id ?? 'user',
          email: me.email,
          displayName: me.displayName ?? me.email,
          roles: me.roles ?? [],
        });
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    setToken(response.accessToken);
    setUser(response.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      isAuthenticated: Boolean(user),
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
