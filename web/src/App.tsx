import type { ReactElement } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Login } from './pages/Login';
import { Board } from './pages/Board';
import { JobDetailPage } from './pages/JobDetail';
import { UsersPage } from './pages/Users';
import { ToastHost } from './components/Toast';
import logoIlha from './assets/logo-ilha.jpg';
import './App.css';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <p className="app-loading">Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <img src={logoIlha} alt="Ilha Crossmídia" className="app-header-logo" />
          <span className="app-header-email">{user.email}</span>
        </div>
        <nav className="app-nav">
          {user.role === 'admin' && (
            <Link to="/usuarios" className="app-nav-link">
              Usuários
            </Link>
          )}
          <button type="button" className="app-logout-btn" onClick={() => void logout()}>
            Sair
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}

function RequireAdmin({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children;
}

function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Login />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Board />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs/:id"
        element={
          <RequireAuth>
            <JobDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/usuarios"
        element={
          <RequireAuth>
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <ToastHost />
      </AuthProvider>
    </BrowserRouter>
  );
}
