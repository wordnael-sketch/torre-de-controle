import type { IncomingMessage, ServerResponse } from 'http';
import { createAppFromEnv } from '../server/src/createAppFromEnv';
import type { Express } from 'express';

let appPromise: Promise<Express> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) {
    appPromise = createAppFromEnv().catch((err) => {
      // Don't let a failed cold start poison future requests on this warm
      // instance: clear the memoized promise so the next invocation retries
      // from scratch instead of replaying the same rejection forever.
      appPromise = undefined;
      throw err;
    });
  }
  const app = await appPromise;
  app(req, res);
}
