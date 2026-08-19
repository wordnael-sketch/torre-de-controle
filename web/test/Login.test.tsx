import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../src/pages/Login';
import { AuthProvider } from '../src/auth/AuthContext';
import { ApiError } from '../src/api/client';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      loginWithGoogle: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

vi.mock('@react-oauth/google', () => ({
  GoogleLogin: ({ onSuccess }: { onSuccess: (r: { credential?: string }) => void }) => (
    <button type="button" onClick={() => onSuccess({ credential: 'fake-credential' })}>
      Fazer Login com o Google
    </button>
  ),
}));

function renderLogin() {
  return render(
    <AuthProvider>
      <Login />
    </AuthProvider>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
    mockedApi.loginWithGoogle.mockReset();
    mockedApi.me.mockRejectedValue(new Error('401'));
  });

  it('shows a specific message when the account has not been invited', async () => {
    mockedApi.loginWithGoogle.mockRejectedValue(new ApiError(403, 'not_invited'));
    const user = userEvent.setup();

    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Fazer Login com o Google' }));

    expect(
      await screen.findByText('Seu acesso ainda não foi liberado. Peça a um administrador para te convidar.'),
    ).toBeInTheDocument();
  });

  it('shows the domain message when the account is outside the allowed domain', async () => {
    mockedApi.loginWithGoogle.mockRejectedValue(new ApiError(403, 'domain_not_allowed'));
    const user = userEvent.setup();

    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Fazer Login com o Google' }));

    expect(await screen.findByText('Use uma conta @ilhacrossmidia.com.br.')).toBeInTheDocument();
  });
});
