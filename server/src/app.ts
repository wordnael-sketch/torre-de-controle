import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppDatabase } from './db';
import { createAuthRouter, type VerifyIdToken } from './routes/auth';
import { createJobsRouter } from './routes/jobs';
import { createReferenceRouter } from './routes/reference';
import { createUsersRouter } from './routes/users';
import { createTrelloWebhookRouter } from './routes/trelloWebhook';
import type { Classifier } from './services/classifier';
import type { TrelloClient } from './services/trello';

export interface AppDeps {
  db: AppDatabase;
  verifyIdToken: VerifyIdToken;
  jwtSecret: string;
  allowedDomain: string;
  frontendUrl: string;
  classifier?: Classifier;
  trelloClient?: TrelloClient;
  trelloWebhookSecret?: string;
  trelloWebhookCallbackUrl?: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors({ origin: deps.frontendUrl, credentials: true }));
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/trello-webhook', createTrelloWebhookRouter(deps));
  app.use('/api/trello-webhook', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('trello webhook error', err);
    res.status(200).json({ ok: true });
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
