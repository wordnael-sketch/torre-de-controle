import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { api, request } from '../src/api/client';

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
    mockedApi.me.mockResolvedValue({ user: { id: 1, email: 'wilka@ilhacrossmidia.com.br', role: 'admin', status: 'active' } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => screen.getByText('logged in as wilka@ilhacrossmidia.com.br'));
  });

  it('clears the user when a session-expired notification arrives', async () => {
    mockedApi.me.mockResolvedValue({ user: { id: 1, email: 'wilka@ilhacrossmidia.com.br', role: 'admin', status: 'active' } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => screen.getByText('logged in as wilka@ilhacrossmidia.com.br'));

    // `request` and `onSessionExpired` are the REAL implementations here — the
    // vi.mock above only overrides `api`, everything else passes through via
    // vi.importActual. So AuthContext's own useEffect registered its listener
    // with the real onSessionExpired, and driving a real 401 through the real
    // request() is what exercises that wiring end-to-end.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Not authenticated' }),
      }),
    );

    await act(async () => {
      await expect(request('/api/jobs')).rejects.toThrow();
    });

    await waitFor(() => screen.getByText('logged out'));

    vi.unstubAllGlobals();
  });
});
