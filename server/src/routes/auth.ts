import { Router } from 'express';
import type { AppDatabase } from '../db';
import { findUserByEmail, activateUser } from '../models/user';
import { isAllowedDomain } from '../auth/domain';
import { signSession } from '../auth/session';
import { requireAuth, requireActiveUser, SESSION_COOKIE } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';

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

function sessionCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true as const,
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    secure: isProduction,
  };
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();

  router.post(
    '/google',
    asyncHandler(async (req, res) => {
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
        res.status(403).json({ error: 'domain_not_allowed' });
        return;
      }

      const existing = await findUserByEmail(deps.db, profile.email);

      if (!existing || existing.status === 'revoked') {
        res.status(403).json({ error: 'not_invited' });
        return;
      }

      const user = await activateUser(deps.db, existing.id, {
        googleSub: profile.sub,
        name: profile.name,
      });

      const token = signSession({ userId: user.id, email: user.email }, deps.jwtSecret);

      res.cookie(SESSION_COOKIE, token, {
        ...sessionCookieOptions(),
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      res.json({ user });
    }),
  );

  router.get(
    '/me',
    requireAuth(deps.jwtSecret),
    requireActiveUser(deps.db),
    asyncHandler(async (req, res) => {
      res.json({ user: req.currentUser });
    }),
  );

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.status(204).send();
  });

  return router;
}
