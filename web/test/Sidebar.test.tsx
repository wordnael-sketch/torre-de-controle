import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Sidebar } from '../src/components/Sidebar';
import { AuthProvider } from '../src/auth/AuthContext';
import { api, type User } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      logout: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const memberUser: User = {
  id: 1,
  email: 'wilka@ilhacrossmidia.com.br',
  name: 'Wilka',
  role: 'member',
  status: 'active',
  boardDensity: 'agrupado',
};

function renderSidebar(initialEntries: string[] = ['/'], user: User = memberUser) {
  mockedApi.me.mockResolvedValue({ user });
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
    mockedApi.logout.mockReset();
    mockedApi.logout.mockResolvedValue(undefined);
  });

  it('shows Painel and Dashboard links, but not Usuários, for a non-admin member', async () => {
    renderSidebar();

    expect(await screen.findByRole('link', { name: /Painel/ })).toHaveAttribute('href', '/painel');
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: /Usuários/ })).not.toBeInTheDocument();
  });

  it('also shows the Usuários link for an admin', async () => {
    renderSidebar(['/'], { ...memberUser, role: 'admin' });

    expect(await screen.findByRole('link', { name: /Usuários/ })).toHaveAttribute('href', '/usuarios');
  });

  it('marks the current route as the active nav link', async () => {
    renderSidebar(['/painel']);

    const painelLink = await screen.findByRole('link', { name: /Painel/ });
    expect(painelLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute('aria-current');
  });

  it('shows the logged-in user email and logs out on click', async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(await screen.findByText('wilka@ilhacrossmidia.com.br')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(mockedApi.logout).toHaveBeenCalled();
  });

  it('toggles the mobile drawer open and closed via the topbar button', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await screen.findByRole('link', { name: /Painel/ });
    const toggle = screen.getByRole('button', { name: 'Abrir menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Fechar menu' })).toHaveAttribute('aria-expanded', 'true');
  });
});
