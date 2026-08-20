# Redesign Visual — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the frontend (Board, JobDetail, Users, Login) to match the "Torre de Controle" visual/interaction design — light theme built from the Ilha Crossmídia brand palette, dense operational dashboard structure — reusing the backend built in the prior "Dados e Backend" plan, plus one small backend enrichment this plan needs.

**Architecture:** A small CSS custom-property token system (`web/src/styles/tokens.css`) drives palette/typography everywhere; each page keeps its own scoped CSS file. No new frontend framework/dependency — plain CSS, existing React + Vite stack. `JobDetail` stays its own route (`/jobs/:id`, not a shared-state overlay over `Board`) styled to read as a right-aligned panel — this is a deliberate simplification of the mockup's true overlay behavior, called out in Task 5.

**Tech Stack:** React + Vite + TypeScript, `react-router-dom`, Vitest + Testing Library, Google Fonts (Archivo, IBM Plex Mono) loaded via `<link>` in `index.html`.

**Spec:** [docs/superpowers/specs/2026-08-19-redesign-visual-torre-de-controle-design.md](../specs/2026-08-19-redesign-visual-torre-de-controle-design.md)

## Global Constraints

- No new npm dependency for styling (no Tailwind/CSS-in-JS/component library) — plain CSS + the token system, per the spec's approved styling approach.
- Palette and phase colors come from `web/src/styles/tokens.css`'s CSS custom properties — no component hardcodes a hex color.
- Phase color lookups key on a phase's numeric `order` (1-6), never on its `name` — phase names have already been renamed once (prior plan) and could change again.
- Every `fetch` continues to go through the single chokepoint in `web/src/api/client.ts` (`credentials: 'include'`, `ApiError` on non-2xx) — no component calls `fetch` directly.
- Backend routes this plan's frontend consumes are already merged to `master`: `PATCH /api/jobs/:id/bola-com`, `PATCH /api/jobs/:id/last-activity`, `POST /api/jobs/:id/classify`, and `GET /api/jobs/:id` (all from the "Dados e Backend" plan). Task 1 below adds the one thing that plan's final review flagged as still missing: bulk data on the LIST endpoint.
- Every task that touches a page component must also update or rewrite that page's existing test file in `web/test/` so the suite passes — a redesigned DOM with a stale test file is not a complete task.

---

### Task 1: Backend — enrich the job list for the Board

The prior plan's final whole-branch review flagged this as a known gap, ruled to fix in this plan rather than that one: `GET /api/jobs` (list) never got bulk bola-com day-counts, only `GET /api/jobs/:id` (detail) did — but the Board's table needs a responsibility-timeline bar and a "retenção do cliente" stat computed from EVERY active job, and mapping the existing single-job `getBolaComDayCounts` over the list would create a 2N+1 query pattern. This task adds a single set-based aggregate instead. It also promotes `actionRequired`/`triggerLabel` onto the base `Job` type (today only `JobDetail` has them, via a second, redundant query in the route handler) so every list row can show "Aguardando: `<next status>`" without a per-row detail fetch.

**Files:**
- Modify: `server/src/models/bolaCom.ts`
- Modify: `server/src/models/job.ts`
- Modify: `server/src/routes/jobs.ts`
- Modify: `server/test/models.bolaCom.test.ts`
- Modify: `server/test/routes.jobs.test.ts`

**Interfaces:**
- Consumes: `job_bola_com_history` table, `AppDatabase`, `Job`/`JobRow`/`rowToJob` (all from the prior plan).
- Produces: `getBolaComDayCountsForJobs(db, jobIds: number[]): Promise<Map<number, BolaComDayCounts>>` in `bolaCom.ts`; `Job.actionRequired: string | null` and `Job.triggerLabel: string | null` (promoted from `JobDetail`-only to every `Job`); `GET /api/jobs` response items each carry `bolaComDayCounts: BolaComDayCounts`.

- [ ] **Step 1: Write the failing test for the bulk day-count query**

Add to `server/test/models.bolaCom.test.ts` (append to the existing `describe('bola com', ...)` block, after the last test):

```typescript
  it('getBolaComDayCountsForJobs computes counts for multiple jobs in one call', async () => {
    await withTestTransaction(async (db) => {
      const jobA = await createJob(db, { name: 'Job Bola Com Lote A Teste' });
      const jobB = await createJob(db, { name: 'Job Bola Com Lote B Teste' });

      await db.query(
        `UPDATE job_bola_com_history SET changed_at = now() - interval '4 days' WHERE job_id = $1`,
        [jobA.id],
      );
      await setBolaCom(db, jobB.id, 'cliente');

      const counts = await getBolaComDayCountsForJobs(db, [jobA.id, jobB.id]);

      expect(counts.get(jobA.id)?.currentSide).toBe('ilha');
      expect(counts.get(jobA.id)?.ilhaDays).toBe(4);
      expect(counts.get(jobB.id)?.currentSide).toBe('cliente');
    });
  });

  it('getBolaComDayCountsForJobs returns an empty map for an empty id list', async () => {
    await withTestTransaction(async (db) => {
      const counts = await getBolaComDayCountsForJobs(db, []);
      expect(counts.size).toBe(0);
    });
  });
```

Update the file's import line to add `getBolaComDayCountsForJobs`:

```typescript
import { setBolaCom, getBolaComDayCounts, getBolaComDayCountsForJobs } from '../src/models/bolaCom';
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd server && npx vitest run test/models.bolaCom.test.ts`
Expected: FAIL — `getBolaComDayCountsForJobs is not a function` (or a TS import error).

- [ ] **Step 3: Implement `getBolaComDayCountsForJobs` in `server/src/models/bolaCom.ts`**

Add this function to the end of the file (keep everything else in the file unchanged):

```typescript
export async function getBolaComDayCountsForJobs(
  db: AppDatabase,
  jobIds: number[],
  now: Date = new Date(),
): Promise<Map<number, BolaComDayCounts>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  const result = await db.query<{
    job_id: number;
    ilha_seconds: number | null;
    cliente_seconds: number | null;
    current_side: BolaCom;
    last_changed_at: string | Date;
  }>(
    `WITH ordered AS (
       SELECT
         job_id,
         bola_com,
         changed_at,
         LEAD(changed_at) OVER (PARTITION BY job_id ORDER BY changed_at, id) AS next_changed_at
       FROM job_bola_com_history
       WHERE job_id = ANY($1::int[])
     )
     SELECT
       job_id,
       SUM(EXTRACT(EPOCH FROM (COALESCE(next_changed_at, now()) - changed_at)))
         FILTER (WHERE bola_com = 'ilha') AS ilha_seconds,
       SUM(EXTRACT(EPOCH FROM (COALESCE(next_changed_at, now()) - changed_at)))
         FILTER (WHERE bola_com = 'cliente') AS cliente_seconds,
       (array_agg(bola_com ORDER BY changed_at DESC))[1] AS current_side,
       MAX(changed_at) AS last_changed_at
     FROM ordered
     GROUP BY job_id`,
    [jobIds],
  );

  const map = new Map<number, BolaComDayCounts>();
  for (const row of result.rows) {
    const lastChangedAt = new Date(row.last_changed_at);
    map.set(row.job_id, {
      ilhaDays: Math.floor((row.ilha_seconds ?? 0) / SECONDS_PER_DAY),
      clienteDays: Math.floor((row.cliente_seconds ?? 0) / SECONDS_PER_DAY),
      currentSide: row.current_side,
      currentStreakDays: Math.floor((now.getTime() - lastChangedAt.getTime()) / MS_PER_DAY),
    });
  }
  return map;
}
```

Add the new constant next to the existing `MS_PER_DAY` constant near the top of the file:

```typescript
const SECONDS_PER_DAY = 24 * 60 * 60;
```

- [ ] **Step 4: Run the test again and see it pass**

Run: `cd server && npx vitest run test/models.bolaCom.test.ts`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 5: Promote `actionRequired`/`triggerLabel` onto the base `Job` type**

In `server/src/models/job.ts`, update `JOB_SELECT` (around line 36) to add the two columns:

```typescript
const JOB_SELECT = `
  SELECT
    j.*,
    s.id AS status_id,
    s.name AS status_name,
    s.action_required AS status_action_required,
    s.trigger_label AS status_trigger_label,
    p.id AS phase_id,
    p.name AS phase_name,
    (
      SELECT person.name
      FROM job_role_assignments jra
      JOIN people person ON person.id = jra.person_id
      WHERE jra.job_id = j.id AND jra.phase_id = s.phase_id AND jra.area = s.primary_role
      LIMIT 1
    ) AS highlighted_person_name
  FROM jobs j
  LEFT JOIN statuses s ON s.id = j.status_id
  LEFT JOIN phases p ON p.id = s.phase_id
`;
```

Add to the `Job` interface, after `lastWhatsappActivityAt`:

```typescript
  lastWhatsappActivityAt: string | null;
  actionRequired: string | null;
  triggerLabel: string | null;
```

Add to the `JobRow` interface, after `last_whatsapp_activity_at`:

```typescript
  last_whatsapp_activity_at: string | Date | null;
  status_action_required: string | null;
  status_trigger_label: string | null;
```

Add to `rowToJob`'s returned object, after `lastWhatsappActivityAt`:

```typescript
    lastWhatsappActivityAt: row.last_whatsapp_activity_at
      ? new Date(row.last_whatsapp_activity_at).toISOString()
      : null,
    actionRequired: row.status_action_required,
    triggerLabel: row.status_trigger_label,
```

- [ ] **Step 6: Simplify the `GET /:id` route to stop re-querying what `getJobById` now already has, and add bulk day-counts to `GET /`**

In `server/src/routes/jobs.ts`, update the import line to add `getBolaComDayCountsForJobs`:

```typescript
import { setBolaCom, getBolaComDayCounts, getBolaComDayCountsForJobs } from '../models/bolaCom';
```

Replace the `router.get('/', ...)` handler (near the top of `createJobsRouter`) with:

```typescript
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const jobs = await listJobs(deps.db);
      const dayCounts = await getBolaComDayCountsForJobs(deps.db, jobs.map((j) => j.id));

      res.json({
        jobs: jobs.map((job) => ({
          ...job,
          bolaComDayCounts: dayCounts.get(job.id) ?? {
            ilhaDays: 0,
            clienteDays: 0,
            currentSide: job.bolaCom,
            currentStreakDays: 0,
          },
        })),
      });
    }),
  );
```

Replace the `router.get('/:id', ...)` handler's body — it currently runs a separate `deps.db.query(...)` for `action_required`/`trigger_label`, which is now redundant since `getJobById` already returns them on `job.actionRequired`/`job.triggerLabel`. Change:

```typescript
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
```

to:

```typescript
      const [roleAssignments, statusHistory, bolaComDayCounts] = await Promise.all([
        job.phaseId ? getJobRoleAssignments(deps.db, jobId, job.phaseId) : Promise.resolve([]),
        getJobStatusHistory(deps.db, jobId),
        getBolaComDayCounts(deps.db, jobId),
      ]);

      res.json({
        job: {
          ...job,
          roleAssignments,
          statusHistory,
          bolaComDayCounts,
        },
      });
```

- [ ] **Step 7: Update tests that asserted the old `GET /:id` shape, and add coverage for the new `GET /` shape**

In `server/test/routes.jobs.test.ts`, the existing test `'returns the job detail with actionRequired, triggerLabel, roleAssignments, and history'` (under `describe('GET /api/jobs/:id', ...)`) already asserts `res.body.job.actionRequired`/`triggerLabel` — it needs no change, since the response shape is unchanged from the caller's point of view (still on `job.actionRequired`/`job.triggerLabel`), only where the server computes it internally changed.

Add a new test to the `describe('GET /api/jobs', ...)` block (append after the existing `'includes a freshly created job in the list'` test):

```typescript
  it('includes bolaComDayCounts and triggerLabel on every job in the list', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      await agent.post('/api/jobs').send({ name: 'Job Listagem Enriquecida Rota Teste' });
      const res = await agent.get('/api/jobs');

      const found = res.body.jobs.find(
        (j: { name: string }) => j.name === 'Job Listagem Enriquecida Rota Teste',
      );

      expect(found).toBeDefined();
      expect(found.bolaComDayCounts).toEqual({
        ilhaDays: 0,
        clienteDays: 0,
        currentSide: 'ilha',
        currentStreakDays: 0,
      });
      expect(found.triggerLabel).toBe('Avançar para: Briefing Recebido');
    });
  });
```

- [ ] **Step 8: Run the full server suite and the production build**

Run: `cd server && npm test`
Expected: all tests pass (baseline 131 + 3 new = 134).

Run: `cd server && npm run build`
Expected: compiles cleanly, no type errors.

- [ ] **Step 9: Commit**

```bash
git add server/src/models/bolaCom.ts server/src/models/job.ts server/src/routes/jobs.ts server/test/models.bolaCom.test.ts server/test/routes.jobs.test.ts
git commit -m "feat(jobs): add bulk bola-com day-counts and triggerLabel to job list"
```

---

### Task 2: Design tokens and typography

**Files:**
- Create: `web/src/styles/tokens.css`
- Create: `web/src/theme/phase.ts`
- Modify: `web/index.html`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: nothing (foundational task).
- Produces: CSS custom properties (`--bg`, `--text-primary`, `--fase-1`..`--fase-6`, `--farol-travado`/`--farol-atencao`/`--farol-fluindo`, `--font-heading`, `--font-mono`, `--radius`, `--shadow-sm`, `--shadow-md`, `--border`) that every later task's CSS files use; `PHASE_COLOR_VARS: Record<number, string>`, `FAROL_COLOR_VARS`, `FAROL_LABELS`, `AlertLevel` re-export from `web/src/theme/phase.ts`, imported by Tasks 4-5.

- [ ] **Step 1: Load the Google Fonts**

In `web/index.html`, add inside `<head>`, after the `<title>` line:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 2: Create the token stylesheet**

Create `web/src/styles/tokens.css`:

```css
:root {
  /* base */
  --bg: #ffffff;
  --bg-subtle: #f7f7fa;
  --bg-panel: #ffffff;
  --bg-hover: #f0f0f4;
  --border: #e5e5ea;
  --text-primary: #1a1a24;
  --text-secondary: #6b7280;
  --text-inverse: #ffffff;

  /* farol (semantic, not brand-derived) */
  --farol-travado: #dc2626;
  --farol-atencao: #f59e0b;
  --farol-fluindo: #16a34a;
  --farol-travado-bg: #fef2f2;
  --farol-atencao-bg: #fffbeb;

  /* fases, sampled from the Ilha Crossmídia logo gradient, in job-lifecycle order */
  --fase-1: #d6236f; /* Comercial e Orçamento — magenta/rosa */
  --fase-2: #f0932b; /* Dotação e Burocracia — laranja */
  --fase-3: #8fbf4f; /* Pré-Produção — verde-amarelado */
  --fase-4: #1b9e8c; /* Captação — teal */
  --fase-5: #4a3f9e; /* Pós-Produção — índigo/roxo-azulado */
  --fase-6: #7a2f8f; /* Encerramento — roxo profundo */

  --font-heading: 'Archivo', system-ui, -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'Courier New', monospace;

  --radius-sm: 4px;
  --radius: 8px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgba(20, 20, 30, 0.06);
  --shadow-md: 0 4px 16px rgba(20, 20, 30, 0.1);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg-subtle);
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

button,
input,
select,
textarea {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

a {
  color: inherit;
}

.label-caps {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Import the tokens in the app entry point**

In `web/src/main.tsx`, add as the first import (before `import React from 'react'`):

```typescript
import './styles/tokens.css';
```

- [ ] **Step 4: Create the phase/farol color lookup module**

Create `web/src/theme/phase.ts`:

```typescript
import type { AlertLevel } from '../api/client';

export const PHASE_COLOR_VARS: Record<number, string> = {
  1: 'var(--fase-1)',
  2: 'var(--fase-2)',
  3: 'var(--fase-3)',
  4: 'var(--fase-4)',
  5: 'var(--fase-5)',
  6: 'var(--fase-6)',
};

export const FAROL_COLOR_VARS: Record<AlertLevel, string> = {
  red: 'var(--farol-travado)',
  yellow: 'var(--farol-atencao)',
  green: 'var(--farol-fluindo)',
};

export const FAROL_LABELS: Record<AlertLevel, string> = {
  red: 'Travado',
  yellow: 'Atenção',
  green: 'Fluindo',
};

export function phaseColor(order: number | undefined | null): string {
  if (!order || !(order in PHASE_COLOR_VARS)) {
    return 'var(--border)';
  }
  return PHASE_COLOR_VARS[order];
}
```

- [ ] **Step 5: Verify the build still compiles**

Run: `cd web && npm run build`
Expected: compiles cleanly (this task adds no component changes yet, just infrastructure).

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/src/main.tsx web/src/styles/tokens.css web/src/theme/phase.ts
git commit -m "feat(web): add design token system and Ilha Crossmídia brand palette"
```

---

### Task 3: API client — new fields and endpoints

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/test/api.client.test.ts`

**Interfaces:**
- Consumes: the 3 new/changed backend routes (Tasks 1-4 of the prior "Dados e Backend" plan, already merged) plus Task 1 of this plan.
- Produces: `BolaCom`, `BolaComDayCounts`, `ClassifySuggestion` types; `api.setBolaCom`, `api.setLastActivity`, `api.classifyJob`; `Job.bolaCom`, `Job.lastWhatsappActivityAt`, `Job.actionRequired`, `Job.triggerLabel`, `Job.bolaComDayCounts?`; `JobDetail.bolaComDayCounts` (non-optional).

- [ ] **Step 1: Read the current test file to see its exact mocking pattern**

Read `web/test/api.client.test.ts` before editing — match its existing `fetch` mock style exactly (it likely stubs `global.fetch` and asserts on the request URL/method/body). Do not restructure the file's existing test approach; only add to it.

- [ ] **Step 2: Update the `Job` and `JobDetail` types**

In `web/src/api/client.ts`, replace the `Job` interface with:

```typescript
export type BolaCom = 'ilha' | 'cliente';

export interface BolaComDayCounts {
  ilhaDays: number;
  clienteDays: number;
  currentSide: BolaCom;
  currentStreakDays: number;
}

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
  bolaComDayCounts?: BolaComDayCounts;
}
```

Replace the `JobDetail` interface with:

```typescript
export interface JobDetail extends Job {
  roleAssignments: RoleAssignment[];
  statusHistory: StatusHistoryEntry[];
  bolaComDayCounts: BolaComDayCounts;
}
```

(`actionRequired`/`triggerLabel` are removed from `JobDetail`'s own declaration since they're now inherited from `Job` — leaving them here too would be a duplicate/conflicting declaration.)

- [ ] **Step 3: Add the `ClassifySuggestion` type**

Add after the `JobDetail` interface:

```typescript
export type SuggestionOutcome = 'auto_aplicado' | 'pendente' | 'descartado';

export interface ClassifySuggestion {
  tipo: 'checklist_item' | 'bola_com';
  valor: string;
  confidence: number;
  evidencia: string;
  outcome: SuggestionOutcome;
}
```

- [ ] **Step 4: Add the 3 new API methods**

In the `api` object, add after `assignRole`:

```typescript
  setBolaCom: (id: number, bolaCom: BolaCom) =>
    request<{ job: Job; bolaComDayCounts: BolaComDayCounts }>(`/api/jobs/${id}/bola-com`, {
      method: 'PATCH',
      body: JSON.stringify({ bolaCom }),
    }),
  setLastActivity: (id: number, lastWhatsappActivityAt: string | null) =>
    request<{ job: Job }>(`/api/jobs/${id}/last-activity`, {
      method: 'PATCH',
      body: JSON.stringify({ lastWhatsappActivityAt }),
    }),
  classifyJob: (id: number, text: string) =>
    request<{ suggestions: ClassifySuggestion[] }>(`/api/jobs/${id}/classify`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
```

- [ ] **Step 5: Add tests for the 3 new methods**

Append to `web/test/api.client.test.ts`, following the exact mocking pattern already used by the file's existing tests for `advanceJob`/`assignRole` (read those first and mirror their structure — same `mockFetch`/`Response` setup, same assertion style on URL/method/body):

```typescript
describe('setBolaCom', () => {
  it('PATCHes the bola-com side', async () => {
    mockFetchOnce({ job: { id: 1, bolaCom: 'cliente' }, bolaComDayCounts: { ilhaDays: 1, clienteDays: 0, currentSide: 'cliente', currentStreakDays: 0 } });

    await api.setBolaCom(1, 'cliente');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/bola-com'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ bolaCom: 'cliente' }) }),
    );
  });
});

describe('setLastActivity', () => {
  it('PATCHes the last WhatsApp activity timestamp', async () => {
    mockFetchOnce({ job: { id: 1, lastWhatsappActivityAt: '2026-08-19T00:00:00.000Z' } });

    await api.setLastActivity(1, '2026-08-19T00:00:00.000Z');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/last-activity'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ lastWhatsappActivityAt: '2026-08-19T00:00:00.000Z' }),
      }),
    );
  });
});

describe('classifyJob', () => {
  it('POSTs pasted text and returns suggestions', async () => {
    mockFetchOnce({ suggestions: [] });

    await api.classifyJob(1, 'texto colado');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/classify'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'texto colado' }) }),
    );
  });
});
```

**Note for the implementer:** `mockFetchOnce` and `fetchMock` above are placeholder names standing in for whatever this file's existing tests actually call their fetch-mocking helper and mock reference — read the file first (Step 1) and use its real names/pattern, not these placeholders verbatim. The request bodies and assertion shapes are exact; only the mocking mechanics should match the file's existing convention.

- [ ] **Step 6: Run the frontend test suite and the build**

Run: `cd web && npm test`
Expected: all existing tests still pass, plus the 3 new ones.

Run: `cd web && npm run build`
Expected: `tsc -b && vite build` compiles cleanly. Pay attention to any other file that constructs a `Job` or `JobDetail` object (e.g. other test files' fixtures) — TypeScript will now require `bolaCom`/`lastWhatsappActivityAt`/`actionRequired`/`triggerLabel` on every `Job` literal. Fixture objects in `web/test/Board.test.tsx` and `web/test/JobDetail.test.tsx` will fail to compile until Tasks 4 and 5 rewrite those files — that's expected and handled there, not here. If `tsc -b` fails ONLY on those two files' fixtures, that's fine to leave failing at the end of this task; if it fails anywhere else, fix it here.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/client.ts web/test/api.client.test.ts
git commit -m "feat(web): add bola-com, last-activity, and classify to the API client"
```

---

### Task 4: Board redesign

**Files:**
- Modify: `web/src/pages/Board.tsx` (full rewrite)
- Create: `web/src/pages/Board.css`
- Modify: `web/test/Board.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `api.listJobs`, `api.getReference`, `api.createJob` (existing); `Job.bolaCom`, `Job.bolaComDayCounts`, `Job.triggerLabel`, `Job.actionRequired` (Task 3); `phaseColor`, `FAROL_COLOR_VARS`, `FAROL_LABELS` (Task 2).
- Produces: nothing consumed by a later task (Board is a leaf page).

**Design decisions this task makes (disclosed simplifications from the mockup, not blocking — flag to your human partner if you want to revisit):**
- The mockup's "GRUPO ANCORA" (WhatsApp group name) has no backend equivalent yet (that only exists once the WhatsApp/OpenWA integration lands) — this task uses `job.client` as the table's top small-caps line instead.
- "ENTRAM EM SET esta semana" is defined here as "jobs whose current phase is Captação" (phase `order === 4`) — the mockup's "esta semana" time-window has no clean backend signal yet.
- No "Grupos do WhatsApp" / "Ler conversa do grupo" sidebar panel — explicitly out of scope per the spec (deferred to the OpenWA integration).

- [ ] **Step 1: Rewrite `web/src/pages/Board.tsx`**

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type AlertLevel, type Job, type Phase } from '../api/client';
import { FAROL_COLOR_VARS, FAROL_LABELS, phaseColor } from '../theme/phase';
import './Board.css';

const FAROL_ORDER: AlertLevel[] = ['red', 'yellow', 'green'];
const CAPTACAO_PHASE_ORDER = 4;

function phaseOrderOf(phases: Phase[], phaseId: number | null): number | null {
  return phases.find((p) => p.id === phaseId)?.order ?? null;
}

function matchesSearch(job: Job, term: string): boolean {
  if (!term) return true;
  const haystack = `${job.name} ${job.client ?? ''} ${job.highlightedPersonName ?? ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function Board() {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [farolFilter, setFarolFilter] = useState<Set<AlertLevel>>(new Set());
  const [faseFilter, setFaseFilter] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [referenceRes, jobsRes] = await Promise.all([api.getReference(), api.listJobs()]);
    setPhases(referenceRes.phases);
    setJobs(jobsRes.jobs);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar o board.'));
  }, []);

  const activeJobs = useMemo(() => jobs.filter((j) => !j.completedAt), [jobs]);

  const farolCounts = useMemo(() => {
    const counts: Record<AlertLevel, number> = { red: 0, yellow: 0, green: 0 };
    for (const job of activeJobs) counts[job.alertLevel]++;
    return counts;
  }, [activeJobs]);

  const faseCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const job of activeJobs) {
      if (job.phaseId) counts.set(job.phaseId, (counts.get(job.phaseId) ?? 0) + 1);
    }
    return counts;
  }, [activeJobs]);

  const visibleJobs = useMemo(() => {
    return activeJobs.filter((job) => {
      if (farolFilter.size > 0 && !farolFilter.has(job.alertLevel)) return false;
      if (faseFilter.size > 0 && (!job.phaseId || !faseFilter.has(job.phaseId))) return false;
      if (!matchesSearch(job, search)) return false;
      return true;
    });
  }, [activeJobs, farolFilter, faseFilter, search]);

  const stuckJobs = useMemo(
    () =>
      activeJobs
        .filter((j) => j.alertLevel === 'red')
        .sort((a, b) => (b.bolaComDayCounts?.currentStreakDays ?? 0) - (a.bolaComDayCounts?.currentStreakDays ?? 0)),
    [activeJobs],
  );

  const stats = useMemo(() => {
    const bolaIlha = activeJobs.filter((j) => j.bolaCom === 'ilha').length;
    const bolaCliente = activeJobs.filter((j) => j.bolaCom === 'cliente').length;
    const retencaoDias = activeJobs.reduce((sum, j) => sum + (j.bolaComDayCounts?.clienteDays ?? 0), 0);
    const entramEmSet = activeJobs.filter((j) => phaseOrderOf(phases, j.phaseId) === CAPTACAO_PHASE_ORDER).length;
    return { ativos: activeJobs.length, bolaIlha, bolaCliente, retencaoDias, entramEmSet };
  }, [activeJobs, phases]);

  function toggleFarol(level: AlertLevel) {
    setFarolFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleFase(phaseId: number) {
    setFaseFilter((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  async function handleCreateJob(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do job.');
      return;
    }

    try {
      await api.createJob({ name: name.trim() });
      setName('');
      setShowNewJobForm(false);
      await refresh();
    } catch {
      setError('Não foi possível criar o job.');
    }
  }

  return (
    <div className="board">
      <aside className="board-sidebar">
        <input
          className="board-search"
          placeholder="Cliente, job ou responsável"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar"
        />

        <div className="board-filter-group">
          <h2 className="label-caps">Farol</h2>
          {FAROL_ORDER.map((level) => (
            <button
              key={level}
              type="button"
              className={`board-filter-row${farolFilter.has(level) ? ' is-active' : ''}`}
              onClick={() => toggleFarol(level)}
            >
              <span className="board-dot" style={{ background: FAROL_COLOR_VARS[level] }} />
              <span className="board-filter-label">{FAROL_LABELS[level]}</span>
              <span className="board-filter-count">{farolCounts[level]}</span>
            </button>
          ))}
        </div>

        <div className="board-filter-group">
          <h2 className="label-caps">Fase</h2>
          {phases.map((phase) => (
            <button
              key={phase.id}
              type="button"
              className={`board-filter-row${faseFilter.has(phase.id) ? ' is-active' : ''}`}
              onClick={() => toggleFase(phase.id)}
            >
              <span className="board-swatch" style={{ background: phaseColor(phase.order) }} />
              <span className="board-filter-label">{phase.name}</span>
              <span className="board-filter-count">{faseCounts.get(phase.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="board-main">
        <header className="board-header">
          <div>
            <p className="label-caps">Ilha Crossmídia · Atendimento</p>
            <h1>
              Torre de Controle <span className="board-header-count">/ {jobs.length} jobs</span>
            </h1>
          </div>
          <button type="button" className="board-new-job-btn" onClick={() => setShowNewJobForm((v) => !v)}>
            + Novo job
          </button>
        </header>

        {showNewJobForm && (
          <form onSubmit={handleCreateJob} className="board-new-job-form">
            <label htmlFor="job-name">Nome do job</label>
            <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button type="submit">Adicionar</button>
          </form>
        )}

        {error && (
          <p role="alert" className="board-error">
            {error}
          </p>
        )}

        {stuckJobs.length > 0 && (
          <section className="board-stuck-banner">
            <p className="board-stuck-title">
              {stuckJobs.length} {stuckJobs.length === 1 ? 'JOB TRAVADO' : 'JOBS TRAVADOS'} · EXIGEM SUA AÇÃO HOJE
            </p>
            <ul className="board-stuck-list">
              {stuckJobs.map((job) => (
                <li key={job.id}>
                  <Link to={`/jobs/${job.id}`} className="board-stuck-job">
                    <span className="board-stuck-name">{job.client ?? job.name}</span>
                    <span className="board-stuck-days">
                      {job.bolaComDayCounts?.currentStreakDays ?? 0} dias parado com{' '}
                      {job.bolaCom === 'cliente' ? 'o cliente' : 'a Ilha'}
                    </span>
                  </Link>
                  {job.highlightedPersonName && (
                    <span className="board-stuck-person">{job.highlightedPersonName}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="board-stats">
          <div className="board-stat-card">
            <p className="label-caps">Em produção</p>
            <p className="board-stat-value">
              {stats.ativos} <span>jobs ativos</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Bola com a Ilha</p>
            <p className="board-stat-value">
              {stats.bolaIlha} <span>jobs</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Bola com o cliente</p>
            <p className="board-stat-value board-stat-value--warn">
              {stats.bolaCliente} <span>jobs</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Retenção do cliente</p>
            <p className="board-stat-value board-stat-value--warn">
              {stats.retencaoDias} <span>dias somados</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Entram em set</p>
            <p className="board-stat-value">
              {stats.entramEmSet} <span>jobs em Captação</span>
            </p>
          </div>
        </section>

        <table className="board-table">
          <thead>
            <tr>
              <th>Fases</th>
              <th>Job</th>
              <th>Etapa atual</th>
              <th>Bola com</th>
              <th>Relógio de responsabilidade</th>
            </tr>
          </thead>
          <tbody>
            {visibleJobs.map((job) => {
              const currentOrder = phaseOrderOf(phases, job.phaseId) ?? 0;
              const counts = job.bolaComDayCounts;
              const totalDays = (counts?.ilhaDays ?? 0) + (counts?.clienteDays ?? 0);
              const ilhaPct = totalDays === 0 ? 100 : ((counts?.ilhaDays ?? 0) / totalDays) * 100;

              return (
                <tr key={job.id}>
                  <td>
                    <div className="board-mini-bar">
                      {phases.map((phase) => (
                        <span
                          key={phase.id}
                          className="board-mini-segment"
                          style={{ background: phase.order <= currentOrder ? phaseColor(phase.order) : 'var(--border)' }}
                        />
                      ))}
                    </div>
                  </td>
                  <td>
                    <Link to={`/jobs/${job.id}`} className="board-job-link">
                      <span className="label-caps">{job.client ?? '—'}</span>
                      <span className="board-job-name">{job.name}</span>
                    </Link>
                  </td>
                  <td>
                    <p className="board-job-phase" style={{ color: phaseColor(currentOrder) }}>
                      F{currentOrder} · {job.phaseName ?? ''}
                    </p>
                    {job.triggerLabel && <p className="board-job-next">{job.triggerLabel}</p>}
                  </td>
                  <td>
                    <span className={`board-bola-tag board-bola-tag--${job.bolaCom}`}>
                      {job.highlightedPersonName ?? (job.bolaCom === 'cliente' ? 'Cliente' : 'Ilha')}
                    </span>
                  </td>
                  <td>
                    <div className="board-timeline">
                      <div className="board-timeline-bar">
                        <span className="board-timeline-ilha" style={{ width: `${ilhaPct}%` }} />
                        <span className="board-timeline-cliente" style={{ width: `${100 - ilhaPct}%` }} />
                      </div>
                      <div className="board-timeline-labels">
                        <span>Ilha {counts?.ilhaDays ?? 0}d</span>
                        <span>Cliente {counts?.clienteDays ?? 0}d</span>
                      </div>
                    </div>
                    <span className="board-dot board-dot--inline" style={{ background: FAROL_COLOR_VARS[job.alertLevel] }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/pages/Board.css`**

```css
.board {
  display: flex;
  min-height: 100vh;
  background: var(--bg-subtle);
}

.board-sidebar {
  width: 260px;
  flex: 0 0 auto;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  padding: 1.25rem 1rem;
}

.board-search {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 1.5rem;
}

.board-filter-group {
  margin-bottom: 1.5rem;
}

.board-filter-group h2 {
  margin: 0 0 0.5rem;
}

.board-filter-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.35rem 0.25rem;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
}

.board-filter-row:hover,
.board-filter-row.is-active {
  background: var(--bg-hover);
}

.board-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.board-dot--inline {
  display: inline-block;
  margin-left: 0.5rem;
}

.board-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: 0 0 auto;
}

.board-filter-label {
  flex: 1;
  font-size: 0.85rem;
}

.board-filter-count {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.board-main {
  flex: 1;
  padding: 1.5rem 2rem;
  min-width: 0;
}

.board-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.board-header h1 {
  margin: 0.15rem 0 0;
  font-size: 1.5rem;
}

.board-header-count {
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 1rem;
}

.board-new-job-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: var(--radius);
  background: var(--fase-4);
  color: var(--text-inverse);
  cursor: pointer;
}

.board-new-job-form {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 1rem;
}

.board-new-job-form input {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.board-error {
  color: var(--farol-travado);
}

.board-stuck-banner {
  background: var(--farol-travado-bg);
  border: 1px solid var(--farol-travado);
  border-radius: var(--radius);
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
}

.board-stuck-title {
  margin: 0 0 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  color: var(--farol-travado);
  font-weight: 600;
}

.board-stuck-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.board-stuck-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.board-stuck-job {
  display: flex;
  gap: 0.75rem;
  text-decoration: none;
  color: var(--text-primary);
}

.board-stuck-name {
  font-weight: 600;
}

.board-stuck-days {
  color: var(--text-secondary);
}

.board-stuck-person {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.board-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.board-stat-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.85rem 1rem;
}

.board-stat-value {
  margin: 0.25rem 0 0;
  font-family: var(--font-mono);
  font-size: 1.4rem;
  font-weight: 600;
}

.board-stat-value span {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-secondary);
  font-family: var(--font-heading);
}

.board-stat-value--warn {
  color: var(--farol-atencao);
}

.board-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.board-table th {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-secondary);
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.board-table td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.board-mini-bar {
  display: flex;
  gap: 2px;
  width: 60px;
}

.board-mini-segment {
  height: 8px;
  flex: 1;
  border-radius: 1px;
}

.board-job-link {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: var(--text-primary);
}

.board-job-name {
  font-weight: 600;
}

.board-job-phase {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
}

.board-job-next {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.board-bola-tag {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  border-left: 3px solid var(--fase-4);
}

.board-bola-tag--cliente {
  border-left-color: var(--farol-atencao);
}

.board-timeline {
  width: 140px;
}

.board-timeline-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--border);
}

.board-timeline-ilha {
  background: var(--fase-4);
}

.board-timeline-cliente {
  background: var(--farol-atencao);
}

.board-timeline-labels {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--text-secondary);
  margin-top: 0.2rem;
}
```

- [ ] **Step 3: Rewrite `web/test/Board.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Board } from '../src/pages/Board';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      listJobs: vi.fn(),
      createJob: vi.fn(),
      getReference: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const twoPhases = [
  { id: 1, order: 1, name: 'Comercial e Orçamento', roles: ['Comercial'], statuses: [] },
  { id: 2, order: 2, name: 'Dotação e Burocracia', roles: ['Financeiro'], statuses: [] },
];

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
    bolaCom: 'ilha' as const,
    lastWhatsappActivityAt: null,
    actionRequired: null,
    triggerLabel: 'Avançar para: Briefing Recebido',
    bolaComDayCounts: { ilhaDays: 1, clienteDays: 0, currentSide: 'ilha' as const, currentStreakDays: 1 },
    ...overrides,
  };
}

function renderBoard() {
  return render(
    <MemoryRouter>
      <Board />
    </MemoryRouter>,
  );
}

describe('Board', () => {
  beforeEach(() => {
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.getReference.mockResolvedValue({ phases: twoPhases });
  });

  it('shows a fase filter row per phase and no jobs when empty', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    renderBoard();

    expect(await screen.findByText('Comercial e Orçamento')).toBeInTheDocument();
    expect(await screen.findByText('Dotação e Burocracia')).toBeInTheDocument();
  });

  it('lists a job in the table with its name, phase, and bola-com tag', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob()] });

    renderBoard();

    expect(await screen.findByText(/Colgate - Color Correct Wave 2/)).toBeInTheDocument();
    expect(await screen.findByText(/Comercial e Orçamento/)).toBeInTheDocument();
    expect(await screen.findByText('Anne')).toBeInTheDocument();
  });

  it('creates a job via the new-job form and refreshes the board', async () => {
    mockedApi.listJobs.mockResolvedValueOnce({ jobs: [] }).mockResolvedValueOnce({ jobs: [makeJob({ name: 'Novo job', client: null, highlightedPersonName: null })] });
    mockedApi.createJob.mockResolvedValue({ job: makeJob({ name: 'Novo job' }) });

    const user = userEvent.setup();
    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    await user.click(screen.getByRole('button', { name: '+ Novo job' }));
    await user.type(screen.getByLabelText('Nome do job'), 'Novo job');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job' }));
    expect(await screen.findByText(/Novo job/)).toBeInTheDocument();
  });

  it('does not show a completed job on the board', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ name: 'Job Concluído Teste', completedAt: '2026-08-18T00:00:00.000Z' })] });

    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    expect(screen.queryByText('Job Concluído Teste')).not.toBeInTheDocument();
  });

  it('shows a stuck-jobs banner for jobs with a red alertLevel', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [makeJob({ alertLevel: 'red', bolaCom: 'cliente', bolaComDayCounts: { ilhaDays: 2, clienteDays: 9, currentSide: 'cliente', currentStreakDays: 9 } })],
    });

    renderBoard();

    expect(await screen.findByText(/JOB TRAVADO/)).toBeInTheDocument();
    expect(await screen.findByText(/9 dias parado com o cliente/)).toBeInTheDocument();
  });

  it('filters the table when a fase filter row is clicked', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [makeJob({ id: 1, name: 'Job Fase 1' }), makeJob({ id: 2, name: 'Job Fase 2', phaseId: 2, phaseName: 'Dotação e Burocracia' })],
    });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Job Fase 1');
    await screen.findByText('Job Fase 2');

    await user.click(screen.getByText('Dotação e Burocracia'));

    expect(screen.queryByText('Job Fase 1')).not.toBeInTheDocument();
    expect(screen.getByText('Job Fase 2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the frontend suite and build**

Run: `cd web && npm test`
Expected: `Board.test.tsx` passes fully; other test files may still be red if they weren't updated yet (expected until Task 5 finishes `JobDetail.test.tsx`).

Run: `cd web && npx tsc -b`
Expected: no type errors in `Board.tsx`, `Board.css` is not type-checked. If `JobDetail.test.tsx` still fails to compile (expected per Task 3's note), that's fine here.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Board.tsx web/src/pages/Board.css web/test/Board.test.tsx
git commit -m "feat(web): redesign Board as the Torre de Controle dashboard"
```

---

### Task 5: Job Detail redesign

**Files:**
- Modify: `web/src/pages/JobDetail.tsx` (full rewrite)
- Create: `web/src/pages/JobDetail.css`
- Modify: `web/test/JobDetail.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `api.getJob`, `api.getReference`, `api.listPeople`, `api.assignRole` (existing); `api.setBolaCom`, `api.setLastActivity`, `api.classifyJob`, `api.setJobStatus` (Task 3); `phaseColor` (Task 2).
- Produces: nothing consumed by a later task (leaf page).

**Design decisions this task makes (disclosed simplifications, not blocking):**
- Stays a full page at `/jobs/:id` (not a shared-state overlay drawn over `Board`) — styled to read as a right-aligned panel via a max-width content column, but it is a real route navigation, not an in-place drawer. Revisiting this into a true overlay is a larger routing change and can be a follow-up if the difference matters once you see it live.
- The old "Mudar status manualmente" `<select>` and the single "Avançar para: X" trigger button are both removed — every checklist item (in every phase, not just the current one) is now directly clickable and calls the same `setJobStatus` the old dropdown used, so no capability is lost, it's presented as the checklist instead.
- "Grupo sem movimento há Xh" only renders when `lastWhatsappActivityAt` is set; a small control lets you set/clear it manually (no live WhatsApp connection exists yet).

- [ ] **Step 1: Rewrite `web/src/pages/JobDetail.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type ClassifySuggestion,
  type JobDetail as JobDetailType,
  type Phase,
  type Person,
} from '../api/client';
import { phaseColor } from '../theme/phase';
import './JobDetail.css';

function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);

  const [job, setJob] = useState<JobDetailType | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhaseId, setExpandedPhaseId] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [suggestions, setSuggestions] = useState<ClassifySuggestion[] | null>(null);
  const [classifying, setClassifying] = useState(false);

  async function refresh() {
    const [jobRes, referenceRes, peopleRes] = await Promise.all([
      api.getJob(jobId),
      api.getReference(),
      api.listPeople(),
    ]);
    setJob(jobRes.job);
    setPhases(referenceRes.phases);
    setPeople(peopleRes.people);
    setExpandedPhaseId((current) => current ?? jobRes.job.phaseId);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar o job.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const currentPhaseOrder = useMemo(
    () => phases.find((p) => p.id === job?.phaseId)?.order ?? 0,
    [phases, job],
  );

  async function handleStatusClick(statusId: number) {
    if (!job || statusId === job.statusId) return;
    setError(null);
    try {
      await api.setJobStatus(jobId, statusId);
      await refresh();
    } catch {
      setError('Não foi possível mudar o status.');
    }
  }

  async function handleBolaComToggle(side: 'ilha' | 'cliente') {
    if (!job || side === job.bolaCom) return;
    setError(null);
    try {
      await api.setBolaCom(jobId, side);
      await refresh();
    } catch {
      setError('Não foi possível trocar a bola.');
    }
  }

  async function handleSetLastActivityNow() {
    setError(null);
    try {
      await api.setLastActivity(jobId, new Date().toISOString());
      await refresh();
    } catch {
      setError('Não foi possível atualizar a última atividade.');
    }
  }

  async function handleClearLastActivity() {
    setError(null);
    try {
      await api.setLastActivity(jobId, null);
      await refresh();
    } catch {
      setError('Não foi possível limpar a última atividade.');
    }
  }

  async function handleAssignRole(area: string, personId: number | null) {
    setError(null);
    try {
      await api.assignRole(jobId, area, personId);
      await refresh();
    } catch {
      setError('Não foi possível atribuir a pessoa a esse papel.');
    }
  }

  async function handleClassify() {
    if (!pasteText.trim()) return;
    setError(null);
    setClassifying(true);
    try {
      const res = await api.classifyJob(jobId, pasteText);
      setSuggestions(res.suggestions);
      setPasteText('');
      await refresh();
    } catch {
      setError('Não foi possível analisar o texto colado.');
    } finally {
      setClassifying(false);
    }
  }

  async function handleApplySuggestion(suggestion: ClassifySuggestion) {
    setError(null);
    try {
      if (suggestion.tipo === 'bola_com' && (suggestion.valor === 'ilha' || suggestion.valor === 'cliente')) {
        await api.setBolaCom(jobId, suggestion.valor);
      } else {
        const target = phases.flatMap((p) => p.statuses).find((s) => s.name === suggestion.valor);
        if (target) await api.setJobStatus(jobId, target.id);
      }
      setSuggestions((prev) => prev?.filter((s) => s !== suggestion) ?? null);
      await refresh();
    } catch {
      setError('Não foi possível aplicar a sugestão.');
    }
  }

  function dismissSuggestion(suggestion: ClassifySuggestion) {
    setSuggestions((prev) => prev?.filter((s) => s !== suggestion) ?? null);
  }

  const peopleByArea = (area: string) => people.filter((p) => p.area === area && p.active);

  if (!job) {
    return error ? (
      <p role="alert">{error}</p>
    ) : (
      <p>Carregando...</p>
    );
  }

  const counts = job.bolaComDayCounts;
  const isStuck = job.alertLevel !== 'green';
  const pendingSuggestions = suggestions?.filter((s) => s.outcome === 'pendente') ?? [];
  const appliedSuggestions = suggestions?.filter((s) => s.outcome === 'auto_aplicado') ?? [];

  const currentStatusOrder =
    phases.find((p) => p.id === job.phaseId)?.statuses.find((s) => s.id === job.statusId)?.order ?? 0;

  return (
    <div className="job-detail-page">
      <div className="job-detail-panel">
        <div className="job-detail-header">
          <div>
            <p className="label-caps">
              {job.client ?? 'Sem cliente'} · {job.code ?? `J${job.id}`}
            </p>
            <h1>{job.name}</h1>
            <p className="job-detail-phase" style={{ color: phaseColor(currentPhaseOrder) }}>
              FASE {currentPhaseOrder} · {job.phaseName?.toUpperCase()}
            </p>
          </div>
          <Link to="/" className="job-detail-close" aria-label="Fechar">
            ×
          </Link>
        </div>

        {isStuck && counts && (
          <p className="job-detail-warning job-detail-warning--red">
            {counts.currentStreakDays} dias parado com {job.bolaCom === 'cliente' ? 'o cliente' : 'a Ilha'}
          </p>
        )}

        {job.lastWhatsappActivityAt && (
          <p className="job-detail-warning job-detail-warning--amber">
            Grupo sem movimento há {hoursSince(job.lastWhatsappActivityAt)}h{' '}
            <button type="button" className="job-detail-link-btn" onClick={handleClearLastActivity}>
              limpar
            </button>
          </p>
        )}
        {!job.lastWhatsappActivityAt && (
          <button type="button" className="job-detail-link-btn" onClick={handleSetLastActivityNow}>
            Marcar atividade do grupo agora
          </button>
        )}

        {error && (
          <p role="alert" className="job-detail-error">
            {error}
          </p>
        )}

        {counts && (
          <div className="job-detail-bola-toggle">
            <button
              type="button"
              className={`job-detail-bola-btn${job.bolaCom === 'ilha' ? ' is-active' : ''}`}
              onClick={() => handleBolaComToggle('ilha')}
            >
              Bola com a Ilha · {counts.ilhaDays}d
            </button>
            <button
              type="button"
              className={`job-detail-bola-btn job-detail-bola-btn--cliente${job.bolaCom === 'cliente' ? ' is-active' : ''}`}
              onClick={() => handleBolaComToggle('cliente')}
            >
              Bola com o cliente · {counts.clienteDays}d
            </button>
          </div>
        )}

        <div className="job-detail-paste">
          <label htmlFor="paste-text" className="label-caps">
            Colar mensagens do WhatsApp
          </label>
          <textarea
            id="paste-text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder="Cole aqui o texto da conversa do grupo..."
          />
          <button type="button" onClick={() => void handleClassify()} disabled={classifying || !pasteText.trim()}>
            {classifying ? 'Analisando...' : 'Analisar com IA'}
          </button>

          {appliedSuggestions.length > 0 && (
            <ul className="job-detail-suggestions job-detail-suggestions--applied">
              {appliedSuggestions.map((s, i) => (
                <li key={i}>
                  <span className="job-detail-suggestion-badge">aplicado pela IA</span> {s.valor}
                </li>
              ))}
            </ul>
          )}

          {pendingSuggestions.length > 0 && (
            <ul className="job-detail-suggestions">
              {pendingSuggestions.map((s, i) => (
                <li key={i}>
                  <span>{s.valor}</span>
                  <button type="button" onClick={() => void handleApplySuggestion(s)}>
                    Aplicar
                  </button>
                  <button type="button" onClick={() => dismissSuggestion(s)}>
                    Descartar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="job-detail-checklist">
          {phases.map((phase) => {
            const isCurrentPhase = phase.id === job.phaseId;
            const phaseIsPast = phase.order < currentPhaseOrder;
            const isExpanded = expandedPhaseId === phase.id;
            const itemsDone = isCurrentPhase
              ? phase.statuses.filter((s) => s.order <= currentStatusOrder).length
              : phaseIsPast
                ? phase.statuses.length
                : 0;

            return (
              <section key={phase.id} className="job-detail-phase-block">
                <button
                  type="button"
                  className="job-detail-phase-header"
                  onClick={() => setExpandedPhaseId(isExpanded ? null : phase.id)}
                >
                  <span className="board-swatch" style={{ background: phaseColor(phase.order) }} />
                  <span className="job-detail-phase-name">{phase.name}</span>
                  <span className="job-detail-phase-count">
                    {itemsDone}/{phase.statuses.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className="job-detail-phase-body">
                    {phase.roles.length > 0 && (
                      <p className="label-caps job-detail-phase-roles">{phase.roles.join(' · ')}</p>
                    )}

                    <ul className="job-detail-checklist-items">
                      {phase.statuses.map((status) => {
                        const checked = isCurrentPhase
                          ? status.order <= currentStatusOrder
                          : phaseIsPast;
                        return (
                          <li key={status.id}>
                            <button
                              type="button"
                              className={`job-detail-checklist-item${checked ? ' is-checked' : ''}`}
                              onClick={() => void handleStatusClick(status.id)}
                            >
                              <span className="job-detail-checkbox">{checked ? '✓' : ''}</span>
                              {status.name}
                            </button>
                          </li>
                        );
                      })}
                    </ul>

                    {isCurrentPhase &&
                      phase.roles.map((area) => {
                        const assignment = job.roleAssignments.find((a) => a.area === area);
                        return (
                          <div key={area} className="job-detail-role-row">
                            <span>{area}</span>
                            <select
                              aria-label={area}
                              value={assignment?.personId ?? ''}
                              onChange={(e) =>
                                void handleAssignRole(area, e.target.value ? Number(e.target.value) : null)
                              }
                            >
                              <option value="">(não atribuído)</option>
                              {peopleByArea(area).map((person) => (
                                <option key={person.id} value={person.id}>
                                  {person.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/pages/JobDetail.css`**

```css
.job-detail-page {
  min-height: 100vh;
  background: var(--bg-subtle);
  display: flex;
  justify-content: flex-end;
}

.job-detail-panel {
  width: 100%;
  max-width: 560px;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  min-height: 100vh;
  padding: 1.5rem;
}

.job-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.job-detail-header h1 {
  margin: 0.15rem 0;
  font-size: 1.3rem;
}

.job-detail-phase {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.job-detail-close {
  font-size: 1.5rem;
  line-height: 1;
  color: var(--text-secondary);
  text-decoration: none;
  padding: 0.25rem;
}

.job-detail-warning {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
}

.job-detail-warning--red {
  color: var(--farol-travado);
  font-weight: 600;
}

.job-detail-warning--amber {
  color: var(--farol-atencao);
}

.job-detail-link-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  font-size: 0.8rem;
  margin-top: 0.5rem;
}

.job-detail-error {
  color: var(--farol-travado);
}

.job-detail-bola-toggle {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}

.job-detail-bola-btn {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
  cursor: pointer;
}

.job-detail-bola-btn.is-active {
  background: var(--fase-4);
  color: var(--text-inverse);
  border-color: var(--fase-4);
}

.job-detail-bola-btn--cliente.is-active {
  background: var(--farol-atencao);
  border-color: var(--farol-atencao);
}

.job-detail-paste {
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 1rem 0;
  margin: 1rem 0;
}

.job-detail-paste textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin: 0.4rem 0;
  resize: vertical;
}

.job-detail-suggestions {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.job-detail-suggestions li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.job-detail-suggestion-badge {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  background: var(--fase-4);
  color: var(--text-inverse);
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-sm);
}

.job-detail-phase-block {
  border-bottom: 1px solid var(--border);
}

.job-detail-phase-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-weight: 600;
}

.job-detail-phase-name {
  flex: 1;
}

.job-detail-phase-count {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 0.8rem;
}

.job-detail-phase-body {
  padding-bottom: 0.75rem;
}

.job-detail-phase-roles {
  margin: 0 0 0.5rem;
}

.job-detail-checklist-items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.job-detail-checklist-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.3rem 0;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  color: var(--text-primary);
}

.job-detail-checklist-item.is-checked {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.job-detail-checkbox {
  width: 16px;
  height: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  flex: 0 0 auto;
}

.job-detail-role-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.4rem;
  font-size: 0.85rem;
}
```

- [ ] **Step 3: Rewrite `web/test/JobDetail.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JobDetailPage } from '../src/pages/JobDetail';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getJob: vi.fn(),
      getReference: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

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

const referencePhases = [
  {
    id: 1,
    order: 1,
    name: 'Comercial e Orçamento',
    roles: ['Comercial', 'Produção Executiva'],
    statuses: [
      { id: 10, phaseId: 1, order: 1, name: 'Prospecção', actionRequired: '', triggerLabel: '', primaryRole: 'Comercial' },
      { id: 11, phaseId: 1, order: 2, name: 'Briefing Recebido', actionRequired: '', triggerLabel: '', primaryRole: 'Comercial' },
    ],
  },
];

function renderJobDetail() {
  return render(
    <MemoryRouter initialEntries={['/jobs/1']}>
      <Routes>
        <Route path="/jobs/:id" element={<JobDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobDetailPage', () => {
  beforeEach(() => {
    mockedApi.getJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();

    mockedApi.getJob.mockResolvedValue({ job: jobDetail });
    mockedApi.getReference.mockResolvedValue({ phases: referencePhases });
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 5, name: 'Anne', area: 'Comercial', active: true },
        { id: 6, name: 'Adriano', area: 'Produção Executiva', active: true },
      ],
    });
  });

  it('shows the job name, phase, and checklist for the current phase', async () => {
    renderJobDetail();

    expect(await screen.findByText('Colgate - Color Correct Wave 2')).toBeInTheDocument();
    expect(await screen.findByText(/FASE 1/)).toBeInTheDocument();
    expect(await screen.findByText('1/2')).toBeInTheDocument();
  });

  it('advances the status when an unchecked checklist item is clicked', async () => {
    mockedApi.setJobStatus.mockResolvedValue({ job: { ...jobDetail, statusId: 11 } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('Briefing Recebido'));

    await waitFor(() => expect(mockedApi.setJobStatus).toHaveBeenCalledWith(1, 11));
  });

  it('shows the role assignment dropdowns for the current phase', async () => {
    renderJobDetail();

    expect(await screen.findByLabelText('Comercial')).toBeInTheDocument();
    expect(await screen.findByLabelText('Produção Executiva')).toBeInTheDocument();
  });

  it('toggles bola-com when a toggle button is clicked', async () => {
    mockedApi.setBolaCom.mockResolvedValue({
      job: { ...jobDetail, bolaCom: 'cliente' },
      bolaComDayCounts: { ilhaDays: 3, clienteDays: 0, currentSide: 'cliente', currentStreakDays: 0 },
    });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText(/Bola com o cliente/));

    await waitFor(() => expect(mockedApi.setBolaCom).toHaveBeenCalledWith(1, 'cliente'));
  });

  it('shows the stuck warning only when alertLevel is not green', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, alertLevel: 'red' } });

    renderJobDetail();

    expect(await screen.findByText(/dias parado com a Ilha/)).toBeInTheDocument();
  });

  it('does not show the WhatsApp inactivity line when lastWhatsappActivityAt is null', async () => {
    renderJobDetail();

    await screen.findByText('Colgate - Color Correct Wave 2');
    expect(screen.queryByText(/Grupo sem movimento/)).not.toBeInTheDocument();
  });

  it('shows the WhatsApp inactivity line when lastWhatsappActivityAt is set', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, lastWhatsappActivityAt: twoHoursAgo } });

    renderJobDetail();

    expect(await screen.findByText(/Grupo sem movimento há/)).toBeInTheDocument();
  });

  it('classifies pasted text and shows suggestions', async () => {
    mockedApi.classifyJob.mockResolvedValue({
      suggestions: [
        { tipo: 'checklist_item', valor: 'Briefing Recebido', confidence: 0.7, evidencia: 'texto', outcome: 'pendente' },
      ],
    });
    const user = userEvent.setup();

    renderJobDetail();

    await user.type(await screen.findByLabelText('Colar mensagens do WhatsApp'), 'Briefing recebido ontem');
    await user.click(screen.getByRole('button', { name: 'Analisar com IA' }));

    await waitFor(() => expect(mockedApi.classifyJob).toHaveBeenCalledWith(1, 'Briefing recebido ontem'));
    expect(await screen.findByRole('button', { name: 'Aplicar' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the frontend suite and build**

Run: `cd web && npm test`
Expected: all test files pass now (`Board.test.tsx`, `JobDetail.test.tsx`, plus `Users.test.tsx`/`Login.test.tsx`/`AuthContext.test.tsx`/`api.client.test.ts` which this task didn't touch and should be unaffected).

Run: `cd web && npm run build`
Expected: `tsc -b && vite build` compiles cleanly with no errors anywhere in `web/`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/JobDetail.tsx web/src/pages/JobDetail.css web/test/JobDetail.test.tsx
git commit -m "feat(web): redesign JobDetail with per-phase checklist, bola-com toggle, and AI paste panel"
```

---

### Task 6: Visual pass on Users, Login, and the app shell

**Files:**
- Modify: `web/src/pages/Users.tsx`
- Create: `web/src/pages/Users.css`
- Modify: `web/src/pages/Login.tsx`
- Create: `web/src/pages/Login.css`
- Modify: `web/src/App.tsx`
- Create: `web/src/App.css`

**Interfaces:**
- Consumes: design tokens (Task 2). No API/type changes — this task is styling-only, structure stays functionally identical to what exists today.

- [ ] **Step 1: Restyle `web/src/App.tsx`'s authenticated shell**

Replace the `RequireAuth` function's JSX (keep all its logic identical, only change the JSX/className) to:

```tsx
function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <p className="app-loading">Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header-email">{user.email}</span>
        <nav className="app-nav">
          {user.role === 'admin' && (
            <Link to="/usuarios" className="app-nav-link">
              Usuários
            </Link>
          )}
          <button type="button" className="app-logout-btn" onClick={() => void logout()}>
            Sair
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}
```

Add the import at the top of the file, after the existing imports:

```typescript
import './App.css';
```

- [ ] **Step 2: Create `web/src/App.css`**

```css
.app-loading {
  padding: 2rem;
  font-family: var(--font-heading);
  color: var(--text-secondary);
}

.app-shell {
  min-height: 100vh;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 1.5rem;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}

.app-header-email {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.app-nav {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.app-nav-link {
  text-decoration: none;
  color: var(--text-primary);
  font-size: 0.85rem;
}

.app-logout-btn {
  border: 1px solid var(--border);
  background: var(--bg-panel);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.75rem;
  cursor: pointer;
  font-size: 0.85rem;
}
```

- [ ] **Step 3: Restyle `web/src/pages/Login.tsx`**

Replace the returned JSX (keep `handleCredential` and all logic identical):

```tsx
  return (
    <div className="login-page">
      <div className="login-card">
        <p className="label-caps">Ilha Crossmídia</p>
        <h1>Torre de Controle</h1>
        <p className="login-subtitle">Acompanhamento de Jobs — entre com sua conta @ilhacrossmidia.com.br</p>
        <GoogleLogin
          onSuccess={(credentialResponse) => {
            if (credentialResponse.credential) {
              void handleCredential(credentialResponse.credential);
            }
          }}
          onError={() => setError('Falha no login com Google.')}
        />
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
```

Add the import at the top:

```typescript
import './Login.css';
```

- [ ] **Step 4: Create `web/src/pages/Login.css`**

```css
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-subtle);
}

.login-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 2.5rem;
  text-align: center;
  max-width: 380px;
}

.login-card h1 {
  margin: 0.25rem 0 0.75rem;
}

.login-subtitle {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}

.login-error {
  color: var(--farol-travado);
  margin-top: 1rem;
}
```

- [ ] **Step 5: Restyle `web/src/pages/Users.tsx`**

Replace the returned JSX (keep every handler function identical):

```tsx
  return (
    <div className="users-page">
      <h1>Usuários</h1>

      <form onSubmit={handleInvite} className="users-invite-form">
        <div>
          <label htmlFor="invite-email">E-mail</label>
          <input id="invite-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="invite-role">Papel</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit">Convidar</button>
        {error && (
          <p role="alert" className="users-error">
            {error}
          </p>
        )}
      </form>

      <table className="users-table">
        <thead>
          <tr>
            <th>E-mail</th>
            <th>Status</th>
            <th>Papel</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>
                <span className={`users-status-badge users-status-badge--${u.status}`}>{u.status}</span>
              </td>
              <td>
                <select
                  aria-label={`Papel de ${u.email}`}
                  value={u.role}
                  onChange={(e) => void handleRoleChange(u.id, e.target.value as UserRole)}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td>
                {u.status === 'revoked' ? (
                  <button type="button" onClick={() => void handleStatusChange(u.id, 'active')}>
                    Reativar
                  </button>
                ) : (
                  <button type="button" onClick={() => void handleStatusChange(u.id, 'revoked')}>
                    Revogar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
```

Add the import at the top:

```typescript
import './Users.css';
```

- [ ] **Step 6: Create `web/src/pages/Users.css`**

```css
.users-page {
  max-width: 720px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.users-invite-form {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.users-invite-form input,
.users-invite-form select {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.users-error {
  color: var(--farol-travado);
}

.users-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.users-table th,
.users-table td {
  text-align: left;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.users-status-badge {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
}

.users-status-badge--active {
  color: var(--farol-fluindo);
}

.users-status-badge--revoked {
  color: var(--farol-travado);
}

.users-status-badge--invited {
  color: var(--farol-atencao);
}
```

- [ ] **Step 7: Run the full frontend suite, build, and manual smoke check**

Run: `cd web && npm test`
Expected: all test files pass (this task changed no component logic or DOM text/roles the existing `Users.test.tsx`/`Login.test.tsx`/`AuthContext.test.tsx` assert on — only added `className`s and wrapped things in new container elements; if any of those tests query by a DOM structure assumption that broke, fix the test to match, not the component, unless the test was asserting something genuinely wrong).

Run: `cd web && npm run build`
Expected: compiles cleanly.

- [ ] **Step 8: Commit**

```bash
git add web/src/App.tsx web/src/App.css web/src/pages/Login.tsx web/src/pages/Login.css web/src/pages/Users.tsx web/src/pages/Users.css
git commit -m "feat(web): apply design tokens to Users, Login, and the app shell"
```
