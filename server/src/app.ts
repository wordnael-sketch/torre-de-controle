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
