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
