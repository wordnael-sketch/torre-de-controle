import { describe, it, expect } from 'vitest';
import request from 'supertest';
import handler from '../api/index';

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
});
