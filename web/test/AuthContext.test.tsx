import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <p>loading</p>;
  return <p>{user ? `logged in as ${user.email}` : 'logged out'}</p>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
  });

  it('sets user to null when /me fails', async () => {
    mockedApi.me.mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => screen.getByText('logged out'));
  });

  it('sets the user when /me succeeds', async () => {
    mockedApi.me.mockResolvedValue({ user: { id: 1, email: 'wilka@ilhacrossmidia.com.br' } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => screen.getByText('logged in as wilka@ilhacrossmidia.com.br'));
  });
});
