import { OAuth2Client } from 'google-auth-library';
import type { GoogleProfile } from '../routes/auth';

export function createGoogleVerifier(clientId: string) {
  const client = new OAuth2Client(clientId);

  return async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email || !payload.name) {
      throw new Error('Invalid Google ID token payload');
    }

    return { sub: payload.sub, email: payload.email, name: payload.name };
  };
}
