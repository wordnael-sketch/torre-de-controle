import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const stubDb: AppDatabase = {
      query: async () => {
        throw new Error('not used in this test');
      },
    };

    const app = createApp({
      db: stubDb,
      verifyIdToken: async () => {
        throw new Error('not used in this test');
      },
      jwtSecret: 'test-secret',
      allowedDomain: 'ilhacrossmidia.com.br',
      frontendUrl: 'http://localhost:5173',
    });

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
