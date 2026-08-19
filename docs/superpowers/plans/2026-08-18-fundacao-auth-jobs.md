# Fundação (Auth + Jobs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployable skeleton of the Ilha Crossmídia job-tracking system: a backend (API + SQLite) with Google-restricted login and basic Job CRUD, and a frontend (React) that logs in and shows the (initially empty) job list.

**Architecture:** Two independent apps in one repo — `server/` (Node.js + Express + TypeScript + SQLite, deployed to an always-on host like Railway/Render) and `web/` (React + Vite + TypeScript, deployed to Vercel). They communicate over HTTP with credentials (cookies), across origins, so the backend enables CORS for the frontend's origin and issues cross-site session cookies.

**Tech Stack:** Node.js + Express + TypeScript + better-sqlite3 (backend) · React + Vite + TypeScript + react-router-dom + @react-oauth/google (frontend) · Vitest + Supertest + Testing Library (tests).

**Spec:** [docs/superpowers/specs/2026-08-18-sistema-acompanhamento-jobs-design.md](../specs/2026-08-18-sistema-acompanhamento-jobs-design.md)

## Global Constraints

- Login via Google OAuth, restrito ao domínio `ilhacrossmidia.com.br`. (spec §3)
- Usuário único: apenas o Gerente de Projeto usa o sistema — sem múltiplos perfis/permissões no MVP. (spec §3)
- Banco de dados: SQLite em disco persistente. (spec §4)
- O processo do backend deve rodar "always-on" (sem scale-to-zero) — hospedagem separada do frontend, que vai para o Vercel. (decisão de hospedagem tomada nesta sessão, complementa spec §4)
- Frontend (Vercel) e backend (host always-on) ficam em origens diferentes: o backend precisa de CORS restrito à origem do frontend e cookies de sessão cross-site (`SameSite=None; Secure` em produção).

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
    "better-sqlite3": "^11.3.0",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "google-auth-library": "^9.14.1",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/cookie-parser": "^1.4.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^20.14.15",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

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

## Task 2: SQLite DB module + schema

**Files:**
- Create: `server/src/db/schema.sql`
- Create: `server/src/db/index.ts`
- Test: `server/test/db.test.ts`

**Interfaces:**
- Produces: `export type AppDatabase = Database.Database`, `createDb(filePath: string): AppDatabase`

- [ ] **Step 1: Write the failing test**

`server/test/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db';

describe('createDb', () => {
  it('creates the users and jobs tables', () => {
    const db = createDb(':memory:');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual(['jobs', 'users']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/db/index.ts` does not exist yet.

- [ ] **Step 3: Create `server/src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  client TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Implement `server/src/db/index.ts`**

```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type AppDatabase = Database.Database;

export function createDb(filePath: string): AppDatabase {
  if (filePath !== ':memory:') {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/db server/test/db.test.ts
git commit -m "feat(server): add SQLite connection and schema"
```

---

## Task 3: Job model

**Files:**
- Create: `server/src/models/job.ts`
- Test: `server/test/models.job.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` from `../db` (Task 2)
- Produces: `export interface Job { id: number; name: string; code: string | null; client: string | null; createdAt: string; updatedAt: string; }`, `listJobs(db: AppDatabase): Job[]`, `createJob(db: AppDatabase, input: { name: string; code?: string; client?: string }): Job`

- [ ] **Step 1: Write the failing test**

`server/test/models.job.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type AppDatabase } from '../src/db';
import { createJob, listJobs } from '../src/models/job';

describe('job model', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates a job and returns it with generated fields', () => {
    const job = createJob(db, {
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

  it('creates a job without optional fields', () => {
    const job = createJob(db, { name: 'Job sem codigo' });

    expect(job.code).toBeNull();
    expect(job.client).toBeNull();
  });

  it('lists jobs ordered by newest first', () => {
    createJob(db, { name: 'Primeiro job' });
    createJob(db, { name: 'Segundo job' });

    const jobs = listJobs(db);

    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe('Segundo job');
    expect(jobs[1].name).toBe('Primeiro job');
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
  created_at: string;
  updated_at: string;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    client: row.client,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listJobs(db: AppDatabase): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRow[];
  return rows.map(toJob);
}

export function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Job {
  const result = db
    .prepare('INSERT INTO jobs (name, code, client) VALUES (?, ?, ?)')
    .run(input.name, input.code ?? null, input.client ?? null);

  const row = db
    .prepare('SELECT * FROM jobs WHERE id = ?')
    .get(result.lastInsertRowid) as JobRow;

  return toJob(row);
}
```

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
- Consumes: `AppDatabase` from `../db` (Task 2)
- Produces: `export interface User { id: number; googleSub: string; email: string; name: string; createdAt: string; }`, `findOrCreateUser(db: AppDatabase, input: { googleSub: string; email: string; name: string }): User`, `getUserById(db: AppDatabase, id: number): User | null`

- [ ] **Step 1: Write the failing test**

`server/test/models.user.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type AppDatabase } from '../src/db';
import { findOrCreateUser, getUserById } from '../src/models/user';

describe('findOrCreateUser', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates a new user on first call', () => {
    const user = findOrCreateUser(db, {
      googleSub: 'google-sub-123',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    });

    expect(user.id).toBeGreaterThan(0);
    expect(user.email).toBe('wilka@ilhacrossmidia.com.br');
  });

  it('returns the same user on subsequent calls with the same googleSub', () => {
    const first = findOrCreateUser(db, {
      googleSub: 'google-sub-123',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    });
    const second = findOrCreateUser(db, {
      googleSub: 'google-sub-123',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    });

    expect(second.id).toBe(first.id);
  });
});

describe('getUserById', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('returns the user matching the id', () => {
    const created = findOrCreateUser(db, {
      googleSub: 'google-sub-123',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    });

    const found = getUserById(db, created.id);

    expect(found).toEqual(created);
  });

  it('returns null when no user matches the id', () => {
    expect(getUserById(db, 999)).toBeNull();
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
  created_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}

export function findOrCreateUser(
  db: AppDatabase,
  input: { googleSub: string; email: string; name: string },
): User {
  const existing = db
    .prepare('SELECT * FROM users WHERE google_sub = ?')
    .get(input.googleSub) as UserRow | undefined;

  if (existing) {
    return toUser(existing);
  }

  const result = db
    .prepare('INSERT INTO users (google_sub, email, name) VALUES (?, ?, ?)')
    .run(input.googleSub, input.email, input.name);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;

  return toUser(row);
}

export function getUserById(db: AppDatabase, id: number): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
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
- Consumes: `findOrCreateUser`, `getUserById` (Task 4), `isAllowedDomain` (Task 5), `signSession` (Task 5), `requireAuth`, `SESSION_COOKIE` (Task 6), `AppDatabase` (Task 2)
- Produces: `export interface GoogleProfile { sub: string; email: string; name: string }`, `export type VerifyIdToken = (idToken: string) => Promise<GoogleProfile>`, `createAuthRouter(deps: { db: AppDatabase; verifyIdToken: VerifyIdToken; jwtSecret: string; allowedDomain: string }): Router`, `createGoogleVerifier(clientId: string): VerifyIdToken`, extended `export interface AppDeps { db: AppDatabase; verifyIdToken: VerifyIdToken; jwtSecret: string; allowedDomain: string; frontendUrl: string }`, `createApp(deps: AppDeps): Express`

- [ ] **Step 1: Write the failing test**

`server/test/routes.auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createDb, type AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken: (idToken: string) => Promise<GoogleProfile>) {
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

describe('POST /api/auth/google', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('logs in a user with an allowed domain and sets a session cookie', async () => {
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

  it('rejects a user outside the allowed domain', async () => {
    const app = buildApp(db, async () => ({
      sub: 'google-sub-2',
      email: 'someone@gmail.com',
      name: 'Someone',
    }));

    const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

    expect(res.status).toBe(403);
  });

  it('rejects an invalid Google token', async () => {
    const app = buildApp(db, async () => {
      throw new Error('invalid token');
    });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'bad-token' });

    expect(res.status).toBe(401);
  });

  it('rejects a request without an idToken', async () => {
    const app = buildApp(db, async () => {
      throw new Error('should not be called');
    });

    const res = await request(app).post('/api/auth/google').send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('returns the current user when logged in', async () => {
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

  it('returns 401 when not logged in', async () => {
    const app = buildApp(db, async () => {
      throw new Error('should not be called');
    });

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const db = createDb(':memory:');
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
```

- [ ] **Step 2: Update `server/test/app.health.test.ts` to match the new `createApp` signature**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createDb } from '../src/db';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const app = createApp({
      db: createDb(':memory:'),
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

    const user = findOrCreateUser(deps.db, {
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

  router.get('/me', requireAuth(deps.jwtSecret), (req, res) => {
    const user = getUserById(deps.db, req.user!.userId);

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

```ts
import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.DB_PATH ?? './data/app.db';
const jwtSecret = process.env.JWT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
if (!googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required');
}

const app = createApp({
  db: createDb(dbPath),
  verifyIdToken: createGoogleVerifier(googleClientId),
  jwtSecret,
  allowedDomain,
  frontendUrl,
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
```

- [ ] **Step 8: Create `server/.env.example`**

```
PORT=4000
DB_PATH=./data/app.db
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
- Consumes: `createJob`, `listJobs` (Task 3), `requireAuth` (Task 6), `AppDeps` (Task 7)
- Produces: `createJobsRouter(deps: { db: AppDatabase; jwtSecret: string }): Router`

- [ ] **Step 1: Write the failing test**

`server/test/routes.jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createDb, type AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';

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
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('returns 401 when not logged in', async () => {
    const app = buildApp(db);
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
  });

  it('returns an empty list when there are no jobs', async () => {
    const app = buildApp(db);
    const agent = await loggedInAgent(app);

    const res = await agent.get('/api/jobs');

    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual([]);
  });
});

describe('POST /api/jobs', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates a job and returns it', async () => {
    const app = buildApp(db);
    const agent = await loggedInAgent(app);

    const res = await agent
      .post('/api/jobs')
      .send({ name: 'Colgate - Color Correct Wave 2', code: '0307-2026', client: 'Colgate' });

    expect(res.status).toBe(201);
    expect(res.body.job.name).toBe('Colgate - Color Correct Wave 2');

    const list = await agent.get('/api/jobs');
    expect(list.body.jobs).toHaveLength(1);
  });

  it('rejects a job without a name', async () => {
    const app = buildApp(db);
    const agent = await loggedInAgent(app);

    const res = await agent.post('/api/jobs').send({ client: 'Colgate' });

    expect(res.status).toBe(400);
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

  router.get('/', (_req, res) => {
    res.json({ jobs: listJobs(deps.db) });
  });

  router.post('/', (req, res) => {
    const { name, code, client } = req.body as { name?: string; code?: string; client?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const job = createJob(deps.db, { name: name.trim(), code, client });
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

- `server/` — API (Node.js + Express + TypeScript + SQLite). Deploy em plataforma
  always-on (Railway, Render, ou VPS) — **não** em serverless/Vercel, pois mantém
  conexão persistente com o WhatsApp e um banco SQLite em disco.
- `web/` — Frontend (React + Vite + TypeScript). Deploy no Vercel.

## Pré-requisitos

- Node.js 18 ou superior.
- Uma credencial OAuth do Google (Google Cloud Console → APIs & Services →
  Credentials → Create OAuth client ID → Web application), com as origens
  JavaScript autorizadas incluindo `http://localhost:5173` (dev) e, depois do
  deploy, o domínio do Vercel.

## Rodando localmente

Backend:

```bash
cd server
cp .env.example .env   # preencha GOOGLE_CLIENT_ID e JWT_SECRET
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

- **Backend**: Railway ou Render, apontando para o diretório `server/`, com um
  volume/disco persistente montado no caminho de `DB_PATH`. Configure as
  variáveis de ambiente do `server/.env.example` (usando o domínio real do
  frontend em `FRONTEND_URL`) e garanta que o plano escolhido não hiberna o
  processo por inatividade.
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
