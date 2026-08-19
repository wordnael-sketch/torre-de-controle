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

  const byEmail = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [
    input.email,
  ]);

  if (byEmail.rows[0]) {
    const user = byEmail.rows[0];
    // If the user was seeded with null google_sub/name, update them
    if (!user.google_sub || !user.name) {
      const updated = await db.query<UserRow>(
        'UPDATE users SET google_sub = $1, name = $2 WHERE id = $3 RETURNING *',
        [input.googleSub, input.name, user.id],
      );
      return toUser(updated.rows[0]);
    }
    return toUser(user);
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
