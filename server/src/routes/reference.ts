import { Router } from 'express';
import type { AppDatabase } from '../db';
import { listPhasesWithStatuses } from '../models/reference';
import { listPeople, createPerson, setPersonActive } from '../models/people';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';

export interface ReferenceRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
}

export function createReferenceRouter(deps: ReferenceRouterDeps): Router {
  const router = Router();

  router.use(requireAuth(deps.jwtSecret));

  router.get(
    '/reference',
    asyncHandler(async (_req, res) => {
      res.json({ phases: await listPhasesWithStatuses(deps.db) });
    }),
  );

  router.get(
    '/people',
    asyncHandler(async (_req, res) => {
      res.json({ people: await listPeople(deps.db) });
    }),
  );

  router.post(
    '/people',
    asyncHandler(async (req, res) => {
      const { name, area } = req.body as { name?: string; area?: string };

      if (!name || !name.trim() || !area || !area.trim()) {
        res.status(400).json({ error: 'name and area are required' });
        return;
      }

      const person = await createPerson(deps.db, { name: name.trim(), area: area.trim() });
      res.status(201).json({ person });
    }),
  );

  router.patch(
    '/people/:id/active',
    asyncHandler(async (req, res) => {
      const { active } = req.body as { active?: boolean };

      if (typeof active !== 'boolean') {
        res.status(400).json({ error: 'active must be a boolean' });
        return;
      }

      const person = await setPersonActive(deps.db, Number(req.params.id), active);
      res.json({ person });
    }),
  );

  return router;
}
