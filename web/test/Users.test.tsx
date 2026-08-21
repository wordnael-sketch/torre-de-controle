import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPage } from '../src/pages/Users';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      listUsers: vi.fn(),
      inviteUser: vi.fn(),
      setUserRole: vi.fn(),
      setUserStatus: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

describe('UsersPage', () => {
  beforeEach(() => {
    mockedApi.listUsers.mockReset();
    mockedApi.inviteUser.mockReset();
    mockedApi.setUserRole.mockReset();
    mockedApi.setUserStatus.mockReset();
  });

  it('lists existing users with their role and status', async () => {
    mockedApi.listUsers.mockResolvedValue({
      users: [
        { id: 1, email: 'wilka@ilhacrossmidia.com.br', name: 'Wilka', role: 'admin', status: 'active', boardDensity: 'agrupado' },
      ],
    });

    render(<UsersPage />);

    expect(await screen.findByText('wilka@ilhacrossmidia.com.br')).toBeInTheDocument();
  });

  it('invites a new user and refreshes the list', async () => {
    mockedApi.listUsers
      .mockResolvedValueOnce({ users: [] })
      .mockResolvedValueOnce({
        users: [{ id: 2, email: 'nova@ilhacrossmidia.com.br', name: null, role: 'member', status: 'invited', boardDensity: 'agrupado' }],
      });
    mockedApi.inviteUser.mockResolvedValue({
      user: { id: 2, email: 'nova@ilhacrossmidia.com.br', name: null, role: 'member', status: 'invited', boardDensity: 'agrupado' },
    });

    const user = userEvent.setup();
    render(<UsersPage />);

    await screen.findByText('Usuários');

    await user.type(screen.getByLabelText('E-mail'), 'nova@ilhacrossmidia.com.br');
    await user.click(screen.getByRole('button', { name: 'Convidar' }));

    await waitFor(() =>
      expect(mockedApi.inviteUser).toHaveBeenCalledWith({ email: 'nova@ilhacrossmidia.com.br', role: 'member' }),
    );
    expect(await screen.findByText('nova@ilhacrossmidia.com.br')).toBeInTheDocument();
  });

  it('revokes a user', async () => {
    mockedApi.listUsers.mockResolvedValue({
      users: [{ id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'active', boardDensity: 'agrupado' }],
    });
    mockedApi.setUserStatus.mockResolvedValue({
      user: { id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'revoked', boardDensity: 'agrupado' },
    });

    const user = userEvent.setup();
    render(<UsersPage />);

    await user.click(await screen.findByRole('button', { name: 'Revogar' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(mockedApi.setUserStatus).toHaveBeenCalledWith(3, 'revoked'));
  });

  it('shows a confirmation dialog before revoking access', async () => {
    mockedApi.listUsers.mockResolvedValue({
      users: [{ id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'active', boardDensity: 'agrupado' }],
    });
    const user = userEvent.setup();

    render(<UsersPage />);

    await user.click(await screen.findByRole('button', { name: 'Revogar' }));

    expect(await screen.findByText(/Revogar acesso de revogavel@ilhacrossmidia.com.br/)).toBeInTheDocument();
    expect(mockedApi.setUserStatus).not.toHaveBeenCalled();

    mockedApi.setUserStatus.mockResolvedValue({
      user: { id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'revoked', boardDensity: 'agrupado' },
    });
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(mockedApi.setUserStatus).toHaveBeenCalledWith(3, 'revoked'));
  });
});
