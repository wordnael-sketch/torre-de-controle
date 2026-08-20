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
