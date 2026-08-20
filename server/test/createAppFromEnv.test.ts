import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppFromEnv } from '../src/createAppFromEnv';

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID'] as const;
type RequiredVar = (typeof REQUIRED_VARS)[number];

describe('createAppFromEnv', () => {
  let saved: Partial<Record<RequiredVar, string | undefined>>;

  beforeEach(() => {
    saved = {};
    for (const key of REQUIRED_VARS) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of REQUIRED_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('builds an Express app when all required env vars are present', async () => {
    const app = await createAppFromEnv();
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  it('throws when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    await expect(createAppFromEnv()).rejects.toThrow('DATABASE_URL environment variable is required');
  });

  it('throws when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    await expect(createAppFromEnv()).rejects.toThrow('JWT_SECRET environment variable is required');
  });

  it('throws when GOOGLE_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(createAppFromEnv()).rejects.toThrow('GOOGLE_CLIENT_ID environment variable is required');
  });
});
