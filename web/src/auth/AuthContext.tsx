import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onSessionExpired, type BoardDensity, type User } from '../api/client';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  updateBoardDensity: (boardDensity: BoardDensity) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => onSessionExpired(() => setUser(null)), []);

  async function loginWithGoogle(idToken: string) {
    const res = await api.loginWithGoogle(idToken);
    setUser(res.user);
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  async function updateBoardDensity(boardDensity: BoardDensity) {
    const res = await api.setBoardDensity(boardDensity);
    setUser(res.user);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout, updateBoardDensity }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
