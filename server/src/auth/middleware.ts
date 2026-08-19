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
