# Atendimento Responsável Obrigatório Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Atendimento responsável" a single, job-level field that is required when a job is created, always shown prominently in the job detail panel, and reassignable at any time by any logged-in user.

**Architecture:** Add `jobs.atendimento_person_id` (nullable at the DB level, enforced as required by the `POST /api/jobs` route — the model layer stays permissive, matching this codebase's existing "routes validate, models persist" pattern). Remove `Atendimento` from the per-phase `phase_roles` mechanism entirely, since it is no longer phase-scoped. Add a small `people.title` free-text field, populated only for the Atendimento area today (Head vs. Executiva de Contas). Fix the existing "highlighted person" derivation on the Board so it keeps working for statuses whose `primary_role` is `Atendimento`.

**Tech Stack:** Node/Express + PostgreSQL (`server/`), React + TypeScript + Vite (`web/`), Vitest + Supertest for backend tests, Vitest + Testing Library for frontend tests.

**Spec:** docs/superpowers/specs/2026-08-20-atendimento-responsavel-design.md

## Global Constraints

- Atendimento is a **job-level** field (`jobs.atendimento_person_id`), never phase-scoped — it is removed from `phase_roles` entirely.
- `POST /api/jobs` **requires** a valid `atendimentoPersonId` (an active person whose `area = 'Atendimento'`) and returns `400` otherwise. The model function `createJob` itself does **not** enforce this — it accepts an optional, nullable `atendimentoPersonId` and just persists whatever it's given, exactly like every other optional field on that function today (`code`, `client`).
- `PATCH /api/jobs/:id/atendimento` lets **any authenticated user** (no extra role/permission check beyond being an active logged-in user, same as every other job-mutating route in this codebase) reassign the responsible person **at any time**. This endpoint always requires a valid `personId` — it never accepts `null`/clears the field.
- The 27 pre-existing jobs are **not** retroactively touched — `atendimento_person_id` stays `NULL` for them in the database until someone assigns it through the UI.
- `people.title` is a free-text, optional column. Today it is populated only for the Atendimento area (`'Head'` for Wilka, `'Executiva de Contas'` for the other seven); no other area uses it, and this plan introduces no new hierarchy/permission logic tied to it.

---

## Task 1: Schema migration

**Files:**
- Modify: `server/src/db/schema.sql`
- Test: `server/test/schema.pipeline.test.ts`

**Interfaces:**
- Produces: two new columns — `jobs.atendimento_person_id INTEGER REFERENCES people(id)` (nullable) and `people.title TEXT` (nullable) — that Task 2's model layer reads and writes. Produces 7 new `people` rows in the `Atendimento` area (`title = 'Executiva de Contas'`) plus `Wilka`'s `title` set to `'Head'`. Removes `Atendimento` from `phase_roles` entirely (the two rows for `'Dotação e Burocracia'` and `'Pós-Produção'`).
- Consumes: nothing from other tasks — this is the foundation every later task builds on.

- [ ] **Step 1: Add the migration SQL to the end of `server/src/db/schema.sql`**

Append this block after the existing `last_whatsapp_activity_at` line (currently the last line of the file):

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS atendimento_person_id INTEGER REFERENCES people(id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS title TEXT;

-- Atendimento stops being a per-phase role assignment and becomes a
-- single job-level field. Any existing job_role_assignments row for the
-- Atendimento area is migrated onto the new column before the old rows
-- (and the phase_roles entries that made them possible) are removed.
UPDATE jobs j
SET atendimento_person_id = jra.person_id
FROM job_role_assignments jra
WHERE jra.job_id = j.id
  AND jra.area = 'Atendimento'
  AND j.atendimento_person_id IS NULL
  AND jra.person_id IS NOT NULL;

DELETE FROM job_role_assignments WHERE area = 'Atendimento';
DELETE FROM phase_roles WHERE area = 'Atendimento';

INSERT INTO people (name, area, title) VALUES
  ('Camila', 'Atendimento', 'Executiva de Contas'),
  ('Andrea', 'Atendimento', 'Executiva de Contas'),
  ('Larissa (Brasília)', 'Atendimento', 'Executiva de Contas'),
  ('Karina', 'Atendimento', 'Executiva de Contas'),
  ('Isabela', 'Atendimento', 'Executiva de Contas'),
  ('Bianca (Brasília)', 'Atendimento', 'Executiva de Contas'),
  ('Renata (RJ)', 'Atendimento', 'Executiva de Contas')
ON CONFLICT (name, area) DO NOTHING;

UPDATE people SET title = 'Head' WHERE name = 'Wilka' AND area = 'Atendimento';
```

Every statement here is safe to run on every server startup (matches the file's existing style): `ADD COLUMN IF NOT EXISTS`, the `UPDATE ... FROM` and both `DELETE`s become no-ops once there's nothing left to migrate/remove, `INSERT ... ON CONFLICT DO NOTHING`, and the final `UPDATE` is idempotent (setting the same value twice is harmless).

Note: `('Camila', 'Atendimento')` does not collide with the pre-existing `('Camila', 'Produção')` row — the unique constraint on `people` is `(name, area)`, not `name` alone.

- [ ] **Step 2: Fix the existing orphan-role test that Atendimento's removal from `phase_roles` breaks**

`server/test/schema.pipeline.test.ts` has a test (currently lines 29-45) that asserts every status's `primary_role` has a matching `phase_roles` row for that status's phase. Several statuses (e.g. `'Atendimento da conta definida'`, `'Aprovação do Cliente'`) have `primary_role = 'Atendimento'` — after Step 1, `phase_roles` no longer has any `'Atendimento'` rows anywhere, so this test would start failing. Update it to treat `'Atendimento'` as an intentional exception, since it's now a job-level field, not a `phase_roles` entry:

Find:
```ts
  it('seeds exactly 40 statuses across the 6 phases, each with a valid primary_role', async () => {
    const db = await createDb(connectionString);
    try {
      const countResult = await db.query<{ count: string }>('SELECT count(*) FROM statuses');
      expect(Number(countResult.rows[0].count)).toBe(40);

      const orphanRoles = await db.query(
        `SELECT s.id FROM statuses s
         WHERE NOT EXISTS (
           SELECT 1 FROM phase_roles pr WHERE pr.phase_id = s.phase_id AND pr.area = s.primary_role
         )`,
      );
      expect(orphanRoles.rows).toEqual([]);
    } finally {
      await db.end();
    }
  });
```

Replace with:
```ts
  it('seeds exactly 40 statuses across the 6 phases, each with a valid primary_role', async () => {
    const db = await createDb(connectionString);
    try {
      const countResult = await db.query<{ count: string }>('SELECT count(*) FROM statuses');
      expect(Number(countResult.rows[0].count)).toBe(40);

      // 'Atendimento' is intentionally excluded: it's a job-level field
      // (jobs.atendimento_person_id), not a phase_roles entry, even though
      // several statuses still have primary_role = 'Atendimento'.
      const orphanRoles = await db.query(
        `SELECT s.id FROM statuses s
         WHERE s.primary_role <> 'Atendimento'
           AND NOT EXISTS (
             SELECT 1 FROM phase_roles pr WHERE pr.phase_id = s.phase_id AND pr.area = s.primary_role
           )`,
      );
      expect(orphanRoles.rows).toEqual([]);
    } finally {
      await db.end();
    }
  });
```

- [ ] **Step 3: Add new schema-level tests**

Append these three tests inside the existing `describe('pipeline schema', ...)` block in `server/test/schema.pipeline.test.ts`, after the last test (`'adds status_id and completed_at columns to jobs'`):

```ts
  it('never lists Atendimento as a phase_roles entry — it is assigned at the job level now', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query('SELECT 1 FROM phase_roles WHERE area = $1', ['Atendimento']);
      expect(result.rows).toEqual([]);
    } finally {
      await db.end();
    }
  });

  it('adds atendimento_person_id to jobs and title to people', async () => {
    const db = await createDb(connectionString);
    try {
      const jobsCol = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'atendimento_person_id'`,
      );
      expect(jobsCol.rows).toHaveLength(1);

      const peopleCol = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'title'`,
      );
      expect(peopleCol.rows).toHaveLength(1);
    } finally {
      await db.end();
    }
  });

  it('seeds 8 people in the Atendimento area: Wilka as Head, the rest as Executiva de Contas', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ name: string; title: string | null }>(
        `SELECT name, title FROM people WHERE area = 'Atendimento'`,
      );
      const byName = new Map(result.rows.map((r) => [r.name, r.title]));

      expect(byName.size).toBe(8);
      expect(byName.get('Wilka')).toBe('Head');
      for (const name of [
        'Camila',
        'Andrea',
        'Larissa (Brasília)',
        'Karina',
        'Isabela',
        'Bianca (Brasília)',
        'Renata (RJ)',
      ]) {
        expect(byName.get(name)).toBe('Executiva de Contas');
      }
    } finally {
      await db.end();
    }
  });
```

(These use a `Map` keyed by name rather than an ordered array comparison deliberately — `ORDER BY name` in SQL would sort accented characters like the `í` in `Larissa (Brasília)` according to the database's collation, which isn't guaranteed to match JavaScript's default string ordering. Comparing via a `Map` sidesteps that risk entirely.)

- [ ] **Step 4: Run the schema tests**

Run: `cd server && npm test -- schema.pipeline`
Expected: all tests in `schema.pipeline.test.ts` PASS (7 tests: the 5 original ones, one of them modified, plus 3 new ones — net 8 total, since the modified one keeps its name).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.sql server/test/schema.pipeline.test.ts
git commit -m "feat(server): add atendimento_person_id and people.title columns, retire Atendimento from phase_roles"
```

---

## Task 2: Backend model layer (`job.ts`, `people.ts`)

**Files:**
- Modify: `server/src/models/job.ts`
- Modify: `server/src/models/people.ts`
- Test: `server/test/models.job.test.ts`
- Test: `server/test/models.people.test.ts`

**Interfaces:**
- Consumes: `jobs.atendimento_person_id` and `people.title` columns from Task 1.
- Produces: `Job.atendimentoPersonId: number | null`, `Job.atendimentoPersonName: string | null` (populated on every `Job` returned by `listJobs`/`getJobById`/`createJob`). `createJob(db, input: { name: string; code?: string; client?: string; atendimentoPersonId?: number | null })`. New function `setAtendimento(db: AppDatabase, jobId: number, personId: number): Promise<Job>`. `Person.title: string | null` on every `Person` returned by `listPeople`/`createPerson`/`setPersonActive`. Task 3's routes call `createJob` and `setAtendimento` with these exact signatures; Task 4's frontend mirrors these field names in `client.ts`.
- Note: since `listJobs` and `getJobById` already share the same `JOB_SELECT`/`rowToJob`, the two new fields end up on **every** `Job` response, including `GET /api/jobs` (the list), not just `GET /api/jobs/:id` — simpler than special-casing the two query paths, and harmless since Task 4's Board table doesn't render them. Task 4's `makeJob()` test fixture (list-shaped) needs the two fields for this reason, not just the `JobDetail`-shaped fixtures.

- [ ] **Step 1: Update `Job`/`JobRow`, `JOB_SELECT`, and `rowToJob` in `server/src/models/job.ts`**

Find the `Job` interface and add two fields at the end:

```ts
export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
  statusId: number | null;
  statusName: string | null;
  phaseId: number | null;
  phaseName: string | null;
  completedAt: string | null;
  alertLevel: AlertLevel;
  highlightedPersonName: string | null;
  bolaCom: 'ilha' | 'cliente';
  lastWhatsappActivityAt: string | null;
  actionRequired: string | null;
  triggerLabel: string | null;
  atendimentoPersonId: number | null;
  atendimentoPersonName: string | null;
}
```

Find the `JobRow` interface and add two fields at the end:

```ts
interface JobRow {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  status_id: number | null;
  status_name: string | null;
  phase_id: number | null;
  phase_name: string | null;
  completed_at: string | Date | null;
  highlighted_person_name: string | null;
  bola_com: 'ilha' | 'cliente';
  last_whatsapp_activity_at: string | Date | null;
  status_action_required: string | null;
  status_trigger_label: string | null;
  atendimento_person_id: number | null;
  atendimento_person_name: string | null;
}
```

Replace the whole `JOB_SELECT` constant:

```ts
const JOB_SELECT = `
  SELECT
    j.*,
    s.id AS status_id,
    s.name AS status_name,
    s.action_required AS status_action_required,
    s.trigger_label AS status_trigger_label,
    p.id AS phase_id,
    p.name AS phase_name,
    atendimento.name AS atendimento_person_name,
    (
      CASE
        WHEN s.primary_role = 'Atendimento' THEN atendimento.name
        ELSE (
          SELECT person.name
          FROM job_role_assignments jra
          JOIN people person ON person.id = jra.person_id
          WHERE jra.job_id = j.id AND jra.phase_id = s.phase_id AND jra.area = s.primary_role
          LIMIT 1
        )
      END
    ) AS highlighted_person_name
  FROM jobs j
  LEFT JOIN statuses s ON s.id = j.status_id
  LEFT JOIN phases p ON p.id = s.phase_id
  LEFT JOIN people atendimento ON atendimento.id = j.atendimento_person_id
`;
```

(`j.*` already brings back `atendimento_person_id` as a plain column since it lives on `jobs` — only the joined person's *name* needs an explicit `SELECT`. The `highlighted_person_name` subquery is the fix for the "pessoa em destaque" gap called out in the spec: for any status whose `primary_role` is `'Atendimento'`, it now resolves from the new job-level field instead of the now-empty `job_role_assignments` rows for that area; every other `primary_role` is unaffected.)

Find `rowToJob` and add the two new fields to the returned object (after `triggerLabel`):

```ts
    actionRequired: row.status_action_required,
    triggerLabel: row.status_trigger_label,
    atendimentoPersonId: row.atendimento_person_id,
    atendimentoPersonName: row.atendimento_person_name,
  };
}
```

- [ ] **Step 2: Update `createJob`'s signature and insert statement**

Find:

```ts
export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Promise<Job> {
  const firstStatusId = await getFirstStatusId(db);

  const inserted = await db.query<{ id: number }>(
    `WITH new_job AS (
       INSERT INTO jobs (name, code, client, status_id) VALUES ($1, $2, $3, $4) RETURNING id
     ), history AS (
       INSERT INTO job_status_history (job_id, from_status_id, to_status_id)
       SELECT id, NULL, $4 FROM new_job
     )
     SELECT id FROM new_job`,
    [input.name, input.code ?? null, input.client ?? null, firstStatusId],
  );
```

Replace with:

```ts
export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string; atendimentoPersonId?: number | null },
): Promise<Job> {
  const firstStatusId = await getFirstStatusId(db);

  const inserted = await db.query<{ id: number }>(
    `WITH new_job AS (
       INSERT INTO jobs (name, code, client, status_id, atendimento_person_id) VALUES ($1, $2, $3, $4, $5) RETURNING id
     ), history AS (
       INSERT INTO job_status_history (job_id, from_status_id, to_status_id)
       SELECT id, NULL, $4 FROM new_job
     )
     SELECT id FROM new_job`,
    [input.name, input.code ?? null, input.client ?? null, firstStatusId, input.atendimentoPersonId ?? null],
  );
```

The rest of `createJob`'s body (the `jobId`/`recordInitialBolaCom`/`getJobById` lines) is unchanged.

Note: `atendimentoPersonId` is **optional and nullable** here on purpose — the model layer just persists whatever it's given, same as `code`/`client`. Requiring a real value is `POST /api/jobs`'s job (Task 3), not this function's — this mirrors how `name` is the only thing this function's TypeScript signature makes non-optional, even though the model doesn't re-validate it either.

- [ ] **Step 3: Add `setAtendimento`**

Add this new exported function at the end of `server/src/models/job.ts`, after `setLastWhatsappActivity`:

```ts
export async function setAtendimento(db: AppDatabase, jobId: number, personId: number): Promise<Job> {
  await db.query('UPDATE jobs SET atendimento_person_id = $1, updated_at = now() WHERE id = $2', [
    personId,
    jobId,
  ]);
  const job = await getJobById(db, jobId);
  return job!;
}
```

- [ ] **Step 4: Update `server/src/models/people.ts` to expose `title`**

Replace the whole file's interfaces and `toPerson` function:

```ts
import type { AppDatabase } from '../db';

export interface Person {
  id: number;
  name: string;
  area: string;
  active: boolean;
  title: string | null;
}

interface PersonRow {
  id: number;
  name: string;
  area: string;
  active: boolean;
  title: string | null;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    active: row.active,
    title: row.title,
  };
}
```

`listPeople`, `createPerson`, and `setPersonActive` are unchanged — they already use `SELECT *`/`RETURNING *`, so the new `title` column flows through automatically once the interfaces above know about it.

- [ ] **Step 5: Write the failing tests in `server/test/models.job.test.ts`**

Add `setAtendimento` to the import at the top of the file:

```ts
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus, setAtendimento } from '../src/models/job';
```

Find the existing `'creates a job without optional fields'` test and add two assertions:

```ts
  it('creates a job without optional fields', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job sem codigo' });

      expect(job.code).toBeNull();
      expect(job.client).toBeNull();
      expect(job.atendimentoPersonId).toBeNull();
      expect(job.atendimentoPersonName).toBeNull();
    });
  });
```

Add a new `describe` block at the end of the file, after the closing `});` of `describe('job status lifecycle', ...)`:

```ts
describe('atendimento responsável', () => {
  it('creates a job with an atendimentoPersonId and returns it', async () => {
    await withTestTransaction(async (db) => {
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );

      const job = await createJob(db, {
        name: 'Job Atendimento Definido Teste',
        atendimentoPersonId: wilka.rows[0].id,
      });

      expect(job.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(job.atendimentoPersonName).toBe('Wilka');
    });
  });

  it('setAtendimento updates the responsible person and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Reatribuição Teste' });
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );

      const updated = await setAtendimento(db, created.id, wilka.rows[0].id);

      expect(updated.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(updated.atendimentoPersonName).toBe('Wilka');
    });
  });

  it('highlightedPersonName resolves from atendimentoPersonId when the current status is primarily Atendimento', async () => {
    await withTestTransaction(async (db) => {
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );
      const created = await createJob(db, {
        name: 'Job Destaque Atendimento Teste',
        atendimentoPersonId: wilka.rows[0].id,
      });

      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Atendimento da conta definida'`,
      );
      const updated = await setJobStatus(db, created.id, targetStatus.rows[0].id);

      expect(updated.statusName).toBe('Atendimento da conta definida');
      expect(updated.highlightedPersonName).toBe('Wilka');
    });
  });
});
```

That third test is the direct regression proof for the `highlighted_person_name` fix in Step 1 — it fails against the pre-fix `JOB_SELECT` (which would return `null` here, since `job_role_assignments` no longer has any `'Atendimento'` rows to join against) and passes once the `CASE` expression is in place.

- [ ] **Step 6: Write the failing test in `server/test/models.people.test.ts`**

Add this test inside the existing `describe('people model', ...)` block, after the last test:

```ts
  it('exposes title on each person, populated for Atendimento and null elsewhere', async () => {
    await withTestTransaction(async (db) => {
      const people = await listPeople(db);
      const wilka = people.find((p) => p.name === 'Wilka' && p.area === 'Atendimento');
      const anne = people.find((p) => p.name === 'Anne' && p.area === 'Comercial');

      expect(wilka?.title).toBe('Head');
      expect(anne?.title).toBeNull();
    });
  });
```

- [ ] **Step 7: Run the tests to verify they fail, then pass**

Run: `cd server && npm test -- models.job models.people`
Expected (before Steps 1-4 of this task are applied): compile errors (`setAtendimento` doesn't exist, `atendimentoPersonId` isn't a known field) or failing assertions.
Apply Steps 1-4 above if you haven't yet, then re-run.
Expected (after): all tests in both files PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/models/job.ts server/src/models/people.ts server/test/models.job.test.ts server/test/models.people.test.ts
git commit -m "feat(server): add atendimentoPersonId to the job model and title to the person model"
```

---

## Task 3: Backend routes (`jobs.ts`)

**Files:**
- Modify: `server/src/routes/jobs.ts`
- Modify: `server/test/routes.jobs.test.ts`

**Interfaces:**
- Consumes: `createJob(db, { name, code?, client?, atendimentoPersonId? })` and `setAtendimento(db, jobId, personId)` from Task 2.
- Produces: `POST /api/jobs` now requires `atendimentoPersonId` in the body (`400` if missing or invalid). New route `PATCH /api/jobs/:id/atendimento` accepting `{ personId: number }`. Every `Job`-shaped JSON response (list and detail) now includes `atendimentoPersonId`/`atendimentoPersonName` automatically, since they come from the same `Job` model type Task 2 already extended — no route code changes are needed for `GET /api/jobs`/`GET /api/jobs/:id` beyond what's already there. Task 4's frontend calls these two routes with these exact shapes.
- Note: `server/src/routes/reference.ts` (which serves `GET /api/people`) is **not** in this task's file list and needs no changes — it already does `res.json({ people: await listPeople(deps.db) })`, so Task 2's `title` field flows through automatically.

- [ ] **Step 1: Import `setAtendimento` in `server/src/routes/jobs.ts`**

Find:

```ts
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus, setLastWhatsappActivity } from '../models/job';
```

Replace with:

```ts
import {
  createJob,
  listJobs,
  getJobById,
  advanceJobStatus,
  setJobStatus,
  setLastWhatsappActivity,
  setAtendimento,
} from '../models/job';
```

- [ ] **Step 2: Add `atendimentoPersonId` validation to `POST /api/jobs`**

Find:

```ts
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
```

Replace with:

```ts
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { name, code, client, atendimentoPersonId } = req.body as {
        name?: string;
        code?: string;
        client?: string;
        atendimentoPersonId?: number;
      };

      if (!name || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      if (!Number.isInteger(atendimentoPersonId)) {
        res.status(400).json({ error: 'atendimentoPersonId is required' });
        return;
      }

      const atendimentoPerson = await deps.db.query<{ area: string; active: boolean }>(
        'SELECT area, active FROM people WHERE id = $1',
        [atendimentoPersonId],
      );
      if (
        atendimentoPerson.rows.length === 0 ||
        atendimentoPerson.rows[0].area !== 'Atendimento' ||
        !atendimentoPerson.rows[0].active
      ) {
        res.status(400).json({
          error: 'atendimentoPersonId must reference an active person in the Atendimento area',
        });
        return;
      }

      const job = await createJob(deps.db, { name: name.trim(), code, client, atendimentoPersonId });
      res.status(201).json({ job });
    }),
  );
```

- [ ] **Step 3: Add the `PATCH /:id/atendimento` route**

Add this new route in `server/src/routes/jobs.ts`, right after the `PUT /:id/roles/:area` route (before the `PATCH /:id/bola-com` route):

```ts
  router.patch(
    '/:id/atendimento',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const { personId } = req.body as { personId?: number };

      if (!Number.isInteger(personId)) {
        res.status(400).json({ error: 'personId is required' });
        return;
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const person = await deps.db.query<{ area: string; active: boolean }>(
        'SELECT area, active FROM people WHERE id = $1',
        [personId],
      );
      if (person.rows.length === 0 || person.rows[0].area !== 'Atendimento' || !person.rows[0].active) {
        res.status(400).json({
          error: 'personId must reference an active person in the Atendimento area',
        });
        return;
      }

      const job = await setAtendimento(deps.db, jobId, personId!);
      res.json({ job });
    }),
  );
```

- [ ] **Step 4: Update every existing job-creation call in `server/test/routes.jobs.test.ts`**

Every `agent.post('/api/jobs')` call in this file needs an `atendimentoPersonId` in its `.send({...})` payload now, or it will start getting `400` instead of `201`/`200` once Step 2 lands — **except** the one test that intentionally omits `name` to test the name-validation path (`'rejects a job without a name'`), which must stay exactly as-is.

First, add this helper function near the top of the file, right after the `loggedInAgent` function:

```ts
async function getAtendimentoPersonId(db: AppDatabase): Promise<number> {
  const result = await db.query<{ id: number }>(
    `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
  );
  return result.rows[0].id;
}
```

Then, in **every** test below that calls `agent.post('/api/jobs')` to create a job, add this line immediately after `const agent = await loggedInAgent(app);`:

```ts
      const atendimentoPersonId = await getAtendimentoPersonId(db);
```

...and add `atendimentoPersonId` into the `.send({...})` object of that test's `.post('/api/jobs')` call. Apply this transformation to the following 22 call sites (identified by their test name and the exact line to change — every other line in the file is untouched):

| Test (`describe` > `it`) | Old `.send({...})` | New `.send({...})` |
|---|---|---|
| `GET /api/jobs` > `includes a freshly created job in the list` | `.send({ name: 'Job criado no teste GET /api/jobs' })` | `.send({ name: 'Job criado no teste GET /api/jobs', atendimentoPersonId })` |
| `GET /api/jobs` > `includes bolaComDayCounts and triggerLabel...` | `.send({ name: 'Job Listagem Enriquecida Rota Teste' })` | `.send({ name: 'Job Listagem Enriquecida Rota Teste', atendimentoPersonId })` |
| `POST /api/jobs` > `creates a job and returns it` | `.send({ name: 'Colgate - Color Correct Wave 2', code: '0307-2026', client: 'Colgate' })` | `.send({ name: 'Colgate - Color Correct Wave 2', code: '0307-2026', client: 'Colgate', atendimentoPersonId })` |
| `GET /api/jobs/:id` > `returns the job detail with...` | `.send({ name: 'Job Detalhe Rota Teste' })` | `.send({ name: 'Job Detalhe Rota Teste', atendimentoPersonId })` |
| `POST /api/jobs/:id/advance` > `advances the job...` | `.send({ name: 'Job Avanço Rota Teste' })` | `.send({ name: 'Job Avanço Rota Teste', atendimentoPersonId })` |
| `POST /api/jobs/:id/status` > `moves the job to a manually chosen status` | `.send({ name: 'Job Status Manual Rota Teste' })` | `.send({ name: 'Job Status Manual Rota Teste', atendimentoPersonId })` |
| `POST /api/jobs/:id/status` > `rejects a missing statusId` | `.send({ name: 'Job Status Manual Inválido Teste' })` | `.send({ name: 'Job Status Manual Inválido Teste', atendimentoPersonId })` |
| `PUT /api/jobs/:id/roles/:area` > `assigns a person to a role area for the job` | `.send({ name: 'Job Atribuição Rota Teste' })` | `.send({ name: 'Job Atribuição Rota Teste', atendimentoPersonId })` |
| `PUT /api/jobs/:id/roles/:area` > `rejects an area that is not a valid role...` | `.send({ name: 'Job Área Inválida Rota Teste' })` | `.send({ name: 'Job Área Inválida Rota Teste', atendimentoPersonId })` |
| `PUT /api/jobs/:id/roles/:area` > `accepts an area containing a slash...` | `.send({ name: 'Job Área Com Barra Teste' })` | `.send({ name: 'Job Área Com Barra Teste', atendimentoPersonId })` |
| `error handling on jobs routes` > `POST /api/jobs/:id/advance returns 400 when already...` | `.send({ name: 'Job Limite de Fase Teste' })` | `.send({ name: 'Job Limite de Fase Teste', atendimentoPersonId })` |
| `error handling on jobs routes` > `POST /api/jobs/:id/status returns 400 for a nonexistent statusId` | `.send({ name: 'Job Status Inexistente Teste' })` | `.send({ name: 'Job Status Inexistente Teste', atendimentoPersonId })` |
| `error handling on jobs routes` > `PUT /api/jobs/:id/roles/:area returns 400 for a nonexistent personId` | `.send({ name: 'Job Pessoa Inexistente Teste' })` | `.send({ name: 'Job Pessoa Inexistente Teste', atendimentoPersonId })` |
| `PATCH /api/jobs/:id/bola-com` > `switches bola-com and returns updated day counts` | `.send({ name: 'Job Bola Com Rota Teste' })` | `.send({ name: 'Job Bola Com Rota Teste', atendimentoPersonId })` |
| `PATCH /api/jobs/:id/bola-com` > `rejects an invalid bolaCom value` | `.send({ name: 'Job Bola Com Inválida Teste' })` | `.send({ name: 'Job Bola Com Inválida Teste', atendimentoPersonId })` |
| `PATCH /api/jobs/:id/last-activity` > `sets the last WhatsApp activity timestamp` | `.send({ name: 'Job Última Atividade Rota Teste' })` | `.send({ name: 'Job Última Atividade Rota Teste', atendimentoPersonId })` |
| `PATCH /api/jobs/:id/last-activity` > `clears the timestamp when null is sent` | `.send({ name: 'Job Limpar Última Atividade Teste' })` | `.send({ name: 'Job Limpar Última Atividade Teste', atendimentoPersonId })` |
| `PATCH /api/jobs/:id/last-activity` > `rejects an invalid date string` | `.send({ name: 'Job Data Inválida Teste' })` | `.send({ name: 'Job Data Inválida Teste', atendimentoPersonId })` |
| `PATCH /api/jobs/:id/last-activity` > `rejects an omitted field` | `.send({ name: 'Job Campo Omitido Teste' })` | `.send({ name: 'Job Campo Omitido Teste', atendimentoPersonId })` |
| `POST /api/jobs/:id/classify` > `returns 503 when no classifier is configured` | `.send({ name: 'Job Classify Sem IA Teste' })` | `.send({ name: 'Job Classify Sem IA Teste', atendimentoPersonId })` |
| `POST /api/jobs/:id/classify` > `classifies pasted text and returns resolved suggestions` | `.send({ name: 'Job Classify Com IA Teste' })` | `.send({ name: 'Job Classify Com IA Teste', atendimentoPersonId })` |
| `POST /api/jobs/:id/classify` > `rejects empty text` | `.send({ name: 'Job Classify Texto Vazio Teste' })` | `.send({ name: 'Job Classify Texto Vazio Teste', atendimentoPersonId })` |

The one test that must stay **exactly as-is** (no `atendimentoPersonId`, no new `const atendimentoPersonId = ...` line):
- `POST /api/jobs` > `rejects a job without a name` — this test's whole point is that omitting `name` returns `400`; it never reaches the `atendimentoPersonId` check either way.

Additionally, strengthen two existing assertions now that the response carries the new fields — in `POST /api/jobs` > `creates a job and returns it`, add after the existing `expect(res.body.job.name)...` line:

```ts
      expect(res.body.job.atendimentoPersonId).toBe(atendimentoPersonId);
```

...and in `GET /api/jobs/:id` > `returns the job detail with...`, add after the existing `expect(res.body.job.roleAssignments...)` block:

```ts
      expect(res.body.job.atendimentoPersonId).toBe(atendimentoPersonId);
      expect(res.body.job.atendimentoPersonName).toBe('Wilka');
```

- [ ] **Step 5: Add new validation and endpoint tests to `server/test/routes.jobs.test.ts`**

Append these two `describe` blocks at the end of the file:

```ts
describe('POST /api/jobs — atendimentoPersonId validation', () => {
  it('rejects a job without atendimentoPersonId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.post('/api/jobs').send({ name: 'Job Sem Atendimento Teste' });

      expect(res.status).toBe(400);
    });
  });

  it('rejects an atendimentoPersonId that belongs to a different area', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const anne = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Job Atendimento Área Errada Teste', atendimentoPersonId: anne.rows[0].id });

      expect(res.status).toBe(400);
    });
  });

  it('rejects an inactive atendimentoPersonId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );
      await db.query('UPDATE people SET active = false WHERE id = $1', [wilka.rows[0].id]);

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Job Atendimento Inativo Teste', atendimentoPersonId: wilka.rows[0].id });

      expect(res.status).toBe(400);
    });
  });

  it('rejects a nonexistent atendimentoPersonId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Job Atendimento Inexistente Teste', atendimentoPersonId: 999999999 });

      expect(res.status).toBe(400);
    });
  });
});

describe('PATCH /api/jobs/:id/atendimento', () => {
  it('reassigns the responsible person and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Reatribuição Rota Teste', atendimentoPersonId });

      const camila = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Camila' AND area = 'Atendimento'`,
      );

      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/atendimento`)
        .send({ personId: camila.rows[0].id });

      expect(res.status).toBe(200);
      expect(res.body.job.atendimentoPersonId).toBe(camila.rows[0].id);
      expect(res.body.job.atendimentoPersonName).toBe('Camila');
    });
  });

  it('rejects a personId from a different area', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Reatribuição Área Errada Teste', atendimentoPersonId });

      const anne = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/atendimento`)
        .send({ personId: anne.rows[0].id });

      expect(res.status).toBe(400);
    });
  });

  it('rejects a missing personId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Reatribuição Sem Pessoa Teste', atendimentoPersonId });

      const res = await agent.patch(`/api/jobs/${created.body.job.id}/atendimento`).send({});

      expect(res.status).toBe(400);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const res = await agent
        .patch('/api/jobs/999999999/atendimento')
        .send({ personId: atendimentoPersonId });

      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 6: Run the full backend test suite**

Run: `cd server && npm test`
Expected: all tests pass (this file plus every model/schema test from Tasks 1-2), zero failures. This is the widest-blast-radius step in the whole plan — if any test outside `routes.jobs.test.ts` unexpectedly fails, it means some other file also creates jobs through the HTTP route (not just the model) and was missed; find it with `grep -rn "post('/api/jobs')" server/test` and apply the same fix pattern from Step 4.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/jobs.ts server/test/routes.jobs.test.ts
git commit -m "feat(server): require atendimentoPersonId on job creation, add PATCH /api/jobs/:id/atendimento"
```

---

## Task 4: Frontend (`client.ts`, `Board.tsx`, `JobDetail.tsx`)

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/pages/Board.tsx`
- Modify: `web/src/pages/Board.css`
- Modify: `web/src/pages/JobDetail.tsx`
- Modify: `web/src/pages/JobDetail.css`
- Test: `web/test/Board.test.tsx`
- Test: `web/test/JobDetail.test.tsx`

**Interfaces:**
- Consumes: `POST /api/jobs` (now requires `atendimentoPersonId`) and `PATCH /api/jobs/:id/atendimento` from Task 3. `Job.atendimentoPersonId`/`atendimentoPersonName` and `Person.title` fields from Task 3's JSON responses.
- Produces: nothing further downstream — this is the last task in the plan.

- [ ] **Step 1: Update `web/src/api/client.ts`**

Find the `Job` interface and add two fields before `bolaComDayCounts`:

```ts
export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
  statusId: number | null;
  statusName: string | null;
  phaseId: number | null;
  phaseName: string | null;
  completedAt: string | null;
  alertLevel: AlertLevel;
  highlightedPersonName: string | null;
  bolaCom: BolaCom;
  lastWhatsappActivityAt: string | null;
  actionRequired: string | null;
  triggerLabel: string | null;
  atendimentoPersonId: number | null;
  atendimentoPersonName: string | null;
  bolaComDayCounts?: BolaComDayCounts;
}
```

Find the `Person` interface and add `title`:

```ts
export interface Person {
  id: number;
  name: string;
  area: string;
  active: boolean;
  title: string | null;
}
```

Find `createJob` in the `api` object and change its signature:

```ts
  createJob: (job: { name: string; code?: string; client?: string; atendimentoPersonId: number }) =>
    request<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(job) }),
```

Add a new method right after `assignRole`:

```ts
  setAtendimento: (id: number, personId: number) =>
    request<{ job: Job }>(`/api/jobs/${id}/atendimento`, {
      method: 'PATCH',
      body: JSON.stringify({ personId }),
    }),
```

- [ ] **Step 2: Update `web/src/pages/Board.tsx`**

Find the import line and add `Person`:

```ts
import { api, type AlertLevel, type Job, type Person, type Phase } from '../api/client';
```

Find the state declarations at the top of the `Board` component and add `people` and `atendimentoPersonId`:

```ts
  const { id: openJobId } = useParams<{ id?: string }>();
  const [phases, setPhases] = useState<Phase[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [farolFilter, setFarolFilter] = useState<Set<AlertLevel>>(new Set());
  const [faseFilter, setFaseFilter] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [atendimentoPersonId, setAtendimentoPersonId] = useState('');
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
```

Find `refresh()` and add the `listPeople` call:

```ts
  async function refresh() {
    const [referenceRes, jobsRes, peopleRes] = await Promise.all([
      api.getReference(),
      api.listJobs(),
      api.listPeople(),
    ]);
    setPhases(referenceRes.phases);
    setJobs(jobsRes.jobs);
    setPeople(peopleRes.people);
  }
```

Find `handleCreateJob` and replace it:

```ts
  async function handleCreateJob(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do job.');
      return;
    }
    if (!atendimentoPersonId) {
      setError('Selecione o Atendimento responsável.');
      return;
    }

    try {
      await api.createJob({ name: name.trim(), atendimentoPersonId: Number(atendimentoPersonId) });
      setName('');
      setAtendimentoPersonId('');
      setShowNewJobForm(false);
      await refresh();
    } catch {
      setError('Não foi possível criar o job.');
    }
  }
```

Find the new-job form JSX and replace it:

```tsx
        {showNewJobForm && (
          <form onSubmit={handleCreateJob} className="board-new-job-form">
            <label htmlFor="job-name">Nome do job</label>
            <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <label htmlFor="job-atendimento">Atendimento responsável</label>
            <select
              id="job-atendimento"
              value={atendimentoPersonId}
              onChange={(e) => setAtendimentoPersonId(e.target.value)}
            >
              <option value="">(selecionar)</option>
              {people
                .filter((p) => p.area === 'Atendimento' && p.active)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
            <button type="submit">Adicionar</button>
          </form>
        )}
```

- [ ] **Step 3: Update `web/src/pages/Board.css`**

Find:

```css
.board-new-job-form input {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
```

Replace with:

```css
.board-new-job-form input,
.board-new-job-form select {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 4: Update `web/src/pages/JobDetail.tsx`**

Find `handleAssignRole` and add a new handler right after it:

```ts
  async function handleAssignAtendimento(personId: number) {
    if (!personId) return;
    setError(null);
    try {
      await api.setAtendimento(jobId, personId);
      await refresh();
    } catch {
      setError('Não foi possível atualizar o Atendimento responsável.');
    }
  }
```

Find the end of `.job-detail-header`'s closing `</div>` (right before `{isStuck && counts && (`) and insert this new block immediately after it:

```tsx
        <div className="job-detail-atendimento">
          <span className="label-caps">Atendimento responsável</span>
          <select
            aria-label="Atendimento responsável"
            value={job.atendimentoPersonId ?? ''}
            onChange={(e) => handleAssignAtendimento(Number(e.target.value))}
          >
            <option value="" disabled>
              (selecionar)
            </option>
            {peopleByArea('Atendimento').map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.title ? ` · ${person.title}` : ''}
              </option>
            ))}
          </select>
        </div>
        {!job.atendimentoPersonId && (
          <p className="job-detail-warning job-detail-warning--red">
            Nenhum Atendimento responsável atribuído — selecione um acima.
          </p>
        )}
```

So the full sequence around there reads: `job-detail-header` div closes → new `job-detail-atendimento` block → the empty-state warning (conditional) → the existing `isStuck` warning (conditional) → the existing WhatsApp-activity lines, unchanged.

- [ ] **Step 5: Update `web/src/pages/JobDetail.css`**

Find the `.job-detail-close` rule and add this new block right after it (before `.job-detail-warning`):

```css
.job-detail-atendimento {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
}

.job-detail-atendimento select {
  font-weight: 600;
}
```

- [ ] **Step 6: Update `web/test/Board.test.tsx`**

Add `setAtendimento: vi.fn(),` to the mock factory (the object returned inside `vi.mock('../src/api/client', ...)`), right after `assignRole: vi.fn(),`:

```ts
    api: {
      listJobs: vi.fn(),
      createJob: vi.fn(),
      getReference: vi.fn(),
      getJob: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setAtendimento: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
    },
```

In the `beforeEach`, add resets and a default `listPeople` value:

```ts
  beforeEach(() => {
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.getReference.mockResolvedValue({ phases: twoPhases });
    mockedApi.getJob.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.listPeople.mockResolvedValue({ people: [] });
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setAtendimento.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();
  });
```

Find `makeJob` and add the two new fields to its defaults, right after `highlightedPersonName: 'Anne',`:

```ts
function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Colgate - Color Correct Wave 2',
    code: '0307-2026',
    client: 'Colgate',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    statusId: 10,
    statusName: 'Prospecção',
    phaseId: 1,
    phaseName: 'Comercial e Orçamento',
    completedAt: null,
    alertLevel: 'green' as const,
    highlightedPersonName: 'Anne',
    atendimentoPersonId: null,
    atendimentoPersonName: null,
    bolaCom: 'ilha' as const,
    lastWhatsappActivityAt: null,
    actionRequired: null,
    triggerLabel: 'Avançar para: Briefing Recebido',
    bolaComDayCounts: { ilhaDays: 1, clienteDays: 0, currentSide: 'ilha' as const, currentStreakDays: 1 },
    ...overrides,
  };
}
```

Find the `'creates a job via the new-job form and refreshes the board'` test and replace it:

```ts
  it('creates a job via the new-job form and refreshes the board', async () => {
    mockedApi.listJobs.mockResolvedValueOnce({ jobs: [] }).mockResolvedValueOnce({ jobs: [makeJob({ name: 'Novo job', client: null, highlightedPersonName: null })] });
    mockedApi.listPeople.mockResolvedValue({
      people: [{ id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' }],
    });
    mockedApi.createJob.mockResolvedValue({ job: makeJob({ name: 'Novo job' }) });

    const user = userEvent.setup();
    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    await user.click(screen.getByRole('button', { name: /Criar novo job/ }));
    await user.type(screen.getByLabelText('Nome do job'), 'Novo job');
    await user.selectOptions(screen.getByLabelText('Atendimento responsável'), '7');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job', atendimentoPersonId: 7 }),
    );
    expect(await screen.findByText('Novo job')).toBeInTheDocument();
  });

  it('does not submit the new-job form without an Atendimento responsável selected', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    await user.click(screen.getByRole('button', { name: /Criar novo job/ }));
    await user.type(screen.getByLabelText('Nome do job'), 'Job Sem Atendimento');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(screen.getByText('Selecione o Atendimento responsável.')).toBeInTheDocument();
    expect(mockedApi.createJob).not.toHaveBeenCalled();
  });
```

Find the two inline `job:` fixtures inside `mockedApi.getJob.mockResolvedValue({ job: { ... } })` (in the `'keeps the job table visible when a job is open in the drawer'` and `'refetches the job list when the drawer closes...'` tests) and add `atendimentoPersonId: null,` and `atendimentoPersonName: null,` to each, right after `highlightedPersonName: null,`:

```ts
        highlightedPersonName: null,
        atendimentoPersonId: null,
        atendimentoPersonName: null,
        bolaCom: 'ilha',
```

(This applies to both occurrences — the two tests have identical inline job objects.)

- [ ] **Step 7: Update `web/test/JobDetail.test.tsx`**

Add `setAtendimento: vi.fn(),` to the mock factory, right after `assignRole: vi.fn(),`:

```ts
    api: {
      getJob: vi.fn(),
      getReference: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setAtendimento: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
      listJobs: vi.fn(),
      createJob: vi.fn(),
    },
```

Find the `jobDetail` fixture and add the two new fields, right after `highlightedPersonName: 'Anne',`:

```ts
const jobDetail = {
  id: 1,
  name: 'Colgate - Color Correct Wave 2',
  code: '0307-2026',
  client: 'Colgate',
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
  statusId: 10,
  statusName: 'Prospecção',
  phaseId: 1,
  phaseName: 'Comercial e Orçamento',
  completedAt: null,
  alertLevel: 'green' as const,
  highlightedPersonName: 'Anne',
  atendimentoPersonId: 7,
  atendimentoPersonName: 'Wilka',
  bolaCom: 'ilha' as const,
  lastWhatsappActivityAt: null,
  actionRequired: 'Preenchimento do Briefing Padronizado.',
  triggerLabel: 'Avançar para: Briefing Recebido',
  bolaComDayCounts: { ilhaDays: 3, clienteDays: 0, currentSide: 'ilha' as const, currentStreakDays: 3 },
  roleAssignments: [
    { area: 'Comercial', personId: 5, personName: 'Anne' },
    { area: 'Produção Executiva', personId: null, personName: null },
  ],
  statusHistory: [
    { id: 1, fromStatusId: null, toStatusId: 10, changedAt: '2026-08-18T00:00:00.000Z', note: null },
  ],
};
```

Find the `beforeEach`'s `mockedApi.listPeople.mockResolvedValue(...)` call and add a `title: null` to the two existing people plus a new Atendimento person, and add `mockedApi.setAtendimento.mockReset();` to the reset list:

```ts
  beforeEach(() => {
    mockedApi.getJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setAtendimento.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    mockedApi.getJob.mockResolvedValue({ job: jobDetail });
    mockedApi.getReference.mockResolvedValue({ phases: referencePhases });
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 5, name: 'Anne', area: 'Comercial', active: true, title: null },
        { id: 6, name: 'Adriano', area: 'Produção Executiva', active: true, title: null },
        { id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' },
      ],
    });
  });
```

Add these three new tests inside the `describe('JobDetailPage', ...)` block, after the existing `'shows the role assignment dropdowns for the current phase'` test:

```ts
  it('shows the Atendimento responsável name and title', async () => {
    renderJobDetail();

    expect(await screen.findByLabelText('Atendimento responsável')).toHaveValue('7');
    expect(screen.getByRole('option', { name: 'Wilka · Head' })).toBeInTheDocument();
  });

  it('shows a warning when no Atendimento responsável is assigned', async () => {
    mockedApi.getJob.mockResolvedValue({
      job: { ...jobDetail, atendimentoPersonId: null, atendimentoPersonName: null },
    });

    renderJobDetail();

    expect(
      await screen.findByText('Nenhum Atendimento responsável atribuído — selecione um acima.'),
    ).toBeInTheDocument();
  });

  it('reassigns the Atendimento responsável via the select', async () => {
    mockedApi.setAtendimento.mockResolvedValue({ job: { ...jobDetail, atendimentoPersonId: 7 } });
    const user = userEvent.setup();

    renderJobDetail();

    await screen.findByText('Colgate - Color Correct Wave 2');
    await user.selectOptions(screen.getByLabelText('Atendimento responsável'), '7');

    await waitFor(() => expect(mockedApi.setAtendimento).toHaveBeenCalledWith(1, 7));
  });
```

- [ ] **Step 8: Run the frontend test suite and type-check**

Run: `cd web && npm test`
Expected: all tests pass, including the new ones in Board.test.tsx and JobDetail.test.tsx.

Run: `cd web && npx tsc -b`
Expected: clean, zero errors.

- [ ] **Step 9: Commit**

```bash
git add web/src/api/client.ts web/src/pages/Board.tsx web/src/pages/Board.css web/src/pages/JobDetail.tsx web/src/pages/JobDetail.css web/test/Board.test.tsx web/test/JobDetail.test.tsx
git commit -m "feat(web): require and display a single Atendimento responsável per job"
```

---

## Manual verification (after all tasks merge)

Not covered by any automated test — do this once the branch is merged, with the real dev servers running:

1. Open the Board, click "Criar novo job", try to submit without picking an Atendimento — confirm the inline error and that no job is created.
2. Create a job picking one of the 8 Atendimento people — confirm it appears with that person as part of the job's data (open its detail panel).
3. Open one of the 27 pre-existing jobs (which have no Atendimento yet) — confirm the empty-state warning shows, pick a person from the select, confirm it saves and the warning disappears.
4. Reassign an already-set Atendimento on a job to a different person — confirm it updates immediately without needing to be the job's creator or any special role.
