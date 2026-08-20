import { Router } from 'express';
import type { AppDatabase } from '../db';
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus, setLastWhatsappActivity } from '../models/job';
import { setBolaCom, getBolaComDayCounts } from '../models/bolaCom';
import { getJobStatusHistory } from '../models/jobStatusHistory';
import { getJobRoleAssignments, setJobRoleAssignment } from '../models/jobRoleAssignments';
import { classifyAndApply } from '../models/classification';
import { requireAuth, requireActiveUser } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';
import type { Classifier } from '../services/classifier';

export interface JobsRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
  classifier?: Classifier;
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export function createJobsRouter(deps: JobsRouterDeps): Router {
  const router = Router();

  router.use(requireAuth(deps.jwtSecret));
  router.use(requireActiveUser(deps.db));

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
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const job = await getJobById(deps.db, jobId);

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const [statusRow, roleAssignments, statusHistory, bolaComDayCounts] = await Promise.all([
        deps.db.query<{ action_required: string; trigger_label: string }>(
          'SELECT action_required, trigger_label FROM statuses WHERE id = $1',
          [job.statusId],
        ),
        job.phaseId ? getJobRoleAssignments(deps.db, jobId, job.phaseId) : Promise.resolve([]),
        getJobStatusHistory(deps.db, jobId),
        getBolaComDayCounts(deps.db, jobId),
      ]);

      res.json({
        job: {
          ...job,
          actionRequired: statusRow.rows[0]?.action_required ?? null,
          triggerLabel: statusRow.rows[0]?.trigger_label ?? null,
          roleAssignments,
          statusHistory,
          bolaComDayCounts,
        },
      });
    }),
  );

  router.post(
    '/:id/advance',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const { note } = req.body as { note?: string };

      try {
        const job = await advanceJobStatus(deps.db, jobId, note);
        res.json({ job });
      } catch {
        res.status(400).json({ error: 'Job cannot be advanced automatically (already at the last status of its phase)' });
      }
    }),
  );

  router.post(
    '/:id/status',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const { statusId, note } = req.body as { statusId?: number; note?: string };

      if (!statusId) {
        res.status(400).json({ error: 'statusId is required' });
        return;
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const statusExists = await deps.db.query('SELECT 1 FROM statuses WHERE id = $1', [statusId]);
      if (statusExists.rows.length === 0) {
        res.status(400).json({ error: 'statusId does not exist' });
        return;
      }

      const job = await setJobStatus(deps.db, jobId, statusId, note);
      res.json({ job });
    }),
  );

  router.put(
    '/:id/roles/:area',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const { personId } = req.body as { personId?: number | null };
      const job = await getJobById(deps.db, jobId);

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

      if (personId != null) {
        const personExists = await deps.db.query('SELECT 1 FROM people WHERE id = $1', [personId]);
        if (personExists.rows.length === 0) {
          res.status(400).json({ error: 'personId does not exist' });
          return;
        }
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

  router.patch(
    '/:id/bola-com',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const { bolaCom } = req.body as { bolaCom?: string };
      if (bolaCom !== 'ilha' && bolaCom !== 'cliente') {
        res.status(400).json({ error: 'bolaCom must be "ilha" or "cliente"' });
        return;
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      await setBolaCom(deps.db, jobId, bolaCom);
      const job = await getJobById(deps.db, jobId);
      const bolaComDayCounts = await getBolaComDayCounts(deps.db, jobId);
      res.json({ job, bolaComDayCounts });
    }),
  );

  router.patch(
    '/:id/last-activity',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      if (!('lastWhatsappActivityAt' in req.body)) {
        res.status(400).json({ error: 'lastWhatsappActivityAt is required (use null to clear)' });
        return;
      }

      const { lastWhatsappActivityAt } = req.body as { lastWhatsappActivityAt?: string | null };

      if (lastWhatsappActivityAt !== null && lastWhatsappActivityAt !== undefined) {
        const parsed = new Date(lastWhatsappActivityAt);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'lastWhatsappActivityAt must be a valid ISO date string or null' });
          return;
        }
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      await setLastWhatsappActivity(deps.db, jobId, lastWhatsappActivityAt ?? null);
      const job = await getJobById(deps.db, jobId);
      res.json({ job });
    }),
  );

  router.post(
    '/:id/classify',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const { text } = req.body as { text?: string };
      if (!text || !text.trim()) {
        res.status(400).json({ error: 'text is required' });
        return;
      }

      if (!deps.classifier) {
        res.status(503).json({ error: 'ia_nao_configurada' });
        return;
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const suggestions = await classifyAndApply(deps.db, deps.classifier, jobId, text);
      res.json({ suggestions });
    }),
  );

  return router;
}
