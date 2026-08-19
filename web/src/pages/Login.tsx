import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../auth/AuthContext';

export function Login() {
  const { loginWithGoogle } = useAuth();

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4rem' }}>
      <div>
        <h1>Ilha Crossmídia</h1>
        <p>Acompanhamento de Jobs — entre com sua conta @ilhacrossmidia.com.br</p>
        <GoogleLogin
          onSuccess={(credentialResponse) => {
            if (credentialResponse.credential) {
              void loginWithGoogle(credentialResponse.credential);
            }
          }}
          onError={() => console.error('Falha no login com Google')}
        />
      </div>
    </div>
  );
}
