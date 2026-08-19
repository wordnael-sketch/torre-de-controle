import { Router } from 'express';
import type { AppDatabase } from '../db';
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus } from '../models/job';
import { getJobStatusHistory } from '../models/jobStatusHistory';
import { getJobRoleAssignments, setJobRoleAssignment } from '../models/jobRoleAssignments';
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

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const jobId = Number(req.params.id);
      const job = await getJobById(deps.db, jobId);

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const [statusRow, roleAssignments, statusHistory] = await Promise.all([
        deps.db.query<{ action_required: string; trigger_label: string }>(
          'SELECT action_required, trigger_label FROM statuses WHERE id = $1',
          [job.statusId],
        ),
        job.phaseId ? getJobRoleAssignments(deps.db, jobId, job.phaseId) : Promise.resolve([]),
        getJobStatusHistory(deps.db, jobId),
      ]);

      res.json({
        job: {
          ...job,
          actionRequired: statusRow.rows[0]?.action_required ?? null,
          triggerLabel: statusRow.rows[0]?.trigger_label ?? null,
          roleAssignments,
          statusHistory,
        },
      });
    }),
  );

  router.post(
    '/:id/advance',
    asyncHandler(async (req, res) => {
      const { note } = req.body as { note?: string };
      const job = await advanceJobStatus(deps.db, Number(req.params.id), note);
      res.json({ job });
    }),
  );

  router.post(
    '/:id/status',
    asyncHandler(async (req, res) => {
      const { statusId, note } = req.body as { statusId?: number; note?: string };

      if (!statusId) {
        res.status(400).json({ error: 'statusId is required' });
        return;
      }

      const job = await setJobStatus(deps.db, Number(req.params.id), statusId, note);
      res.json({ job });
    }),
  );

  router.put(
    '/:id/roles/:area',
    asyncHandler(async (req, res) => {
      const { personId } = req.body as { personId?: number | null };
      const job = await getJobById(deps.db, Number(req.params.id));

      if (!job || !job.phaseId) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const roleExists = await deps.db.query(
        'SELECT 1 FROM phase_roles WHERE phase_id = $1 AND area = $2',
        [job.phaseId, req.params.area],
      );

      if (roleExists.rows.length === 0) {
        res.status(400).json({ error: 'area is not a valid role for this job\'s current phase' });
        return;
      }

      const roleAssignment = await setJobRoleAssignment(
        deps.db,
        job.id,
        job.phaseId,
        req.params.area,
        personId ?? null,
      );
      res.json({ roleAssignment });
    }),
  );

  return router;
}
