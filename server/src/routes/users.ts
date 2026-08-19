import { Router } from 'express';
import type { AppDatabase } from '../db';
import { listUsers, inviteUser, setUserRole, setUserStatus, findUserByEmail, type UserRole } from '../models/user';
import { isAllowedDomain } from '../auth/domain';
import { requireAuth, requireActiveUser, requireAdmin } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';

export interface UsersRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
  allowedDomain: string;
}

function isValidRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'member';
}

export function createUsersRouter(deps: UsersRouterDeps): Router {
  const router = Router();

  router.use(requireAuth(deps.jwtSecret));
  router.use(requireActiveUser(deps.db));
  router.use(requireAdmin());

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ users: await listUsers(deps.db) });
    }),
  );

  router.post(
    '/invite',
    asyncHandler(async (req, res) => {
      const { email, role } = req.body as { email?: string; role?: unknown };

      if (!email || !email.trim()) {
        res.status(400).json({ error: 'email is required' });
        return;
      }
      if (!isValidRole(role)) {
        res.status(400).json({ error: 'role must be admin or member' });
        return;
      }
      const trimmedEmail = email.trim();

      if (!isAllowedDomain(trimmedEmail, deps.allowedDomain)) {
        res.status(400).json({ error: 'email must be in the allowed domain' });
        return;
      }

      const existing = await findUserByEmail(deps.db, trimmedEmail);
      if (existing) {
        res.status(409).json({ error: 'user already exists' });
        return;
      }

      try {
        const user = await inviteUser(deps.db, { email: trimmedEmail, role });
        res.status(201).json({ user });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          res.status(409).json({ error: 'user already exists' });
          return;
        }
        throw err;
      }
    }),
  );

  router.patch(
    '/:id/role',
    asyncHandler(async (req, res) => {
      const { role } = req.body as { role?: unknown };
      if (!isValidRole(role)) {
        res.status(400).json({ error: 'role must be admin or member' });
        return;
      }

      const userId = Number(req.params.id);
      if (!Number.isInteger(userId)) {
        res.status(400).json({ error: 'invalid user id' });
        return;
      }

      if (userId === req.currentUser!.id) {
        res.status(400).json({ error: 'cannot_change_own_access' });
        return;
      }

      const user = await setUserRole(deps.db, userId, role);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ user });
    }),
  );

  router.patch(
    '/:id/status',
    asyncHandler(async (req, res) => {
      const { status } = req.body as { status?: unknown };
      if (status !== 'active' && status !== 'revoked') {
        res.status(400).json({ error: 'status must be active or revoked' });
        return;
      }

      const userId = Number(req.params.id);
      if (!Number.isInteger(userId)) {
        res.status(400).json({ error: 'invalid user id' });
        return;
      }

      if (userId === req.currentUser!.id) {
        res.status(400).json({ error: 'cannot_change_own_access' });
        return;
      }

      const user = await setUserStatus(deps.db, userId, status);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ user });
    }),
  );

  return router;
}
