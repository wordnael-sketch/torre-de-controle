# Usuários, Papéis e Convite de Acesso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-user "any `@ilhacrossmidia.com.br` Google account gets
full access" model with invite-gated multi-user access: two roles (`admin`/`member`),
an admin invites people by email before they can log in, revocation takes effect
immediately, and Wilka is seeded as the first admin.

**Architecture:** Extends the existing `server`/`web` foundation in place. The
`users` table gains `role`/`status` columns and becomes nullable on
`google_sub`/`name` (an invited-but-not-yet-logged-in account has neither). Every
authenticated request re-checks the account's `status` against the database (not
just the session token's validity), so a revoked account loses access on its very
next request, not at next login. A new admin-only `/api/users` route and `Usuários`
page manage the invite/role/status lifecycle.

**Tech Stack:** Same as the foundation and Kanban plans — Node.js/Express/TypeScript
+ PostgreSQL (Supabase) on the backend, React/Vite/TypeScript on the frontend,
vitest+supertest for backend tests (against the real Supabase project via
`withTestTransaction`), vitest+Testing Library for frontend tests.

**Spec:** `docs/superpowers/specs/2026-08-19-usuarios-e-papeis-design.md`

## Global Constraints

- Backend: async/Promise-based DB access only, via `AppDatabase`. Postgres
  placeholders are `$1`, `$2`, ... — never `?`.
- Every new/modified async route handler and async middleware MUST be wrapped in the
  existing `asyncHandler` from `server/src/utils/asyncHandler.ts` — an unwrapped
  async middleware that throws crashes the whole process exactly like an unwrapped
  route handler does.
- Tests run against the REAL shared Supabase Postgres project via `withTestTransaction`
  (`BEGIN`/`ROLLBACK` isolation). The seeded Wilka admin row (this plan's Task 1) is
  committed data, visible inside every test transaction — but tests must not rely on
  it implicitly for their own setup (e.g. "this login test happens to work because
  Wilka is pre-seeded"); each test that needs an invited/active account creates its
  own explicitly, using a distinct test email, so the test's intent is legible on its
  own.
- Every route that requires an active session must check the account's current
  `status` in the database on every request (not just verify the session token) —
  this is the mechanism that makes revocation take effect immediately.
- Frontend: `web/src/api/client.ts` remains the single `fetch` chokepoint —
  `credentials: 'include'` always, `ApiError` thrown on any non-2xx response.

---

## Task 1: Schema — papéis, status e seed do primeiro admin

**Files:**
- Modify: `server/src/db/schema.sql`
- Test: `server/test/schema.users.test.ts`

**Interfaces:**
- Produces: `users.role` (`'admin'` or `'member'`, default `'member'`), `users.status`
  (`'invited'`, `'active'`, or `'revoked'`, default `'invited'`), `users.google_sub`
  and `users.name` now nullable.

- [ ] **Step 1: Write the failing test**

`server/test/schema.users.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db';

describe('users table — roles, status, seeded admin', () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required to run this test');
  }

  it('adds role and status columns, and makes google_sub/name nullable', async () => {
    const db = await createDb(connectionString);
    try {
      const columns = await db.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name IN ('role', 'status', 'google_sub', 'name')`,
      );
      const byName = Object.fromEntries(columns.rows.map((c) => [c.column_name, c.is_nullable]));

      expect(byName.role).toBe('NO');
      expect(byName.status).toBe('NO');
      expect(byName.google_sub).toBe('YES');
      expect(byName.name).toBe('YES');
    } finally {
      await db.end();
    }
  });

  it('seeds wilka@ilhacrossmidia.com.br as an invited admin', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ role: string; status: string }>(
        `SELECT role, status FROM users WHERE email = 'wilka@ilhacrossmidia.com.br'`,
      );
      expect(result.rows[0]).toEqual({ role: 'admin', status: 'invited' });
    } finally {
      await db.end();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — the new columns and seed row don't exist yet.

- [ ] **Step 3: Modify `server/src/db/schema.sql`**

The existing `users` table (near the top of the file) is:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Immediately after that `CREATE TABLE` statement (do not touch any other part of the
file), add:

```sql
ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;
ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'invited';

INSERT INTO users (email, role, status) VALUES
  ('wilka@ilhacrossmidia.com.br', 'admin', 'invited')
ON CONFLICT (email) DO NOTHING;
```

(`ALTER COLUMN ... DROP NOT NULL` has no `IF EXISTS`/idempotency concern — running it
again on an already-nullable column is a harmless no-op in Postgres, so no
`ON CONFLICT`-style guard is needed for those two lines.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.sql server/test/schema.users.test.ts
git commit -m "feat(server): add user roles/status and seed first admin"
```

---

## Task 2: Modelo de usuário — convite, ativação e gerenciamento

**Files:**
- Modify: `server/src/models/user.ts`
- Modify: `server/test/models.user.test.ts` (replace in full — `findOrCreateUser`'s
  own tests are removed, but the function itself is kept in `user.ts`, see below)

**Interfaces:**
- Consumes: `AppDatabase`, `withTestTransaction`.
- Produces: `export type UserRole = 'admin' | 'member'`,
  `export type UserStatus = 'invited' | 'active' | 'revoked'`,
  `export interface User { id: number; googleSub: string | null; email: string; name: string | null; role: UserRole; status: UserStatus; createdAt: string }`,
  `findUserByEmail(db: AppDatabase, email: string): Promise<User | null>`,
  `activateUser(db: AppDatabase, id: number, input: { googleSub: string; name: string }): Promise<User>`,
  `getUserById(db: AppDatabase, id: number): Promise<User | null>` (unchanged
  signature, enriched return shape),
  `inviteUser(db: AppDatabase, input: { email: string; role: UserRole }): Promise<User>`,
  `listUsers(db: AppDatabase): Promise<User[]>`,
  `setUserRole(db: AppDatabase, id: number, role: UserRole): Promise<User | null>`,
  `setUserStatus(db: AppDatabase, id: number, status: 'active' | 'revoked'): Promise<User | null>`.

**`findOrCreateUser` is KEPT in this task, not removed** — a correction to the
original scope. `server/src/routes/auth.ts` still calls it and is not rewritten until
Task 4; deleting it here would break every existing auth/jobs/reference route test
for the two-task window between Task 2 and Task 4 landing. Task 1's implementer
already hit this exact problem in miniature (the seeded Wilka row, with a null
`google_sub`, broke the OLD `findOrCreateUser`'s google_sub-only lookup) and fixed it
with an email-fallback inside the old function — Step 3 below carries that same fix
forward into the new file, adapted to the new `User`/`UserRow` shape. Task 4 is the
one that actually deletes `findOrCreateUser`, at the same time it rewrites
`auth.ts` to stop calling it.

- [ ] **Step 1: Replace `server/test/models.user.test.ts` in full**

```ts
import { describe, it, expect } from 'vitest';
import {
  findUserByEmail,
  activateUser,
  getUserById,
  inviteUser,
  listUsers,
  setUserRole,
  setUserStatus,
} from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

describe('inviteUser / findUserByEmail', () => {
  it('creates an invited user with no googleSub or name yet', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'convidado.teste@ilhacrossmidia.com.br', role: 'member' });

      expect(invited.id).toBeGreaterThan(0);
      expect(invited.status).toBe('invited');
      expect(invited.role).toBe('member');
      expect(invited.googleSub).toBeNull();
      expect(invited.name).toBeNull();

      const found = await findUserByEmail(db, 'convidado.teste@ilhacrossmidia.com.br');
      expect(found?.id).toBe(invited.id);
    });
  });

  it('returns null for an email that was never invited', async () => {
    await withTestTransaction(async (db) => {
      expect(await findUserByEmail(db, 'nunca-convidado@ilhacrossmidia.com.br')).toBeNull();
    });
  });
});

describe('activateUser', () => {
  it('fills in googleSub/name and flips status to active', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'ativacao.teste@ilhacrossmidia.com.br', role: 'admin' });

      const activated = await activateUser(db, invited.id, {
        googleSub: 'google-sub-ativacao-teste',
        name: 'Pessoa Teste',
      });

      expect(activated.status).toBe('active');
      expect(activated.googleSub).toBe('google-sub-ativacao-teste');
      expect(activated.name).toBe('Pessoa Teste');
      expect(activated.role).toBe('admin');
    });
  });
});

describe('getUserById', () => {
  it('returns the user matching the id', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'busca.teste@ilhacrossmidia.com.br', role: 'member' });

      const found = await getUserById(db, invited.id);
      expect(found).toEqual(invited);
    });
  });

  it('returns null when no user matches the id', async () => {
    await withTestTransaction(async (db) => {
      expect(await getUserById(db, -1)).toBeNull();
    });
  });
});

describe('listUsers', () => {
  it('includes an invited user in the list', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'listagem.teste@ilhacrossmidia.com.br', role: 'member' });

      const users = await listUsers(db);
      expect(users.some((u) => u.id === invited.id)).toBe(true);
    });
  });
});

describe('setUserRole / setUserStatus', () => {
  it('changes a user role', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'papel.teste@ilhacrossmidia.com.br', role: 'member' });

      const updated = await setUserRole(db, invited.id, 'admin');

      expect(updated?.role).toBe('admin');
    });
  });

  it('returns null when changing the role of a nonexistent user', async () => {
    await withTestTransaction(async (db) => {
      expect(await setUserRole(db, -1, 'admin')).toBeNull();
    });
  });

  it('revokes and reactivates a user', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'revogacao.teste@ilhacrossmidia.com.br', role: 'member' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-revogacao-teste', name: 'Pessoa Revogada' });

      const revoked = await setUserStatus(db, invited.id, 'revoked');
      expect(revoked?.status).toBe('revoked');

      const reactivated = await setUserStatus(db, invited.id, 'active');
      expect(reactivated?.status).toBe('active');
    });
  });

  it('returns null when changing the status of a nonexistent user', async () => {
    await withTestTransaction(async (db) => {
      expect(await setUserStatus(db, -1, 'revoked')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — `findUserByEmail`, `activateUser`, `inviteUser`, `listUsers`,
`setUserRole`, `setUserStatus` don't exist yet.

- [ ] **Step 3: Replace `server/src/models/user.ts` in full**

```ts
import type { AppDatabase } from '../db';

export type UserRole = 'admin' | 'member';
export type UserStatus = 'invited' | 'active' | 'revoked';

export interface User {
  id: number;
  googleSub: string | null;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

interface UserRow {
  id: number;
  google_sub: string | null;
  email: string;
  name: string | null;
  role: string;
  status: string;
  created_at: string | Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function findUserByEmail(db: AppDatabase, email: string): Promise<User | null> {
  const result = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

// TEMPORARY — kept only because server/src/routes/auth.ts still calls this until
// Task 4 rewrites it. Task 4 deletes this function. Carries forward the
// email-fallback fix Task 1's implementer added to the old version of this file
// (the seeded Wilka row has a null google_sub, so a google_sub-only lookup misses
// her and would otherwise crash into the email UNIQUE constraint on INSERT).
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

  const byEmail = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [input.email]);

  if (byEmail.rows[0]) {
    const row = byEmail.rows[0];
    if (!row.google_sub || !row.name) {
      const updated = await db.query<UserRow>(
        'UPDATE users SET google_sub = $1, name = $2 WHERE id = $3 RETURNING *',
        [input.googleSub, input.name, row.id],
      );
      return toUser(updated.rows[0]);
    }
    return toUser(row);
  }

  const inserted = await db.query<UserRow>(
    'INSERT INTO users (google_sub, email, name) VALUES ($1, $2, $3) RETURNING *',
    [input.googleSub, input.email, input.name],
  );

  return toUser(inserted.rows[0]);
}

export async function activateUser(
  db: AppDatabase,
  id: number,
  input: { googleSub: string; name: string },
): Promise<User> {
  const result = await db.query<UserRow>(
    `UPDATE users SET google_sub = $1, name = $2, status = 'active' WHERE id = $3 RETURNING *`,
    [input.googleSub, input.name, id],
  );
  return toUser(result.rows[0]);
}

export async function getUserById(db: AppDatabase, id: number): Promise<User | null> {
  const result = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function inviteUser(
  db: AppDatabase,
  input: { email: string; role: UserRole },
): Promise<User> {
  const result = await db.query<UserRow>(
    `INSERT INTO users (email, role, status) VALUES ($1, $2, 'invited') RETURNING *`,
    [input.email, input.role],
  );
  return toUser(result.rows[0]);
}

export async function listUsers(db: AppDatabase): Promise<User[]> {
  const result = await db.query<UserRow>('SELECT * FROM users ORDER BY email');
  return result.rows.map(toUser);
}

export async function setUserRole(db: AppDatabase, id: number, role: UserRole): Promise<User | null> {
  const result = await db.query<UserRow>('UPDATE users SET role = $1 WHERE id = $2 RETURNING *', [role, id]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function setUserStatus(
  db: AppDatabase,
  id: number,
  status: 'active' | 'revoked',
): Promise<User | null> {
  const result = await db.query<UserRow>('UPDATE users SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/models/user.ts server/test/models.user.test.ts
git commit -m "feat(server): replace auto-create user model with invite/activate lifecycle"
```

---

## Task 3: Middleware de conta ativa e de admin

**Files:**
- Modify: `server/src/auth/middleware.ts`
- Test: `server/test/auth.middleware.test.ts` (extend — keep the 3 existing
  `requireAuth` tests)

**Interfaces:**
- Consumes: `AppDatabase`, `asyncHandler` (already used elsewhere in this codebase),
  `req.user: SessionPayload` (set by the existing `requireAuth`).
- Produces: `export interface CurrentUser { id: number; email: string; name: string | null; role: 'admin' | 'member'; status: 'active' }`
  (attached to `req.currentUser`), `requireActiveUser(db: AppDatabase): RequestHandler`,
  `requireAdmin(): RequestHandler`.

`requireActiveUser` MUST run after `requireAuth` (it reads `req.user.userId`, which
`requireAuth` sets). `requireAdmin` MUST run after `requireActiveUser` (it reads
`req.currentUser.role`, which `requireActiveUser` sets) — `requireAdmin` does not
touch the database itself.

- [ ] **Step 1: Write the failing test**

Add to the END of `server/test/auth.middleware.test.ts` (keep the existing 3
`requireAuth` tests and their `buildTestApp`/imports untouched; add these new
imports and a new `describe` block):

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireAuth, requireActiveUser, requireAdmin, SESSION_COOKIE } from '../src/auth/middleware';
import { signSession } from '../src/auth/session';
import type { AppDatabase } from '../src/db';
import { inviteUser, activateUser, setUserStatus } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';

function buildAppWithDb(db: AppDatabase, requireAdminToo = false) {
  const app = express();
  app.use(cookieParser());
  const middlewares = [requireAuth(JWT_SECRET), requireActiveUser(db)];
  if (requireAdminToo) {
    middlewares.push(requireAdmin());
  }
  app.get('/protected', ...middlewares, (req, res) => {
    res.json({ currentUser: req.currentUser });
  });
  return app;
}

describe('requireActiveUser', () => {
  it('returns 401 when the session is for a user that no longer exists', async () => {
    await withTestTransaction(async (db) => {
      const app = buildAppWithDb(db);
      const token = signSession({ userId: -1, email: 'ninguem@ilhacrossmidia.com.br' }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(401);
    });
  });

  it('returns 401 when the account has been revoked', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'revogado.middleware.teste@ilhacrossmidia.com.br', role: 'member' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-teste', name: 'Pessoa' });
      await setUserStatus(db, active.id, 'revoked');

      const app = buildAppWithDb(db);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(401);
    });
  });

  it('attaches req.currentUser and calls next when the account is active', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'ativo.middleware.teste@ilhacrossmidia.com.br', role: 'admin' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-ativo-teste', name: 'Pessoa Ativa' });

      const app = buildAppWithDb(db);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(200);
      expect(res.body.currentUser).toMatchObject({ id: active.id, role: 'admin', status: 'active' });
    });
  });
});

describe('requireAdmin', () => {
  it('returns 403 when the current user is not an admin', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'membro.middleware.teste@ilhacrossmidia.com.br', role: 'member' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-membro-teste', name: 'Membro' });

      const app = buildAppWithDb(db, true);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(403);
    });
  });

  it('calls next when the current user is an admin', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'admin.middleware.teste@ilhacrossmidia.com.br', role: 'admin' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-admin-teste', name: 'Admin' });

      const app = buildAppWithDb(db, true);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — `requireActiveUser`, `requireAdmin` don't exist yet, `req.currentUser`
isn't declared.

- [ ] **Step 3: Replace `server/src/auth/middleware.ts` in full**

```ts
import type { NextFunction, Request, Response } from 'express';
import { verifySession, type SessionPayload } from './session';
import type { AppDatabase } from '../db';
import { asyncHandler } from '../utils/asyncHandler';

export interface CurrentUser {
  id: number;
  email: string;
  name: string | null;
  role: 'admin' | 'member';
  status: 'active';
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionPayload;
      currentUser?: CurrentUser;
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

interface CurrentUserRow {
  id: number;
  email: string;
  name: string | null;
  role: string;
  status: string;
}

export function requireActiveUser(db: AppDatabase) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const result = await db.query<CurrentUserRow>(
      'SELECT id, email, name, role, status FROM users WHERE id = $1',
      [req.user.userId],
    );
    const row = result.rows[0];

    if (!row || row.status !== 'active') {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    req.currentUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as 'admin' | 'member',
      status: 'active',
    };
    next();
  });
}

export function requireAdmin() {
  return function (req: Request, res: Response, next: NextFunction) {
    if (req.currentUser?.role !== 'admin') {
      res.status(403).json({ error: 'admin access required' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/middleware.ts server/test/auth.middleware.test.ts
git commit -m "feat(server): add requireActiveUser and requireAdmin middleware"
```

---

## Task 4: Login com convite obrigatório + revogação em tempo real

**Files:**
- Modify: `server/src/routes/auth.ts`
- Modify: `server/src/routes/jobs.ts`
- Modify: `server/src/routes/reference.ts`
- Modify: `server/src/models/user.ts` (remove the now-dead `findOrCreateUser`, kept
  temporarily by Task 2 only because this task's Step 3 needed it to still exist)
- Modify: `server/test/routes.auth.test.ts` (replace in full)

**Interfaces:**
- Consumes: `findUserByEmail`, `activateUser` (Task 2), `requireActiveUser` (Task 3).
- Produces: `POST /api/auth/google` now returns `403 { error: 'not_invited' }` for
  any email that was never invited or was revoked (instead of auto-creating an
  account); `403 { error: 'domain_not_allowed' }` replaces the previous
  `{ error: 'Email domain not allowed' }` message, for consistency with the new
  short-code convention.

This task also wires `requireActiveUser` into the two other authenticated routers
(`jobs.ts`, `reference.ts`) so revocation takes effect on every authenticated route,
not just `/api/auth/me` — per the spec's Global Constraint that ALL authenticated
routes must re-check account status on every request.

- [ ] **Step 1: Replace `server/test/routes.auth.test.ts` in full**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { GoogleProfile } from '../src/routes/auth';
import type { AppDatabase } from '../src/db';
import { inviteUser, setUserStatus } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken: (idToken: string) => Promise<GoogleProfile>) {
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

describe('POST /api/auth/google', () => {
  it('logs in a user who was invited beforehand and sets a session cookie', async () => {
    await withTestTransaction(async (db) => {
      await inviteUser(db, { email: 'convidada.login.teste@ilhacrossmidia.com.br', role: 'member' });

      const app = buildApp(db, async () => ({
        sub: 'google-sub-login-teste',
        email: 'convidada.login.teste@ilhacrossmidia.com.br',
        name: 'Convidada Teste',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('convidada.login.teste@ilhacrossmidia.com.br');
      expect(res.body.user.status).toBe('active');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^session=/);
    });
  });

  it('rejects an email that was never invited', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-nao-convidado-teste',
        email: 'nunca.convidado.teste@ilhacrossmidia.com.br',
        name: 'Ninguém',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('not_invited');
    });
  });

  it('rejects a revoked user even though they were once invited and active', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'revogada.login.teste@ilhacrossmidia.com.br', role: 'member' });
      await setUserStatus(db, invited.id, 'revoked');

      const app = buildApp(db, async () => ({
        sub: 'google-sub-revogada-teste',
        email: 'revogada.login.teste@ilhacrossmidia.com.br',
        name: 'Revogada',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('not_invited');
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
      expect(res.body.error).toBe('domain_not_allowed');
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
      await inviteUser(db, { email: 'me.teste@ilhacrossmidia.com.br', role: 'member' });

      const app = buildApp(db, async () => ({
        sub: 'google-sub-me-teste',
        email: 'me.teste@ilhacrossmidia.com.br',
        name: 'Pessoa Me',
      }));

      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(
        expect.objectContaining({ email: 'me.teste@ilhacrossmidia.com.br', name: 'Pessoa Me' }),
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

  it('returns 401 for a session whose account was revoked after login', async () => {
    await withTestTransaction(async (db) => {
      await inviteUser(db, { email: 'revogada.sessao.teste@ilhacrossmidia.com.br', role: 'member' });

      const app = buildApp(db, async () => ({
        sub: 'google-sub-revogada-sessao-teste',
        email: 'revogada.sessao.teste@ilhacrossmidia.com.br',
        name: 'Pessoa',
      }));

      const agent = request.agent(app);
      const loginRes = await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      await setUserStatus(db, loginRes.body.user.id, 'revoked');

      const res = await agent.get('/api/auth/me');

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — login still auto-creates any domain-matching email, `/me` doesn't
re-check status.

- [ ] **Step 3: Replace `server/src/routes/auth.ts` in full**

```ts
import { Router } from 'express';
import type { AppDatabase } from '../db';
import { findUserByEmail, activateUser } from '../models/user';
import { isAllowedDomain } from '../auth/domain';
import { signSession } from '../auth/session';
import { requireAuth, requireActiveUser, SESSION_COOKIE } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';

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

function sessionCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true as const,
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    secure: isProduction,
  };
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();

  router.post(
    '/google',
    asyncHandler(async (req, res) => {
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
        res.status(403).json({ error: 'domain_not_allowed' });
        return;
      }

      const existing = await findUserByEmail(deps.db, profile.email);

      if (!existing || existing.status === 'revoked') {
        res.status(403).json({ error: 'not_invited' });
        return;
      }

      const user = await activateUser(deps.db, existing.id, {
        googleSub: profile.sub,
        name: profile.name,
      });

      const token = signSession({ userId: user.id, email: user.email }, deps.jwtSecret);

      res.cookie(SESSION_COOKIE, token, {
        ...sessionCookieOptions(),
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      res.json({ user });
    }),
  );

  router.get(
    '/me',
    requireAuth(deps.jwtSecret),
    requireActiveUser(deps.db),
    asyncHandler(async (req, res) => {
      res.json({ user: req.currentUser });
    }),
  );

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.status(204).send();
  });

  return router;
}
```

Note: `GET /me` no longer calls `getUserById` itself — `requireActiveUser` already
looked the user up (to check `status`) and attached the result to `req.currentUser`,
so reusing it avoids a redundant second query.

- [ ] **Step 4: Add `requireActiveUser` to `server/src/routes/jobs.ts`**

Find this line near the top of `createJobsRouter`:

```ts
  router.use(requireAuth(deps.jwtSecret));
```

Replace with:

```ts
  router.use(requireAuth(deps.jwtSecret));
  router.use(requireActiveUser(deps.db));
```

And update the import line at the top of the file from:

```ts
import { requireAuth } from '../auth/middleware';
```

to:

```ts
import { requireAuth, requireActiveUser } from '../auth/middleware';
```

Nothing else in this file changes.

- [ ] **Step 5: Add `requireActiveUser` to `server/src/routes/reference.ts`**

Same change as Step 4, applied to `createReferenceRouter`: find

```ts
  router.use(requireAuth(deps.jwtSecret));
```

replace with

```ts
  router.use(requireAuth(deps.jwtSecret));
  router.use(requireActiveUser(deps.db));
```

and update the import from `import { requireAuth } from '../auth/middleware';` to
`import { requireAuth, requireActiveUser } from '../auth/middleware';`. Nothing else
in this file changes.

- [ ] **Step 6: Remove the now-dead `findOrCreateUser` from `server/src/models/user.ts`**

Task 2 kept `findOrCreateUser` in `user.ts` only because this task's Step 3 (above)
still called it at that point. Now that Step 3 has replaced `auth.ts`'s `/google`
handler to use `findUserByEmail`/`activateUser` instead, nothing in the codebase
calls `findOrCreateUser` anymore — remove it so it doesn't linger as dead code.

Delete this entire function from `server/src/models/user.ts` (it's the one with the
`// TEMPORARY` comment above it, between `findUserByEmail` and `activateUser`):

```ts
// TEMPORARY — kept only because server/src/routes/auth.ts still calls this until
// Task 4 rewrites it. Task 4 deletes this function. Carries forward the
// email-fallback fix Task 1's implementer added to the old version of this file
// (the seeded Wilka row has a null google_sub, so a google_sub-only lookup misses
// her and would otherwise crash into the email UNIQUE constraint on INSERT).
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

  const byEmail = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [input.email]);

  if (byEmail.rows[0]) {
    const row = byEmail.rows[0];
    if (!row.google_sub || !row.name) {
      const updated = await db.query<UserRow>(
        'UPDATE users SET google_sub = $1, name = $2 WHERE id = $3 RETURNING *',
        [input.googleSub, input.name, row.id],
      );
      return toUser(updated.rows[0]);
    }
    return toUser(row);
  }

  const inserted = await db.query<UserRow>(
    'INSERT INTO users (google_sub, email, name) VALUES ($1, $2, $3) RETURNING *',
    [input.googleSub, input.email, input.name],
  );

  return toUser(inserted.rows[0]);
}
```

Leave every other function in `user.ts` (from Task 2) exactly as it is — this step
removes only this one function.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS — this also re-runs every existing `jobs`/`reference` route test
(they all log in through the auth flow via `buildApp`/`loggedInAgent` helpers that
call `POST /api/auth/google`, which now requires the test's mocked email to be
pre-invited — check that those existing helper functions in
`server/test/routes.jobs.test.ts` and `server/test/routes.reference.test.ts` still
pass. If any fail with a `not_invited` 403, it's because that test's `loggedInAgent`
call uses an email that was never invited in that test's transaction — this should
NOT happen for tests using `wilka@ilhacrossmidia.com.br`, since Task 1's seed already
invited her and that seed data is visible inside every test transaction; if a
different email is used anywhere, this task does not require changing those files —
flag it as a finding for review instead of guessing at a fix.)

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/auth.ts server/src/routes/jobs.ts server/src/routes/reference.ts server/src/models/user.ts server/test/routes.auth.test.ts
git commit -m "feat(server): require invitation to log in, re-check account status on every request"
```

---

## Task 5: Rotas de gerenciamento de usuários (admin)

**Files:**
- Create: `server/src/routes/users.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/routes.users.test.ts`

**Interfaces:**
- Consumes: `listUsers`, `inviteUser`, `setUserRole`, `setUserStatus`,
  `findUserByEmail` (Task 2), `requireAuth`, `requireActiveUser`, `requireAdmin`
  (Task 3), `isAllowedDomain` (existing, from `../auth/domain`).
- Produces: `createUsersRouter(deps: { db: AppDatabase; jwtSecret: string; allowedDomain: string }): Router`
  mounted at `/api/users`: `GET /` (list), `POST /invite`, `PATCH /:id/role`,
  `PATCH /:id/status`.

- [ ] **Step 1: Write the failing test**

`server/test/routes.users.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import { inviteUser, activateUser } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken: (idToken: string) => Promise<GoogleProfile>) {
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

async function loggedInMemberAgent(db: AppDatabase) {
  const invited = await inviteUser(db, { email: 'membro.rota.teste@ilhacrossmidia.com.br', role: 'member' });
  await activateUser(db, invited.id, { googleSub: 'google-sub-membro-rota-teste', name: 'Membro Rota Teste' });

  const app = buildApp(db, async () => ({
    sub: 'google-sub-membro-rota-teste',
    email: 'membro.rota.teste@ilhacrossmidia.com.br',
    name: 'Membro Rota Teste',
  }));
  const agent = request.agent(app);
  await agent.post('/api/auth/google').send({ idToken: 'fake-token' });
  return agent;
}

describe('GET /api/users', () => {
  it('returns 403 for a member', async () => {
    await withTestTransaction(async (db) => {
      const agent = await loggedInMemberAgent(db);
      const res = await agent.get('/api/users');
      expect(res.status).toBe(403);
    });
  });

  it('lists users for an admin', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-rota-teste',
        email: 'admin.rota.teste@ilhacrossmidia.com.br',
        name: 'Admin Rota Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.rota.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-rota-teste', name: 'Admin Rota Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.get('/api/users');

      expect(res.status).toBe(200);
      expect(res.body.users.some((u: { email: string }) => u.email === 'admin.rota.teste@ilhacrossmidia.com.br')).toBe(true);
    });
  });
});

describe('POST /api/users/invite', () => {
  it('invites a new user', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-convite-teste',
        email: 'admin.convite.teste@ilhacrossmidia.com.br',
        name: 'Admin Convite Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.convite.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-convite-teste', name: 'Admin Convite Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent
        .post('/api/users/invite')
        .send({ email: 'nova.pessoa.teste@ilhacrossmidia.com.br', role: 'member' });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('nova.pessoa.teste@ilhacrossmidia.com.br');
      expect(res.body.user.status).toBe('invited');
    });
  });

  it('rejects an email outside the allowed domain', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-dominio-teste',
        email: 'admin.dominio.teste@ilhacrossmidia.com.br',
        name: 'Admin Domínio Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.dominio.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-dominio-teste', name: 'Admin Domínio Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.post('/api/users/invite').send({ email: 'fora@gmail.com', role: 'member' });

      expect(res.status).toBe(400);
    });
  });

  it('rejects inviting an email that already exists', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-duplicado-teste',
        email: 'admin.duplicado.teste@ilhacrossmidia.com.br',
        name: 'Admin Duplicado Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.duplicado.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-duplicado-teste', name: 'Admin Duplicado Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent
        .post('/api/users/invite')
        .send({ email: 'admin.duplicado.teste@ilhacrossmidia.com.br', role: 'member' });

      expect(res.status).toBe(409);
    });
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('changes a user role', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-papel-teste',
        email: 'admin.papel.teste@ilhacrossmidia.com.br',
        name: 'Admin Papel Teste',
      }));
      const invitedAdmin = await inviteUser(db, { email: 'admin.papel.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invitedAdmin.id, { googleSub: 'google-sub-admin-papel-teste', name: 'Admin Papel Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const target = await inviteUser(db, { email: 'alvo.papel.teste@ilhacrossmidia.com.br', role: 'member' });

      const res = await agent.patch(`/api/users/${target.id}/role`).send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');
    });
  });

  it('returns 404 for a nonexistent user', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-papel-404-teste',
        email: 'admin.papel404.teste@ilhacrossmidia.com.br',
        name: 'Admin',
      }));
      const invitedAdmin = await inviteUser(db, { email: 'admin.papel404.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invitedAdmin.id, { googleSub: 'google-sub-admin-papel-404-teste', name: 'Admin' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.patch('/api/users/999999999/role').send({ role: 'admin' });

      expect(res.status).toBe(404);
    });
  });
});

describe('PATCH /api/users/:id/status', () => {
  it('revokes and reactivates a user', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-status-teste',
        email: 'admin.status.teste@ilhacrossmidia.com.br',
        name: 'Admin Status Teste',
      }));
      const invitedAdmin = await inviteUser(db, { email: 'admin.status.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invitedAdmin.id, { googleSub: 'google-sub-admin-status-teste', name: 'Admin Status Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const target = await inviteUser(db, { email: 'alvo.status.teste@ilhacrossmidia.com.br', role: 'member' });

      const revokeRes = await agent.patch(`/api/users/${target.id}/status`).send({ status: 'revoked' });
      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.user.status).toBe('revoked');

      const reactivateRes = await agent.patch(`/api/users/${target.id}/status`).send({ status: 'active' });
      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.user.status).toBe('active');
    });
  });
});
```

Note each test that needs an admin agent inlines its own invite+activate+login
setup directly (matching the pattern `server/test/routes.jobs.test.ts`'s
`loggedInAgent` already uses — logging into the SAME `app` instance being tested,
not a second throwaway one) rather than sharing a helper, since the mocked
`verifyIdToken` closure needs to return that specific test's email. Only
`loggedInMemberAgent` is a shared helper (it IS reused, by the first `GET /api/users`
test).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — `server/src/routes/users.ts` doesn't exist yet.

- [ ] **Step 3: Implement `server/src/routes/users.ts`**

```ts
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
      if (!isAllowedDomain(email, deps.allowedDomain)) {
        res.status(400).json({ error: 'email must be in the allowed domain' });
        return;
      }

      const existing = await findUserByEmail(deps.db, email.trim());
      if (existing) {
        res.status(409).json({ error: 'user already exists' });
        return;
      }

      const user = await inviteUser(deps.db, { email: email.trim(), role });
      res.status(201).json({ user });
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
```

- [ ] **Step 4: Wire the router into `server/src/app.ts`**

Add the import and mount it at `/api/users`:

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppDatabase } from './db';
import { createAuthRouter, type VerifyIdToken } from './routes/auth';
import { createJobsRouter } from './routes/jobs';
import { createReferenceRouter } from './routes/reference';
import { createUsersRouter } from './routes/users';

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
  app.use('/api', createReferenceRouter(deps));
  app.use('/api/users', createUsersRouter(deps));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/users.ts server/src/app.ts server/test/routes.users.test.ts
git commit -m "feat(server): add admin-only user management routes"
```

---

## Task 6: Cliente de API do frontend — papéis e gerenciamento de usuários

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/test/api.client.test.ts` (extend — keep existing tests)

**Interfaces:**
- Produces: `export type UserRole = 'admin' | 'member'`,
  `export type UserStatus = 'invited' | 'active' | 'revoked'`,
  extended `export interface User { id: number; email: string; name?: string | null; role: UserRole; status: UserStatus }`,
  extended `export const api` with: `listUsers`, `inviteUser`, `setUserRole`,
  `setUserStatus`.

- [ ] **Step 1: Write the failing test**

Add to the END of `web/test/api.client.test.ts` (keep all existing tests and imports
— add `api` to the existing import from `'../src/api/client'` if it isn't already
imported there):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, api } from '../src/api/client';

// ... existing test blocks stay exactly as they are ...

describe('api.listUsers / api.inviteUser / api.setUserRole / api.setUserStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listUsers fetches /api/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ users: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.listUsers();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/users'), expect.anything());
  });

  it('inviteUser posts to /api/users/invite', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ user: { id: 1, email: 'a@ilhacrossmidia.com.br', role: 'member', status: 'invited' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.inviteUser({ email: 'a@ilhacrossmidia.com.br', role: 'member' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/invite'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('setUserRole patches /api/users/:id/role', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 1, email: 'a@ilhacrossmidia.com.br', role: 'admin', status: 'active' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.setUserRole(1, 'admin');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/1/role'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('setUserStatus patches /api/users/:id/status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 1, email: 'a@ilhacrossmidia.com.br', role: 'member', status: 'revoked' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.setUserStatus(1, 'revoked');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/1/status'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `api.listUsers` etc. don't exist yet.

- [ ] **Step 3: Modify `web/src/api/client.ts`**

Find the existing `User` interface:

```ts
export interface User {
  id: number;
  email: string;
  name?: string;
}
```

Replace with:

```ts
export type UserRole = 'admin' | 'member';
export type UserStatus = 'invited' | 'active' | 'revoked';

export interface User {
  id: number;
  email: string;
  name?: string | null;
  role: UserRole;
  status: UserStatus;
}
```

Find the closing brace of the `api` object (the last property before the final `};`)
— currently:

```ts
  createPerson: (input: { name: string; area: string }) =>
    request<{ person: Person }>('/api/people', { method: 'POST', body: JSON.stringify(input) }),
};
```

Add these four properties right before the closing `};`:

```ts
  createPerson: (input: { name: string; area: string }) =>
    request<{ person: Person }>('/api/people', { method: 'POST', body: JSON.stringify(input) }),
  listUsers: () => request<{ users: User[] }>('/api/users'),
  inviteUser: (input: { email: string; role: UserRole }) =>
    request<{ user: User }>('/api/users/invite', { method: 'POST', body: JSON.stringify(input) }),
  setUserRole: (id: number, role: UserRole) =>
    request<{ user: User }>(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  setUserStatus: (id: number, status: 'active' | 'revoked') =>
    request<{ user: User }>(`/api/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};
```

Nothing else in the file changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `web/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/test/api.client.test.ts
git commit -m "feat(web): extend API client with roles and user management methods"
```

---

## Task 7: Tela de login — mensagem específica para acesso não liberado

**Files:**
- Modify: `web/src/pages/Login.tsx`
- Create: `web/test/Login.test.tsx`

**Interfaces:**
- Consumes: `ApiError`, `api` (Task 6), `useAuth` (existing `AuthContext`).
- Produces: `Login` unchanged export shape — only its internal error handling
  changes.

- [ ] **Step 1: Write the failing test**

`web/test/Login.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../src/pages/Login';
import { AuthProvider } from '../src/auth/AuthContext';
import { ApiError } from '../src/api/client';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      loginWithGoogle: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

vi.mock('@react-oauth/google', () => ({
  GoogleLogin: ({ onSuccess }: { onSuccess: (r: { credential?: string }) => void }) => (
    <button type="button" onClick={() => onSuccess({ credential: 'fake-credential' })}>
      Fazer Login com o Google
    </button>
  ),
}));

function renderLogin() {
  return render(
    <AuthProvider>
      <Login />
    </AuthProvider>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
    mockedApi.loginWithGoogle.mockReset();
    mockedApi.me.mockRejectedValue(new Error('401'));
  });

  it('shows a specific message when the account has not been invited', async () => {
    mockedApi.loginWithGoogle.mockRejectedValue(new ApiError(403, 'not_invited'));
    const user = userEvent.setup();

    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Fazer Login com o Google' }));

    expect(
      await screen.findByText('Seu acesso ainda não foi liberado. Peça a um administrador para te convidar.'),
    ).toBeInTheDocument();
  });

  it('shows the domain message when the account is outside the allowed domain', async () => {
    mockedApi.loginWithGoogle.mockRejectedValue(new ApiError(403, 'domain_not_allowed'));
    const user = userEvent.setup();

    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Fazer Login com o Google' }));

    expect(await screen.findByText('Use uma conta @ilhacrossmidia.com.br.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `Login.tsx` still shows the same message for both 403 cases.

- [ ] **Step 3: Modify `web/src/pages/Login.tsx`**

Find:

```tsx
  async function handleCredential(credential: string) {
    setError(null);
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Use uma conta @ilhacrossmidia.com.br.');
      } else {
        setError('Não foi possível fazer login. Tente novamente.');
      }
    }
  }
```

Replace with:

```tsx
  async function handleCredential(credential: string) {
    setError(null);
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.message === 'not_invited') {
        setError('Seu acesso ainda não foi liberado. Peça a um administrador para te convidar.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Use uma conta @ilhacrossmidia.com.br.');
      } else {
        setError('Não foi possível fazer login. Tente novamente.');
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `web/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Login.tsx web/test/Login.test.tsx
git commit -m "feat(web): show a specific message when login is blocked by missing invitation"
```

---

## Task 8: Página de gerenciamento de usuários (admin) + roteamento

**Files:**
- Create: `web/src/pages/Users.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/test/Users.test.tsx`

**Interfaces:**
- Consumes: `api`, `User`, `UserRole` (Task 6), `useAuth` (existing).
- Produces: `export function UsersPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`web/test/Users.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPage } from '../src/pages/Users';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      listUsers: vi.fn(),
      inviteUser: vi.fn(),
      setUserRole: vi.fn(),
      setUserStatus: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

describe('UsersPage', () => {
  beforeEach(() => {
    mockedApi.listUsers.mockReset();
    mockedApi.inviteUser.mockReset();
    mockedApi.setUserRole.mockReset();
    mockedApi.setUserStatus.mockReset();
  });

  it('lists existing users with their role and status', async () => {
    mockedApi.listUsers.mockResolvedValue({
      users: [
        { id: 1, email: 'wilka@ilhacrossmidia.com.br', name: 'Wilka', role: 'admin', status: 'active' },
      ],
    });

    render(<UsersPage />);

    expect(await screen.findByText('wilka@ilhacrossmidia.com.br')).toBeInTheDocument();
  });

  it('invites a new user and refreshes the list', async () => {
    mockedApi.listUsers
      .mockResolvedValueOnce({ users: [] })
      .mockResolvedValueOnce({
        users: [{ id: 2, email: 'nova@ilhacrossmidia.com.br', name: null, role: 'member', status: 'invited' }],
      });
    mockedApi.inviteUser.mockResolvedValue({
      user: { id: 2, email: 'nova@ilhacrossmidia.com.br', name: null, role: 'member', status: 'invited' },
    });

    const user = userEvent.setup();
    render(<UsersPage />);

    await screen.findByText('Usuários');

    await user.type(screen.getByLabelText('E-mail'), 'nova@ilhacrossmidia.com.br');
    await user.click(screen.getByRole('button', { name: 'Convidar' }));

    await waitFor(() =>
      expect(mockedApi.inviteUser).toHaveBeenCalledWith({ email: 'nova@ilhacrossmidia.com.br', role: 'member' }),
    );
    expect(await screen.findByText('nova@ilhacrossmidia.com.br')).toBeInTheDocument();
  });

  it('revokes a user', async () => {
    mockedApi.listUsers.mockResolvedValue({
      users: [{ id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'active' }],
    });
    mockedApi.setUserStatus.mockResolvedValue({
      user: { id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'revoked' },
    });

    const user = userEvent.setup();
    render(<UsersPage />);

    await user.click(await screen.findByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(mockedApi.setUserStatus).toHaveBeenCalledWith(3, 'revoked'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `src/pages/Users.tsx` does not exist yet.

- [ ] **Step 3: Implement `web/src/pages/Users.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api, type User, type UserRole } from '../api/client';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await api.listUsers();
    setUsers(res.users);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar os usuários.'));
  }, []);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Informe o e-mail.');
      return;
    }

    try {
      await api.inviteUser({ email: email.trim(), role });
      setEmail('');
      setRole('member');
      await refresh();
    } catch {
      setError('Não foi possível convidar esse usuário.');
    }
  }

  async function handleRoleChange(id: number, newRole: UserRole) {
    setError(null);
    try {
      await api.setUserRole(id, newRole);
      await refresh();
    } catch {
      setError('Não foi possível trocar o papel desse usuário.');
    }
  }

  async function handleStatusChange(id: number, newStatus: 'active' | 'revoked') {
    setError(null);
    try {
      await api.setUserStatus(id, newStatus);
      await refresh();
    } catch {
      setError('Não foi possível mudar o status desse usuário.');
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Usuários</h1>

      <form onSubmit={handleInvite} style={{ marginBottom: '2rem' }}>
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
        {error && <p role="alert">{error}</p>}
      </form>

      <ul>
        {users.map((u) => (
          <li key={u.id}>
            <span>{u.email}</span> — {u.status} —{' '}
            <select
              aria-label={`Papel de ${u.email}`}
              value={u.role}
              onChange={(e) => void handleRoleChange(u.id, e.target.value as UserRole)}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>{' '}
            {u.status === 'revoked' ? (
              <button type="button" onClick={() => void handleStatusChange(u.id, 'active')}>
                Reativar
              </button>
            ) : (
              <button type="button" onClick={() => void handleStatusChange(u.id, 'revoked')}>
                Revogar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Update `web/src/App.tsx`**

Add a `RequireAdmin` component, a `Link` to it from the header (shown only to
admins), and the new `/usuarios` route. Replace the file in full:

```tsx
import type { ReactElement } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Login } from './pages/Login';
import { Board } from './pages/Board';
import { JobDetailPage } from './pages/JobDetail';
import { UsersPage } from './pages/Users';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem',
        }}
      >
        <span>{user.email}</span>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {user.role === 'admin' && <Link to="/usuarios">Usuários</Link>}
          <button type="button" onClick={() => void logout()}>
            Sair
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}

function RequireAdmin({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children;
}

function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Login />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Board />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs/:id"
        element={
          <RequireAuth>
            <JobDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/usuarios"
        element={
          <RequireAuth>
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
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

Note `/usuarios` is wrapped in BOTH `RequireAuth` (so it gets the shared header/nav)
and `RequireAdmin` (so a logged-in non-admin is bounced to `/`) — `RequireAdmin`
alone would skip the header.

- [ ] **Step 5: Run all frontend tests to verify nothing broke**

Run: `npm test` (inside `web/`)
Expected: PASS — all existing tests (`api.client.test.ts`, `AuthContext.test.tsx`,
`Board.test.tsx`, `JobDetail.test.tsx`, `Login.test.tsx` from Task 7) plus this
task's `Users.test.tsx` all pass.

- [ ] **Step 6: Run the build to confirm no type errors**

Run: `npm run build` (inside `web/`)
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Users.tsx web/src/App.tsx web/test/Users.test.tsx
git commit -m "feat(web): add admin user management page and route"
```

---

## Manual Verification (after all tasks)

Once all 8 tasks are complete and reviewed, run both dev servers and manually
confirm (this requires a real Google OAuth Client ID — see the root `README.md`):

- [ ] Logging in as `wilka@ilhacrossmidia.com.br` succeeds (she's pre-seeded as
      admin) and the "Usuários" link appears in the header.
- [ ] A non-invited email is rejected at login with the "acesso ainda não foi
      liberado" message.
- [ ] Wilka invites a new email (as `member`) on the Usuários page; that email can
      now log in successfully.
- [ ] The newly logged-in member does NOT see the "Usuários" link.
- [ ] Wilka revokes the member's access; the member's next action in the app
      (reload, or any API call) results in being sent back to the login screen —
      not just their next login attempt.
- [ ] Wilka reactivates the same account without re-inviting; the person can log in
      again immediately.
- [ ] Wilka promotes a member to admin; that person now sees the "Usuários" link
      after their next page load.
