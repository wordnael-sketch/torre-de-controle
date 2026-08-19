# Fundação (Auth + Jobs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployable skeleton of the Ilha Crossmídia job-tracking system: a backend (API + PostgreSQL via Supabase) with Google-restricted login and basic Job CRUD, and a frontend (React) that logs in and shows the (initially empty) job list.

**Architecture:** Two independent apps in one repo — `server/` (Node.js + Express + TypeScript + PostgreSQL via Supabase, deployed to an always-on host like Railway/Render) and `web/` (React + Vite + TypeScript, deployed to Vercel). They communicate over HTTP with credentials (cookies), across origins, so the backend enables CORS for the frontend's origin and issues cross-site session cookies.

**Tech Stack:** Node.js + Express + TypeScript + PostgreSQL via Supabase (`pg`) (backend) · React + Vite + TypeScript + react-router-dom + @react-oauth/google (frontend) · Vitest + Supertest + Testing Library (tests).

**Spec:** [docs/superpowers/specs/2026-08-18-sistema-acompanhamento-jobs-design.md](../specs/2026-08-18-sistema-acompanhamento-jobs-design.md)

## Global Constraints

- Login via Google OAuth, restrito ao domínio `ilhacrossmidia.com.br`. (spec §3)
- Usuário único: apenas o Gerente de Projeto usa o sistema — sem múltiplos perfis/permissões no MVP. (spec §3)
- Banco de dados: **PostgreSQL gerenciado pelo Supabase** — substitui a decisão original de
  SQLite em disco (spec §4), a pedido do usuário durante a execução do Task 2/3 (ver
  ledger para o histórico completo: `better-sqlite3` → `node:sqlite` → Postgres/Supabase).
  Conexão via `pg` (node-postgres) usando a *session pooler connection string* do projeto
  (porta 5432, host `aws-0-<região>.pooler.supabase.com`) — a conexão direta
  (`db.<ref>.supabase.co`) exige IPv6, indisponível nesta rede. String de conexão em
  `DATABASE_URL` (variável de ambiente, nunca commitada). Todo o acesso ao banco é
  assíncrono (Promises) — isso muda a assinatura de toda função que toca o banco em
  relação ao design original síncrono do SQLite (ver Tasks 2-4, 7, 8 abaixo).
- O processo do backend deve rodar "always-on" (sem scale-to-zero) — hospedagem separada do frontend, que vai para o Vercel. (decisão de hospedagem tomada nesta sessão, complementa spec §4)
- Frontend (Vercel) e backend (host always-on) ficam em origens diferentes: o backend precisa de CORS restrito à origem do frontend e cookies de sessão cross-site (`SameSite=None; Secure` em produção).
- **Testes que tocam o banco rodam contra o projeto Supabase real** (não há Docker
  disponível neste ambiente para um Postgres local) — cada teste roda dentro de uma
  transação (`BEGIN` ... `ROLLBACK`) via `server/test/helpers/testDb.ts`, então nada
  escrito por um teste persiste, mesmo compartilhando o banco com dados reais de
  desenvolvimento. Testes que listam/agregam dados (ex: `listJobs`) devem verificar
  posições/relações relativas entre os registros que o próprio teste criou, nunca o
  tamanho absoluto do resultado — o banco pode ter outras linhas reais.
- *(Histórico, não mais válido)* Rulings anteriores sobre `node:sqlite`/`better-sqlite3`
  e a versão do `vitest` (registradas no ledger) foram supersedidas pela mudança para
  Postgres/Supabase acima. `vitest ^4.1.11` continua sendo usado no backend (não é
  regressão — não há motivo para voltar à 2.x).

---

## Task 1: Backend scaffold + health check

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `.gitignore` (repo root)
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Test: `server/test/app.health.test.ts`

**Interfaces:**
- Produces: `createApp(): Express` — extended with a `deps` parameter in Task 7; this task's version takes no arguments.

- [ ] **Step 1: Create the repo-root `.gitignore`**

```gitignore
node_modules/
dist/
build/
.env
*.db
*.db-journal
*.db-wal
*.db-shm
data/
```

- [ ] **Step 2: Create `server/package.json`**

```json
{
  "name": "gerente-de-projeto-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "google-auth-library": "^9.14.1",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.5.0",
    "@types/pg": "^8.11.10",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^4.1.11"
  }
}
```

> **Note (rulings recorded during Task 1/2/3 execution):** this snippet reflects the full
> history of rulings — see the SDD ledger for each in full:
> 1. `node:sqlite` instead of `better-sqlite3` (superseded by #3 below).
> 2. `vitest` bumped from `^2.0.5` to `^4.1.11` to resolve `node:sqlite` (kept — no
>    reason to revert now that Postgres doesn't use `node:sqlite` either).
> 3. **Final decision: PostgreSQL via Supabase, using `pg`** — the user asked to switch
>    to Supabase mid-execution. This drops `node:sqlite`/`better-sqlite3` entirely (no
>    native compilation, no Node-version floor tied to a DB driver — `engines.node` was
>    removed since nothing in this snippet requires a specific Node version anymore) and
>    adds `pg` + `@types/pg`. It also makes every DB-touching function async — the
>    biggest structural change, rippling through Tasks 2, 3, 4, 7, 8 below.

- [ ] **Step 3: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Install dependencies**

Run (inside `server/`): `npm install`

- [ ] **Step 5: Write the failing test**

`server/test/app.health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/app.ts` does not exist yet.

- [ ] **Step 7: Implement `server/src/app.ts`**

```ts
import express, { Express } from 'express';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
```

- [ ] **Step 8: Implement `server/src/index.ts`**

```ts
import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add .gitignore server/package.json server/tsconfig.json server/src/app.ts server/src/index.ts server/test/app.health.test.ts
git commit -m "feat(server): scaffold Express app with health check"
```

---

## Task 2: Postgres DB module + schema + test transaction helper

**Files:**
- Create: `server/src/db/schema.sql`
- Create: `server/src/db/index.ts`
- Create: `server/test/helpers/testDb.ts`
- Test: `server/test/db.test.ts`

**Interfaces:**
- Produces: `export interface AppDatabase { query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> }` (satisfied structurally by both `pg`'s `Pool` and `PoolClient`), `createDb(connectionString: string): Promise<Pool>`, `getTestPool(): Pool`, `withTestTransaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T>`

Uses `pg` (node-postgres) against a Supabase-hosted PostgreSQL database — not
`node:sqlite`/`better-sqlite3` (see the Global Constraints ruling above). The connection
string lives in the `DATABASE_URL` environment variable (never committed — already in
`.gitignore` via the `.env` pattern). `createDb` is `async`: it opens a connection pool
and applies the schema (idempotent, `CREATE TABLE IF NOT EXISTS`) before returning it —
every caller must `await` it.

**Why a transaction helper is part of this task:** there is no Docker available in this
environment to run a local Postgres for tests, so tests run against the real Supabase
project (see Global Constraints). `withTestTransaction` wraps a test in `BEGIN` /
`ROLLBACK` on a dedicated client so nothing the test writes ever persists. Tasks 3 and 4
(and later 7, 8) depend on this helper for their own tests.

- [ ] **Step 1: Create `server/.env`** (not committed — already covered by `.gitignore`'s
  `.env` pattern)

```
DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Use the Supabase project's **session pooler** connection string (Project Settings →
Database → Connection string → mode "Session", port 5432) — not the direct
`db.<ref>.supabase.co` host, which requires IPv6 and is not reachable from this network.
URL-encode any special characters in the password (e.g. `@` → `%40`).

- [ ] **Step 2: Write the failing test**

`server/test/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db';

describe('createDb', () => {
  it('creates the users and jobs tables', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required to run this test');
    }

    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('jobs', 'users')
         ORDER BY table_name`,
      );

      expect(result.rows.map((r) => r.table_name)).toEqual(['jobs', 'users']);
    } finally {
      await db.end();
    }
  });
});
```

Note: `db.end()` closes the pool's connections — call it whenever a test (or script)
creates its own pool via `createDb`, to avoid leaving open connections that make vitest
hang after the test run.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test` (inside `server/`, with `.env` from Step 1 in place)
Expected: FAIL — `src/db/index.ts` does not exist yet.

- [ ] **Step 4: Create `server/src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  client TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`id` is `INTEGER` (32-bit), not `BIGINT` — `pg` returns `BIGINT` columns as strings (to
avoid silent precision loss in JS numbers), which would silently break the `id: number`
contract every model in this plan relies on. `INTEGER` is returned as a native JS number
and comfortably covers this app's scale.

- [ ] **Step 5: Implement `server/src/db/index.ts`**

```ts
import { Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

export interface AppDatabase {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export async function createDb(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);

  return pool;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 7: Implement `server/test/helpers/testDb.ts`**

```ts
import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

let pool: Pool | undefined;

function getTestPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required to run tests');
    }
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

export async function withTestTransaction<T>(
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getTestPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
```

No test file for this step — it's exercised indirectly by every test in Tasks 3, 4, 7,
8 that uses `withTestTransaction`. Verify it works by running Task 3's tests once that
task is implemented (a later task, not this one).

- [ ] **Step 8: Commit**

```bash
git add server/src/db server/test/db.test.ts server/test/helpers/testDb.ts
git commit -m "feat(server): add Postgres connection module and test transaction helper"
```

Do **not** commit `server/.env` — confirm `git status` shows it untracked/ignored before
committing.

---

## Task 3: Job model

**Files:**
- Create: `server/src/models/job.ts`
- Test: `server/test/models.job.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` from `../db`, `withTestTransaction` from `./helpers/testDb` (Task 2)
- Produces: `export interface Job { id: number; name: string; code: string | null; client: string | null; createdAt: string; updatedAt: string; }`, `listJobs(db: AppDatabase): Promise<Job[]>`, `createJob(db: AppDatabase, input: { name: string; code?: string; client?: string }): Promise<Job>`

Both functions are `async` — every DB call goes over the network to Supabase. Tests run
each case inside `withTestTransaction` (Task 2) so nothing written persists; the
"ordered by newest first" test checks the created jobs' *relative* order rather than an
absolute list length, because the shared Supabase project may already contain other rows
(see Global Constraints).

- [ ] **Step 1: Write the failing test**

`server/test/models.job.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createJob, listJobs } from '../src/models/job';
import { withTestTransaction } from './helpers/testDb';

describe('job model', () => {
  it('creates a job and returns it with generated fields', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, {
        name: 'Colgate - Color Correct Wave 2',
        code: '0307-2026',
        client: 'Colgate',
      });

      expect(job.id).toBeGreaterThan(0);
      expect(job.name).toBe('Colgate - Color Correct Wave 2');
      expect(job.code).toBe('0307-2026');
      expect(job.client).toBe('Colgate');
      expect(job.createdAt).toBeTruthy();
    });
  });

  it('creates a job without optional fields', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job sem codigo' });

      expect(job.code).toBeNull();
      expect(job.client).toBeNull();
    });
  });

  it('lists jobs ordered by newest first', async () => {
    await withTestTransaction(async (db) => {
      await createJob(db, { name: 'Primeiro job (ordering test)' });
      await createJob(db, { name: 'Segundo job (ordering test)' });

      const jobs = await listJobs(db);
      const names = jobs.map((j) => j.name);
      const indexSegundo = names.indexOf('Segundo job (ordering test)');
      const indexPrimeiro = names.indexOf('Primeiro job (ordering test)');

      expect(indexSegundo).toBeGreaterThanOrEqual(0);
      expect(indexPrimeiro).toBeGreaterThanOrEqual(0);
      expect(indexSegundo).toBeLessThan(indexPrimeiro);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/models/job.ts` does not exist yet.

- [ ] **Step 3: Implement `server/src/models/job.ts`**

```ts
import type { AppDatabase } from '../db';

export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobRow {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    client: row.client,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listJobs(db: AppDatabase): Promise<Job[]> {
  const result = await db.query<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC, id DESC');
  return result.rows.map(toJob);
}

export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Promise<Job> {
  const result = await db.query<JobRow>(
    'INSERT INTO jobs (name, code, client) VALUES ($1, $2, $3) RETURNING *',
    [input.name, input.code ?? null, input.client ?? null],
  );

  return toJob(result.rows[0]);
}
```

`created_at`/`updated_at` are typed `string | Date` because `pg` returns `TIMESTAMPTZ`
columns as JS `Date` objects by default — `new Date(row.created_at).toISOString()`
normalizes either shape to an ISO string, matching the `Job.createdAt: string` contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/models/job.ts server/test/models.job.test.ts
git commit -m "feat(server): add job model with create and list"
```

---

## Task 4: User model

**Files:**
- Create: `server/src/models/user.ts`
- Test: `server/test/models.user.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` from `../db`, `withTestTransaction` from `./helpers/testDb` (Task 2)
- Produces: `export interface User { id: number; googleSub: string; email: string; name: string; createdAt: string; }`, `findOrCreateUser(db: AppDatabase, input: { googleSub: string; email: string; name: string }): Promise<User>`, `getUserById(db: AppDatabase, id: number): Promise<User | null>`

Both functions are `async`, same reasoning as Task 3. `getUserById`'s "not found" test
uses `-1` rather than a positive sentinel like `999` — `-1` can never be produced by an
`INTEGER GENERATED ALWAYS AS IDENTITY` column, so the test can't collide with real data
in the shared Supabase project.

- [ ] **Step 1: Write the failing test**

`server/test/models.user.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findOrCreateUser, getUserById } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

describe('findOrCreateUser', () => {
  it('creates a new user on first call', async () => {
    await withTestTransaction(async (db) => {
      const user = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });

      expect(user.id).toBeGreaterThan(0);
      expect(user.email).toBe('wilka@ilhacrossmidia.com.br');
    });
  });

  it('returns the same user on subsequent calls with the same googleSub', async () => {
    await withTestTransaction(async (db) => {
      const first = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });
      const second = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });

      expect(second.id).toBe(first.id);
    });
  });
});

describe('getUserById', () => {
  it('returns the user matching the id', async () => {
    await withTestTransaction(async (db) => {
      const created = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });

      const found = await getUserById(db, created.id);

      expect(found).toEqual(created);
    });
  });

  it('returns null when no user matches the id', async () => {
    await withTestTransaction(async (db) => {
      expect(await getUserById(db, -1)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/models/user.ts` does not exist yet.

- [ ] **Step 3: Implement `server/src/models/user.ts`**

```ts
import type { AppDatabase } from '../db';

export interface User {
  id: number;
  googleSub: string;
  email: string;
  name: string;
  createdAt: string;
}

interface UserRow {
  id: number;
  google_sub: string;
  email: string;
  name: string;
  created_at: string | Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function findOrCreateUser(
  db: AppDatabase,
  input: { googleSub: string; email: string; name: string },
): Promise<User> {
  const existing = await db.query<UserRow>('SELECT * FROM users WHERE google_sub = $1', [
    input.googleSub,
  ]);

  if (existing.rows[0]) {
    return toUser(existing.rows[0]);
  }

  const inserted = await db.query<UserRow>(
    'INSERT INTO users (google_sub, email, name) VALUES ($1, $2, $3) RETURNING *',
    [input.googleSub, input.email, input.name],
  );

  return toUser(inserted.rows[0]);
}

export async function getUserById(db: AppDatabase, id: number): Promise<User | null> {
  const result = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/models/user.ts server/test/models.user.test.ts
git commit -m "feat(server): add user model with findOrCreate"
```

---

## Task 5: Auth pure logic (domain check + session tokens)

**Files:**
- Create: `server/src/auth/domain.ts`
- Create: `server/src/auth/session.ts`
- Test: `server/test/auth.domain.test.ts`
- Test: `server/test/auth.session.test.ts`

**Interfaces:**
- Produces: `isAllowedDomain(email: string, allowedDomain: string): boolean`, `export interface SessionPayload { userId: number; email: string }`, `signSession(payload: SessionPayload, secret: string): string`, `verifySession(token: string, secret: string): SessionPayload | null`

- [ ] **Step 1: Write the failing tests**

`server/test/auth.domain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAllowedDomain } from '../src/auth/domain';

describe('isAllowedDomain', () => {
  it('accepts an email on the allowed domain', () => {
    expect(isAllowedDomain('wilka@ilhacrossmidia.com.br', 'ilhacrossmidia.com.br')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAllowedDomain('Wilka@IlhaCrossmidia.com.br', 'ilhacrossmidia.com.br')).toBe(true);
  });

  it('rejects an email on a different domain', () => {
    expect(isAllowedDomain('wilka@gmail.com', 'ilhacrossmidia.com.br')).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(isAllowedDomain('not-an-email', 'ilhacrossmidia.com.br')).toBe(false);
  });
});
```

`server/test/auth.session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '../src/auth/session';

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = signSession({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' }, 'test-secret');
    const payload = verifySession(token, 'test-secret');

    expect(payload).toEqual({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' });
  });

  it('returns null for a token signed with a different secret', () => {
    const token = signSession({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' }, 'test-secret');
    const payload = verifySession(token, 'wrong-secret');

    expect(payload).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(verifySession('not-a-token', 'test-secret')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/auth/domain.ts` and `src/auth/session.ts` do not exist yet.

- [ ] **Step 3: Implement `server/src/auth/domain.ts`**

```ts
export function isAllowedDomain(email: string, allowedDomain: string): boolean {
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) {
    return false;
  }
  return parts[1] === allowedDomain.toLowerCase();
}
```

- [ ] **Step 4: Implement `server/src/auth/session.ts`**

```ts
import jwt from 'jsonwebtoken';

export interface SessionPayload {
  userId: number;
  email: string;
}

export function signSession(payload: SessionPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '30d' });
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'object' && decoded !== null && 'userId' in decoded && 'email' in decoded) {
      return { userId: Number(decoded.userId), email: String(decoded.email) };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/domain.ts server/src/auth/session.ts server/test/auth.domain.test.ts server/test/auth.session.test.ts
git commit -m "feat(server): add domain check and session token helpers"
```

---

## Task 6: Auth middleware (requireAuth)

**Files:**
- Create: `server/src/auth/middleware.ts`
- Test: `server/test/auth.middleware.test.ts`

**Interfaces:**
- Consumes: `verifySession`, `SessionPayload` from `./session` (Task 5)
- Produces: `export const SESSION_COOKIE = 'session'`, `requireAuth(jwtSecret: string): RequestHandler` (attaches `req.user: SessionPayload`)

- [ ] **Step 1: Write the failing test**

`server/test/auth.middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireAuth, SESSION_COOKIE } from '../src/auth/middleware';
import { signSession } from '../src/auth/session';

const JWT_SECRET = 'test-secret';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/protected', requireAuth(JWT_SECRET), (req, res) => {
    res.json({ user: req.user });
  });
  return app;
}

describe('requireAuth', () => {
  it('returns 401 when there is no session cookie', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the session cookie is invalid', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=garbage`);
    expect(res.status).toBe(401);
  });

  it('attaches req.user and calls next when the session is valid', async () => {
    const app = buildTestApp();
    const token = signSession({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' }, JWT_SECRET);

    const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/auth/middleware.ts` does not exist yet.

- [ ] **Step 3: Implement `server/src/auth/middleware.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';
import { verifySession, type SessionPayload } from './session';

declare global {
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

export const SESSION_COOKIE = 'session';

export function requireAuth(jwtSecret: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;

    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const payload = verifySession(token, jwtSecret);

    if (!payload) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    req.user = payload;
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/middleware.ts server/test/auth.middleware.test.ts
git commit -m "feat(server): add requireAuth middleware"
```

---

## Task 7: Google verifier + auth routes + CORS, wired into the app

**Files:**
- Create: `server/src/auth/googleVerifier.ts`
- Create: `server/src/routes/auth.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/test/app.health.test.ts`
- Create: `server/.env.example`
- Test: `server/test/routes.auth.test.ts`

**Interfaces:**
- Consumes: `findOrCreateUser(...): Promise<User>`, `getUserById(...): Promise<User | null>` (Task 4), `isAllowedDomain` (Task 5), `signSession` (Task 5), `requireAuth`, `SESSION_COOKIE` (Task 6), `AppDatabase`, `withTestTransaction` (Task 2)
- Produces: `export interface GoogleProfile { sub: string; email: string; name: string }`, `export type VerifyIdToken = (idToken: string) => Promise<GoogleProfile>`, `createAuthRouter(deps: { db: AppDatabase; verifyIdToken: VerifyIdToken; jwtSecret: string; allowedDomain: string }): Router`, `createGoogleVerifier(clientId: string): VerifyIdToken`, extended `export interface AppDeps { db: AppDatabase; verifyIdToken: VerifyIdToken; jwtSecret: string; allowedDomain: string; frontendUrl: string }`, `createApp(deps: AppDeps): Express`

- [ ] **Step 1: Write the failing test**

`server/test/routes.auth.test.ts`:

Route tests wrap each test body in `withTestTransaction` (Task 2) so every query the
route handlers make during that test — across however many HTTP requests the test
issues — runs on the same transaction and rolls back at the end. `AppDatabase` is a
structural interface (`{ query(...) }`), so a `PoolClient` from `withTestTransaction`
satisfies it exactly like the `Pool` does elsewhere.

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { GoogleProfile } from '../src/routes/auth';
import type { AppDatabase } from '../src/db';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken: (idToken: string) => Promise<GoogleProfile>) {
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

describe('POST /api/auth/google', () => {
  it('logs in a user with an allowed domain and sets a session cookie', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-1',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('wilka@ilhacrossmidia.com.br');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^session=/);
    });
  });

  it('rejects a user outside the allowed domain', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-2',
        email: 'someone@gmail.com',
        name: 'Someone',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(403);
    });
  });

  it('rejects an invalid Google token', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => {
        throw new Error('invalid token');
      });

      const res = await request(app).post('/api/auth/google').send({ idToken: 'bad-token' });

      expect(res.status).toBe(401);
    });
  });

  it('rejects a request without an idToken', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => {
        throw new Error('should not be called');
      });

      const res = await request(app).post('/api/auth/google').send({});

      expect(res.status).toBe(400);
    });
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user when logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-1',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      }));

      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(
        expect.objectContaining({ email: 'wilka@ilhacrossmidia.com.br', name: 'Wilka' }),
      );
      expect(res.body.user.id).toBeGreaterThan(0);
    });
  });

  it('returns 401 when not logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => {
        throw new Error('should not be called');
      });

      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
    });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-1',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      }));

      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(204);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^session=;/);
    });
  });
});
```

- [ ] **Step 2: Update `server/test/app.health.test.ts` to match the new `createApp` signature**

The health check route never touches the database, so this test stubs `AppDatabase`
directly instead of opening a real connection — no network dependency for a test that
doesn't need one.

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const stubDb: AppDatabase = {
      query: async () => {
        throw new Error('not used in this test');
      },
    };

    const app = createApp({
      db: stubDb,
      verifyIdToken: async () => {
        throw new Error('not used in this test');
      },
      jwtSecret: 'test-secret',
      allowedDomain: 'ilhacrossmidia.com.br',
      frontendUrl: 'http://localhost:5173',
    });

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/routes/auth.ts` does not exist, `createApp` doesn't accept `deps` yet.

- [ ] **Step 4: Implement `server/src/routes/auth.ts`**

```ts
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
```

- [ ] **Step 5: Implement `server/src/auth/googleVerifier.ts`**

```ts
import { OAuth2Client } from 'google-auth-library';
import type { GoogleProfile } from '../routes/auth';

export function createGoogleVerifier(clientId: string) {
  const client = new OAuth2Client(clientId);

  return async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email || !payload.name) {
      throw new Error('Invalid Google ID token payload');
    }

    return { sub: payload.sub, email: payload.email, name: payload.name };
  };
}
```

- [ ] **Step 6: Update `server/src/app.ts`**

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppDatabase } from './db';
import { createAuthRouter, type VerifyIdToken } from './routes/auth';

export interface AppDeps {
  db: AppDatabase;
  verifyIdToken: VerifyIdToken;
  jwtSecret: string;
  allowedDomain: string;
  frontendUrl: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors({ origin: deps.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter(deps));

  return app;
}
```

- [ ] **Step 7: Update `server/src/index.ts`**

`createDb` is `async` (Task 2), and this project's `tsconfig.json` targets CommonJS (no
top-level `await`), so startup is wrapped in an async `main()`:

```ts
import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';

const port = Number(process.env.PORT ?? 4000);
const connectionString = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

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
  });

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

The `!` assertions inside `main()` are necessary — TypeScript's narrowing from the outer
`if (!x) throw` checks does not carry into a nested function body, even for `const`
bindings.

- [ ] **Step 8: Create `server/.env.example`**

```
PORT=4000
DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
GOOGLE_CLIENT_ID=replace-with-google-oauth-client-id
JWT_SECRET=replace-with-a-long-random-secret
ALLOWED_EMAIL_DOMAIN=ilhacrossmidia.com.br
FRONTEND_URL=http://localhost:5173
```

- [ ] **Step 9: Add `cors` and `@types/cors` (already in package.json from Task 1) — reinstall to confirm lockfile**

Run: `npm install` (inside `server/`)

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add server/src/auth/googleVerifier.ts server/src/routes/auth.ts server/src/app.ts server/src/index.ts server/test/app.health.test.ts server/test/routes.auth.test.ts server/.env.example server/package-lock.json
git commit -m "feat(server): add Google-restricted login and CORS"
```

---

## Task 8: Jobs routes, wired into the app

**Files:**
- Create: `server/src/routes/jobs.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/routes.jobs.test.ts`

**Interfaces:**
- Consumes: `createJob(...): Promise<Job>`, `listJobs(...): Promise<Job[]>` (Task 3), `requireAuth` (Task 6), `AppDeps`, `withTestTransaction` (Task 7/2)
- Produces: `createJobsRouter(deps: { db: AppDatabase; jwtSecret: string }): Router`

Like Task 7's route tests, these wrap each test in `withTestTransaction` — and because the
shared Supabase table may hold other real rows, assertions check that a job this test
created *appears* in the response, never that the list is empty or has an exact length
(see Global Constraints).

- [ ] **Step 1: Write the failing test**

`server/test/routes.jobs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase) {
  const verifyIdToken = async (): Promise<GoogleProfile> => ({
    sub: 'google-sub-1',
    email: 'wilka@ilhacrossmidia.com.br',
    name: 'Wilka',
  });
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

async function loggedInAgent(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/auth/google').send({ idToken: 'fake-token' });
  return agent;
}

describe('GET /api/jobs', () => {
  it('returns 401 when not logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app).get('/api/jobs');
      expect(res.status).toBe(401);
    });
  });

  it('includes a freshly created job in the list', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      await agent.post('/api/jobs').send({ name: 'Job criado no teste GET /api/jobs' });
      const res = await agent.get('/api/jobs');

      expect(res.status).toBe(200);
      expect(
        res.body.jobs.some((job: { name: string }) => job.name === 'Job criado no teste GET /api/jobs'),
      ).toBe(true);
    });
  });
});

describe('POST /api/jobs', () => {
  it('creates a job and returns it', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Colgate - Color Correct Wave 2', code: '0307-2026', client: 'Colgate' });

      expect(res.status).toBe(201);
      expect(res.body.job.name).toBe('Colgate - Color Correct Wave 2');

      const list = await agent.get('/api/jobs');
      expect(
        list.body.jobs.some((job: { name: string }) => job.name === 'Colgate - Color Correct Wave 2'),
      ).toBe(true);
    });
  });

  it('rejects a job without a name', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.post('/api/jobs').send({ client: 'Colgate' });

      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `GET /api/jobs` returns 404, `src/routes/jobs.ts` does not exist yet.

- [ ] **Step 3: Implement `server/src/routes/jobs.ts`**

```ts
import { Router } from 'express';
import type { AppDatabase } from '../db';
import { createJob, listJobs } from '../models/job';
import { requireAuth } from '../auth/middleware';

export interface JobsRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
}

export function createJobsRouter(deps: JobsRouterDeps): Router {
  const router = Router();

  router.use(requireAuth(deps.jwtSecret));

  router.get('/', async (_req, res) => {
    res.json({ jobs: await listJobs(deps.db) });
  });

  router.post('/', async (req, res) => {
    const { name, code, client } = req.body as { name?: string; code?: string; client?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const job = await createJob(deps.db, { name: name.trim(), code, client });
    res.status(201).json({ job });
  });

  return router;
}
```

- [ ] **Step 4: Update `server/src/app.ts`**

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppDatabase } from './db';
import { createAuthRouter, type VerifyIdToken } from './routes/auth';
import { createJobsRouter } from './routes/jobs';

export interface AppDeps {
  db: AppDatabase;
  verifyIdToken: VerifyIdToken;
  jwtSecret: string;
  allowedDomain: string;
  frontendUrl: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors({ origin: deps.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/jobs', createJobsRouter(deps));

  return app;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/jobs.ts server/src/app.ts server/test/routes.jobs.test.ts
git commit -m "feat(server): add authenticated jobs list/create routes"
```

---

## Task 9: Frontend scaffold + API client

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/api/client.ts`
- Create: `web/.env.example`
- Test: `web/test/api.client.test.ts`

**Interfaces:**
- Produces: `export class ApiError extends Error { status: number }`, `export interface User { id: number; email: string; name?: string }`, `export interface Job { id: number; name: string; code: string | null; client: string | null; createdAt: string; updatedAt: string }`, `export const api: { me, loginWithGoogle, logout, listJobs, createJob }`, `export function request<T>(path: string, options?: RequestInit): Promise<T>`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "gerente-de-projeto-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@react-oauth/google": "^0.12.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.4",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 4: Create `web/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create `web/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ilha Crossmídia — Acompanhamento de Jobs</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `web/.env.example`**

```
VITE_API_BASE_URL=http://localhost:4000
VITE_GOOGLE_CLIENT_ID=replace-with-google-oauth-client-id
```

- [ ] **Step 7: Install dependencies**

Run (inside `web/`): `npm install`

- [ ] **Step 8: Write the failing test**

`web/test/api.client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '../src/api/client';

describe('api client request()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ hello: 'world' }),
      }),
    );

    const result = await request<{ hello: string }>('/api/anything');

    expect(result).toEqual({ hello: 'world' });
  });

  it('throws ApiError with the status and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Email domain not allowed' }),
      }),
    );

    await expect(request('/api/auth/google')).rejects.toMatchObject({
      status: 403,
      message: 'Email domain not allowed',
    });
  });

  it('sends credentials and JSON headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await request('/api/jobs');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `src/api/client.ts` does not exist yet.

- [ ] **Step 10: Implement `web/src/api/client.ts`**

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export interface User {
  id: number;
  email: string;
  name?: string;
}

export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  loginWithGoogle: (idToken: string) =>
    request<{ user: User }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  listJobs: () => request<{ jobs: Job[] }>('/api/jobs'),
  createJob: (job: { name: string; code?: string; client?: string }) =>
    request<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(job) }),
};
```

- [ ] **Step 11: Create placeholder `web/src/App.tsx`**

```tsx
export function App() {
  return <div>Ilha Crossmídia — Acompanhamento de Jobs</div>;
}
```

- [ ] **Step 12: Create `web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 13: Run test to verify it passes**

Run: `npm test` (inside `web/`)
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add web
git commit -m "feat(web): scaffold Vite React app with API client"
```

---

## Task 10: Dashboard page (list + create job)

**Files:**
- Create: `web/src/pages/Dashboard.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/test/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `api`, `Job` from `../api/client` (Task 9)
- Produces: `export function Dashboard(): JSX.Element`

- [ ] **Step 1: Write the failing test**

`web/test/Dashboard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from '../src/pages/Dashboard';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      listJobs: vi.fn(),
      createJob: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

describe('Dashboard', () => {
  beforeEach(() => {
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
  });

  it('shows a message when there are no jobs', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    render(<Dashboard />);

    expect(await screen.findByText('Nenhum job cadastrado ainda.')).toBeInTheDocument();
  });

  it('lists jobs returned by the API', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        {
          id: 1,
          name: 'Colgate - Color Correct Wave 2',
          code: '0307-2026',
          client: 'Colgate',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    });

    render(<Dashboard />);

    expect(await screen.findByText(/Colgate - Color Correct Wave 2/)).toBeInTheDocument();
  });

  it('creates a job and refreshes the list', async () => {
    mockedApi.listJobs
      .mockResolvedValueOnce({ jobs: [] })
      .mockResolvedValueOnce({
        jobs: [
          {
            id: 1,
            name: 'Novo job',
            code: null,
            client: null,
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
      });
    mockedApi.createJob.mockResolvedValue({
      job: {
        id: 1,
        name: 'Novo job',
        code: null,
        client: null,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
    });

    const user = userEvent.setup();
    render(<Dashboard />);

    await screen.findByText('Nenhum job cadastrado ainda.');

    await user.type(screen.getByLabelText('Nome'), 'Novo job');
    await user.click(screen.getByRole('button', { name: 'Adicionar job' }));

    await waitFor(() => expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job' }));
    expect(await screen.findByText(/Novo job/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `src/pages/Dashboard.tsx` does not exist yet.

- [ ] **Step 3: Implement `web/src/pages/Dashboard.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Job } from '../api/client';

export function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [client, setClient] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refreshJobs() {
    const res = await api.listJobs();
    setJobs(res.jobs);
  }

  useEffect(() => {
    refreshJobs().catch(() => setError('Não foi possível carregar os jobs.'));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do job.');
      return;
    }

    try {
      await api.createJob({
        name: name.trim(),
        code: code.trim() || undefined,
        client: client.trim() || undefined,
      });
      setName('');
      setCode('');
      setClient('');
      await refreshJobs();
    } catch {
      setError('Não foi possível criar o job.');
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Jobs</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem' }}>
        <div>
          <label htmlFor="job-name">Nome</label>
          <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="job-code">Código</label>
          <input id="job-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label htmlFor="job-client">Cliente</label>
          <input id="job-client" value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <button type="submit">Adicionar job</button>
        {error && <p role="alert">{error}</p>}
      </form>

      {jobs.length === 0 ? (
        <p>Nenhum job cadastrado ainda.</p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <strong>{job.name}</strong>
              {job.code ? ` — ${job.code}` : ''}
              {job.client ? ` (${job.client})` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Note: the `<label htmlFor="job-name">Nome</label>` must match exactly for `getByLabelText('Nome')` to resolve to the name field — it does, since `code`/`client` labels are "Código"/"Cliente", not "Nome".

- [ ] **Step 4: Update `web/src/App.tsx` to render the Dashboard**

```tsx
import { Dashboard } from './pages/Dashboard';

export function App() {
  return <Dashboard />;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test` (inside `web/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Dashboard.tsx web/src/App.tsx web/test/Dashboard.test.tsx
git commit -m "feat(web): add dashboard with job list and create form"
```

---

## Task 11: AuthContext + Login page + protected routing

**Files:**
- Create: `web/src/auth/AuthContext.tsx`
- Create: `web/src/pages/Login.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/main.tsx`
- Test: `web/test/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `api`, `User` from `../api/client` (Task 9), `Dashboard` (Task 10)
- Produces: `AuthProvider({ children }): JSX.Element`, `useAuth(): { user: User | null; loading: boolean; loginWithGoogle(idToken: string): Promise<void>; logout(): Promise<void> }`, `Login(): JSX.Element`

- [ ] **Step 1: Write the failing test**

`web/test/AuthContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <p>loading</p>;
  return <p>{user ? `logged in as ${user.email}` : 'logged out'}</p>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
  });

  it('sets user to null when /me fails', async () => {
    mockedApi.me.mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => screen.getByText('logged out'));
  });

  it('sets the user when /me succeeds', async () => {
    mockedApi.me.mockResolvedValue({ user: { id: 1, email: 'wilka@ilhacrossmidia.com.br' } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => screen.getByText('logged in as wilka@ilhacrossmidia.com.br'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `src/auth/AuthContext.tsx` does not exist yet.

- [ ] **Step 3: Implement `web/src/auth/AuthContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type User } from '../api/client';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function loginWithGoogle(idToken: string) {
    const res = await api.loginWithGoogle(idToken);
    setUser(res.user);
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `web/`)
Expected: PASS

- [ ] **Step 5: Implement `web/src/pages/Login.tsx`**

```tsx
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../auth/AuthContext';

export function Login() {
  const { loginWithGoogle } = useAuth();

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4rem' }}>
      <div>
        <h1>Ilha Crossmídia</h1>
        <p>Acompanhamento de Jobs — entre com sua conta @ilhacrossmidia.com.br</p>
        <GoogleLogin
          onSuccess={(credentialResponse) => {
            if (credentialResponse.credential) {
              void loginWithGoogle(credentialResponse.credential);
            }
          }}
          onError={() => console.error('Falha no login com Google')}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update `web/src/App.tsx`**

```tsx
import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 7: Update `web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { App } from './App';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 8: Run all frontend tests to verify nothing broke**

Run: `npm test` (inside `web/`)
Expected: PASS (Dashboard and AuthContext tests both pass; Dashboard's test renders the component directly, unaffected by routing changes in App.tsx)

- [ ] **Step 9: Commit**

```bash
git add web/src/auth/AuthContext.tsx web/src/pages/Login.tsx web/src/App.tsx web/src/main.tsx web/test/AuthContext.test.tsx
git commit -m "feat(web): add Google login, auth context, and protected routing"
```

---

## Task 12: Root README + manual verification

**Files:**
- Create: `README.md` (repo root)

- [ ] **Step 1: Create `README.md`**

```markdown
# Sistema de Acompanhamento de Jobs — Ilha Crossmídia

Ver spec completa em `docs/superpowers/specs/2026-08-18-sistema-acompanhamento-jobs-design.md`.

## Estrutura

- `server/` — API (Node.js + Express + TypeScript + PostgreSQL via Supabase). Deploy em
  plataforma always-on (Railway, Render, ou VPS) — **não** em serverless/Vercel, pois
  mantém conexão persistente com o WhatsApp (em planos futuros deste projeto).
- `web/` — Frontend (React + Vite + TypeScript). Deploy no Vercel.

## Pré-requisitos

- Node.js 18 ou superior.
- Um projeto no [Supabase](https://supabase.com/dashboard) (gratuito): crie a conta
  (pode entrar com Google), crie um projeto, e em **Project Settings → Database →
  Connection string** copie a *session pooler* connection string (porta 5432) — a
  conexão direta (`db.<ref>.supabase.co`) exige IPv6 e pode não funcionar em toda rede.
- Uma credencial OAuth do Google (Google Cloud Console → APIs & Services →
  Credentials → Create OAuth client ID → Web application), com as origens
  JavaScript autorizadas incluindo `http://localhost:5173` (dev) e, depois do
  deploy, o domínio do Vercel.

## Rodando localmente

Backend:

```bash
cd server
cp .env.example .env   # preencha DATABASE_URL, GOOGLE_CLIENT_ID e JWT_SECRET
npm install
npm run dev
```

Frontend (em outro terminal):

```bash
cd web
cp .env.example .env   # preencha VITE_GOOGLE_CLIENT_ID
npm install
npm run dev
```

Acesse `http://localhost:5173`.

## Deploy

- **Backend**: Railway ou Render, apontando para o diretório `server/`. Configure as
  variáveis de ambiente do `server/.env.example` (`DATABASE_URL` do Supabase, e o
  domínio real do frontend em `FRONTEND_URL`) e garanta que o plano escolhido não hiberna
  o processo por inatividade — o banco em si já é gerenciado pelo Supabase, então o
  backend não precisa de disco persistente próprio.
- **Frontend**: Vercel, apontando para o diretório `web/` (framework preset
  Vite). Configure `VITE_API_BASE_URL` com a URL pública do backend e
  `VITE_GOOGLE_CLIENT_ID`.
- Depois do primeiro deploy, volte ao Google Cloud Console e adicione o
  domínio de produção do Vercel às origens JavaScript autorizadas do OAuth
  client.

## Checklist de verificação manual

Depois de rodar (local ou em produção), confirme manualmente:

- [ ] `GET /api/health` no backend responde `{"status":"ok"}`.
- [ ] Login com uma conta Google `@ilhacrossmidia.com.br` funciona e leva ao
      dashboard.
- [ ] Login com uma conta Google de outro domínio é rejeitado (erro 403).
- [ ] Criar um job no dashboard faz ele aparecer na lista imediatamente.
- [ ] Recarregar a página mantém o usuário logado (cookie de sessão persiste).
- [ ] Logout limpa a sessão e volta para a tela de login.
```

- [ ] **Step 2: Manually verify the checklist above** by running both dev servers together and walking through each item.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add root README with setup, deploy, and verification steps"
```
