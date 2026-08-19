import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '../src/auth/session';

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = signSession({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' }, 'test-secret');
    const payload = verifySession(token, 'test-secret');

    expect(payload).toEqual({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' });
  });

  it('returns null for a token signed with a different secret', () => {
    const token = signSession({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' }, 'test-secret');
    const payload = verifySession(token, 'wrong-secret');

    expect(payload).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(verifySession('not-a-token', 'test-secret')).toBeNull();
  });
});
