import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import handler from '../api/index';
import type { IncomingMessage, ServerResponse } from 'http';

describe('Vercel handler', () => {
  it('responds to GET /api/health', async () => {
    const res = await request(handler).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reuses the same app instance across multiple invocations (memoized cold start)', async () => {
    await request(handler).get('/api/health');
    const res = await request(handler).get('/api/health');

    expect(res.status).toBe(200);
  });

  it('recovers on the next request after a failed cold start instead of caching the rejection forever', async () => {
    // Use a fresh module instance so this test's memoized `appPromise` is
    // isolated from the ones already warmed up by the tests above.
    vi.resetModules();
    const { default: freshHandler } = await import('../api/index');

    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      // First invocation: createAppFromEnv() rejects because a required env
      // var is missing (simulating a transient cold-start failure). req/res
      // are never touched by the handler before it rejects, so empty stand-ins
      // are safe here.
      await expect(
        freshHandler({} as IncomingMessage, {} as ServerResponse)
      ).rejects.toThrow('DATABASE_URL environment variable is required');
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }

    // Second invocation, env restored: if the rejected promise had stayed
    // memoized, this would still fail with the same error instead of
    // retrying. Proves the module clears its cached promise on failure.
    const res = await request(freshHandler).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
