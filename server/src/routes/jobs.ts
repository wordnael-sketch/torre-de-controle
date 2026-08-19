import { Router } from 'express';
import type { AppDatabase } from '../db';
import { createJob, listJobs } from '../models/job';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';

export interface JobsRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
}

export function createJobsRouter(deps: JobsRouterDeps): Router {
  const router = Router();

  router.use(requireAuth(deps.jwtSecret));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ jobs: await listJobs(deps.db) });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { name, code, client } = req.body as { name?: string; code?: string; client?: string };

      if (!name || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const job = await createJob(deps.db, { name: name.trim(), code, client });
      res.status(201).json({ job });
    }),
  );

  return router;
}
