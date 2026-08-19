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
