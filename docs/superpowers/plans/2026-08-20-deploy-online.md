# Deploy Online (GitHub + Vercel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Torre de Controle" deployable to Vercel as a single project (static frontend + the whole Express backend as one serverless function), without changing any existing route, model, or business logic.

**Architecture:** Extract the environment-variable-reading/app-assembly logic currently inline in `server/src/index.ts` into a shared, testable function. Reuse it from both the existing dev entry point (`app.listen()`, unchanged behavior) and a new Vercel entry point (`server/api/index.ts`) that lazily builds the app once per warm serverless instance and delegates every request to it. Add a `vercel.json` at the repo root that builds `web/` as static output and `server/api/index.ts` as the one backend function, routing `/api/*` to it and everything else to the static build.

**Tech Stack:** Node/Express/TypeScript (`server/`), Vite/React/TypeScript (`web/`), Vercel (`@vercel/node` runtime, `@vercel/static-build`), Vitest/Supertest for tests.

**Spec:** docs/superpowers/specs/2026-08-20-deploy-online-design.md

## Global Constraints

- No existing route, model, or business logic changes — this plan only adds a second way to expose the already-tested `createApp`.
- `server/src/index.ts`'s current behavior (dev server via `app.listen()`, same env vars, same console messages) must be preserved exactly — only its internal structure changes (delegating to the new shared function).
- The new Vercel entry point must build the app **once per warm instance** (module-scope memoized promise), not once per request.
- `vercel.json` routes `/api/*` to the backend function and everything else to `web/`'s static build output (`web/dist`).
- Production DB connection uses the Supabase **transaction pooler (port 6543)**, not the session pooler (port 5432) used in local dev — this is an environment-variable value set at deploy time, not a code change.

---

## Task 1: Extract a shared, testable app-assembly function

**Files:**
- Create: `server/src/createAppFromEnv.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/createAppFromEnv.test.ts`

**Interfaces:**
- Produces: `createAppFromEnv(): Promise<Express>` — reads `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `ALLOWED_EMAIL_DOMAIN`, `FRONTEND_URL`, `ANTHROPIC_API_KEY` from `process.env` (identical defaults/validation to today's `server/src/index.ts`), builds `db`/`verifyIdToken`/`classifier`, and returns the fully-assembled Express app via the existing `createApp` from `server/src/app.ts`. Throws `Error` with the same messages `index.ts` uses today when a required var is missing. Task 2 imports and calls this function from the new Vercel entry point.

- [ ] **Step 1: Write the failing test**

Create `server/test/createAppFromEnv.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppFromEnv } from '../src/createAppFromEnv';

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID'] as const;
type RequiredVar = (typeof REQUIRED_VARS)[number];

describe('createAppFromEnv', () => {
  let saved: Partial<Record<RequiredVar, string | undefined>>;

  beforeEach(() => {
    saved = {};
    for (const key of REQUIRED_VARS) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of REQUIRED_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('builds an Express app when all required env vars are present', async () => {
    const app = await createAppFromEnv();
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  it('throws when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    await expect(createAppFromEnv()).rejects.toThrow('DATABASE_URL environment variable is required');
  });

  it('throws when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    await expect(createAppFromEnv()).rejects.toThrow('JWT_SECRET environment variable is required');
  });

  it('throws when GOOGLE_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(createAppFromEnv()).rejects.toThrow('GOOGLE_CLIENT_ID environment variable is required');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/createAppFromEnv.test.ts`
Expected: FAIL — `Cannot find module '../src/createAppFromEnv'` (the file doesn't exist yet).

- [ ] **Step 3: Create `server/src/createAppFromEnv.ts`**

This is the exact validation/assembly logic already in `server/src/index.ts`, moved into a reusable function — no behavior change, just extraction:

```ts
import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';
import { createAnthropicClassifier } from './services/classifier';
import type { Express } from 'express';

export async function createAppFromEnv(): Promise<Express> {
  const connectionString = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  if (!googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is required');
  }

  const db = await createDb(connectionString);

  return createApp({
    db,
    verifyIdToken: createGoogleVerifier(googleClientId),
    jwtSecret,
    allowedDomain,
    frontendUrl,
    classifier: anthropicApiKey ? createAnthropicClassifier(anthropicApiKey) : undefined,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/createAppFromEnv.test.ts`
Expected: PASS — all 4 tests green. (Needs `server/.env` present with real values, same as every other test in this suite — already the case in this repo.)

- [ ] **Step 5: Rewrite `server/src/index.ts` to use the new function**

Find the entire current content of `server/src/index.ts`:

```ts
import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';
import { createAnthropicClassifier } from './services/classifier';

const port = Number(process.env.PORT ?? 4000);
const connectionString = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
if (!googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required');
}

async function main() {
  const db = await createDb(connectionString!);

  const app = createApp({
    db,
    verifyIdToken: createGoogleVerifier(googleClientId!),
    jwtSecret: jwtSecret!,
    allowedDomain,
    frontendUrl,
    classifier: anthropicApiKey ? createAnthropicClassifier(anthropicApiKey) : undefined,
  });

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    if (!anthropicApiKey) {
      console.warn('ANTHROPIC_API_KEY not set — POST /api/jobs/:id/classify will return 503');
    }
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

Replace it entirely with:

```ts
import { createAppFromEnv } from './createAppFromEnv';

const port = Number(process.env.PORT ?? 4000);

createAppFromEnv()
  .then((app) => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn('ANTHROPIC_API_KEY not set — POST /api/jobs/:id/classify will return 503');
      }
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
```

- [ ] **Step 6: Run the full backend test suite**

Run: `cd server && npm test`
Expected: all tests pass (the pre-existing suite plus the 4 new `createAppFromEnv` tests), no regressions. This step also doubles as manually confirming `npm run dev` still behaves identically — start it once (`npm run dev`), confirm the same `Server listening on port 4000` / `ANTHROPIC_API_KEY not set...` console lines print as before, then stop it.

- [ ] **Step 7: Commit**

```bash
git add server/src/createAppFromEnv.ts server/src/index.ts server/test/createAppFromEnv.test.ts
git commit -m "refactor(server): extract app assembly into a testable, reusable createAppFromEnv"
```

---

## Task 2: Vercel entry point and routing config

**Files:**
- Create: `server/api/index.ts`
- Create: `vercel.json` (repo root)
- Test: `server/test/vercelHandler.test.ts`

**Interfaces:**
- Consumes: `createAppFromEnv(): Promise<Express>` from Task 1.
- Produces: a default-exported Node request handler at `server/api/index.ts`, matching the `(req: IncomingMessage, res: ServerResponse) => Promise<void>` shape Vercel's `@vercel/node` runtime calls directly. Nothing else in this plan consumes it — it's the deployment's actual entry point, exercised for real only once the branch is deployed (see "Deployment Runbook" at the end of this plan, which is not part of the task loop).

- [ ] **Step 1: Write the failing test**

Create `server/test/vercelHandler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import handler from '../api/index';

describe('Vercel handler', () => {
  it('responds to GET /api/health', async () => {
    const res = await request(handler).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reuses the same app instance across multiple invocations (memoized cold start)', async () => {
    await request(handler).get('/api/health');
    const res = await request(handler).get('/api/health');

    expect(res.status).toBe(200);
  });
});
```

(This test intentionally does not tear down the connection pool `createAppFromEnv` opens — the process exits when the test run ends, same as every other test file in this suite that never explicitly closes its pool.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/vercelHandler.test.ts`
Expected: FAIL — `Cannot find module '../api/index'` (the file doesn't exist yet).

- [ ] **Step 3: Create `server/api/index.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'http';
import { createAppFromEnv } from '../src/createAppFromEnv';
import type { Express } from 'express';

let appPromise: Promise<Express> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) {
    appPromise = createAppFromEnv();
  }
  const app = await appPromise;
  app(req, res);
}
```

This file lives outside `server/tsconfig.json`'s `include: ["src"]` on purpose — it's Vercel's build that compiles it (via `@vercel/node`, configured in Step 5 below), not `server`'s own `tsc -b`. Confirm this doesn't break the existing backend build:

Run: `cd server && npm run build`
Expected: succeeds exactly as before (it only compiles `src/`, `api/` is untouched by it) — this is a check, not a step that should require any change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/vercelHandler.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Create `vercel.json` at the repository root**

```json
{
  "version": 2,
  "builds": [
    { "src": "web/package.json", "use": "@vercel/static-build", "config": { "distDir": "dist" } },
    {
      "src": "server/api/index.ts",
      "use": "@vercel/node",
      "config": { "includeFiles": "server/src/db/schema.sql" }
    }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "server/api/index.ts" },
    { "src": "/(.*)", "dest": "web/dist/$1" }
  ]
}
```

This is Vercel's "Multiple Builds" monorepo pattern: the first `builds` entry runs `web/package.json`'s `build` script (`tsc -b && vite build`, unchanged) and publishes `web/dist` as static output; the second builds `server/api/index.ts` as one Node serverless function. `routes` sends anything starting with `/api/` to that function, everything else to the static build — this is what makes the frontend's already-relative `fetch('/api/...')` calls work with no frontend code change (per the spec's "Variáveis de ambiente" section: `VITE_API_BASE_URL` stays unset in production).

The `includeFiles` entry matters and is not optional: `createDb` (`server/src/db/index.ts`) reads `schema.sql` at runtime via `fs.readFileSync(path.join(__dirname, 'schema.sql'))`. `@vercel/node`'s build only bundles what it can statically trace through JS/TS imports — a `.sql` file read via `fs` at runtime is exactly the kind of asset that build tracing misses by default, and the function would fail on its very first cold start in production (`ENOENT`) without this. `server`'s own local `npm run build` script already solves the equivalent problem for traditional deploys by copying `schema.sql` into `dist/db/` after compiling — `includeFiles` is the Vercel-specific way to get the same file present next to the bundled function.

There is no automated test for `vercel.json` itself — it's only exercised by an actual Vercel build, which happens in the Deployment Runbook below, not in this task loop. Confirm it's valid JSON:

Run: `cd "<repo root>" && node -e "JSON.parse(require('fs').readFileSync('vercel.json', 'utf-8')); console.log('valid JSON')"`
Expected: prints `valid JSON`, no syntax errors.

- [ ] **Step 6: Run the full backend test suite one more time**

Run: `cd server && npm test`
Expected: all tests pass (Task 1's suite plus the 2 new `vercelHandler` tests), no regressions.

- [ ] **Step 7: Commit**

```bash
git add server/api/index.ts vercel.json
git commit -m "feat: add Vercel serverless entry point and routing config"
```

---

## Deployment Runbook (not a task-loop task — run directly, not via a dispatched subagent)

These steps provision real external infrastructure (a GitHub repository, a Vercel project, production secrets) — irreversible-ish, side-effect-bearing actions outside this worktree. They are not "implementation" in the TDD sense (there is no code to test-drive), so they don't go through subagent-driven-development's fresh-subagent-per-task loop. Run them directly, in this order, once Tasks 1-2 are merged to `master`:

1. **Create the GitHub repository** (`gh` CLI is already authenticated in this environment as `wordnael-sketch`, `repo` scope):
   ```bash
   gh repo create torre-de-controle --private --source=. --remote=origin-new
   git push origin-new master
   ```
   (Named `origin-new` deliberately, not `origin` — the existing `origin` remote is the old, broken one; renaming/removing it is a separate decision for whoever's driving this step, not assumed here.)

2. **Authorize the Vercel connector** (claude.ai connector settings) if not already done, or create the Vercel project manually via the Vercel dashboard, importing the new GitHub repository.

3. **Set production environment variables** in the Vercel project (values from `server/.env`, except `DATABASE_URL` and `FRONTEND_URL` — see below):
   - `DATABASE_URL` — same as local, but with the port changed from `5432` to `6543` (Supabase transaction pooler, per this plan's Global Constraints).
   - `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `ALLOWED_EMAIL_DOMAIN`, `ANTHROPIC_API_KEY` — same values as `server/.env`.
   - `FRONTEND_URL` — the Vercel deployment's own production URL (known only after the first deploy; update this var and redeploy once it's known).
   - `NODE_ENV=production`.
   - `VITE_GOOGLE_CLIENT_ID` — same value as `web/.env`.
   - `VITE_API_BASE_URL` — leave unset.

4. **Deploy** (push to `master` triggers it automatically once the Vercel project is connected, or trigger manually from the dashboard for the first deploy).

5. **Add the production domain to Google Cloud Console** — the OAuth Client ID's "Authorized JavaScript origins" needs the new Vercel URL added before login will work in production.

6. **Manual verification**: open the deployed URL, confirm login works, confirm the Board loads jobs, confirm creating a job works end-to-end (this exercises the real Postgres connection through the new serverless path for the first time).

---

## Self-review notes

- **Spec coverage**: every section of the spec maps to a task or a runbook step — architecture (Tasks 1-2), env vars (runbook step 3), Google OAuth (runbook step 5), pipeline (runbook step 4), non-goals (deliberately not built: no preview deploys, no custom domain, no split Vercel projects, no per-route functions, no CI).
- **Type consistency**: `createAppFromEnv(): Promise<Express>` is defined once in Task 1 and consumed with that exact signature in Task 2 — no drift.
- **No placeholders**: every step has literal, complete code; the runbook steps that can't be code (creating external resources) have exact commands or exact instructions instead of "configure as needed."
