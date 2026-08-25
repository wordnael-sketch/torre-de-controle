import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, LayoutDashboard, PieChart, Users, LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import logoIlha from '../assets/logo-ilha.jpg';
import './Sidebar.css';

export function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  const navItems = [
    { to: '/painel', label: 'Painel', icon: <PieChart size={18} aria-hidden="true" /> },
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} aria-hidden="true" /> },
    ...(user.role === 'admin'
      ? [{ to: '/usuarios', label: 'Usuários', icon: <Users size={18} aria-hidden="true" /> }]
      : []),
  ];

  return (
    <>
      <div className="sidebar-topbar">
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
          aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
        <span className="sidebar-topbar-title">Torre de Controle</span>
      </div>

      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside id="app-sidebar" className={`app-sidebar${mobileOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <img src={logoIlha} alt="Ilha Crossmídia" className="sidebar-logo" />
          <div>
            <p className="sidebar-brand-name">Ilha Crossmídia</p>
            <p className="sidebar-brand-sub">Torre de Controle</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`sidebar-nav-link${location.pathname === item.to ? ' is-active' : ''}`}
              aria-current={location.pathname === item.to ? 'page' : undefined}
              onClick={() => setMobileOpen(false)}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p className="sidebar-footer-email">{user.email}</p>
          <button type="button" className="sidebar-logout-btn" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}
