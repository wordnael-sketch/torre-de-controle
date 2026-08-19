import jwt from 'jsonwebtoken';

export interface SessionPayload {
  userId: number;
  email: string;
}

export function signSession(payload: SessionPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '30d' });
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'object' && decoded !== null && 'userId' in decoded && 'email' in decoded) {
      return { userId: Number(decoded.userId), email: String(decoded.email) };
    }
    return null;
  } catch {
    return null;
  }
}
