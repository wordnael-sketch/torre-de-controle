import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';

export function Login() {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);

  async function handleCredential(credential: string) {
    setError(null);
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.message === 'not_invited') {
        setError('Seu acesso ainda não foi liberado. Peça a um administrador para te convidar.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Use uma conta @ilhacrossmidia.com.br.');
      } else {
        setError('Não foi possível fazer login. Tente novamente.');
      }
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4rem' }}>
      <div>
        <h1>Ilha Crossmídia</h1>
        <p>Acompanhamento de Jobs — entre com sua conta @ilhacrossmidia.com.br</p>
        <GoogleLogin
          onSuccess={(credentialResponse) => {
            if (credentialResponse.credential) {
              void handleCredential(credentialResponse.credential);
            }
          }}
          onError={() => setError('Falha no login com Google.')}
        />
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
