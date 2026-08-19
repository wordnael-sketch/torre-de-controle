import { Router } from 'express';
import type { AppDatabase } from '../db';
import { findOrCreateUser, getUserById } from '../models/user';
import { isAllowedDomain } from '../auth/domain';
import { signSession } from '../auth/session';
import { requireAuth, SESSION_COOKIE } from '../auth/middleware';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

export type VerifyIdToken = (idToken: string) => Promise<GoogleProfile>;

export interface AuthRouterDeps {
  db: AppDatabase;
  verifyIdToken: VerifyIdToken;
  jwtSecret: string;
  allowedDomain: string;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();

  router.post('/google', async (req, res) => {
    const { idToken } = req.body as { idToken?: string };

    if (!idToken) {
      res.status(400).json({ error: 'idToken is required' });
      return;
    }

    let profile: GoogleProfile;
    try {
      profile = await deps.verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: 'Invalid Google ID token' });
      return;
    }

    if (!isAllowedDomain(profile.email, deps.allowedDomain)) {
      res.status(403).json({ error: 'Email domain not allowed' });
      return;
    }

    const user = await findOrCreateUser(deps.db, {
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name,
    });

    const token = signSession({ userId: user.id, email: user.email }, deps.jwtSecret);
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ user });
  });

  router.get('/me', requireAuth(deps.jwtSecret), async (req, res) => {
    const user = await getUserById(deps.db, req.user!.userId);

    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    res.json({ user });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.status(204).send();
  });

  return router;
}
