import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '../src/api/client';

describe('api client request()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ hello: 'world' }),
      }),
    );

    const result = await request<{ hello: string }>('/api/anything');

    expect(result).toEqual({ hello: 'world' });
  });

  it('throws ApiError with the status and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Email domain not allowed' }),
      }),
    );

    await expect(request('/api/auth/google')).rejects.toMatchObject({
      status: 403,
      message: 'Email domain not allowed',
    });
  });

  it('sends credentials and JSON headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await request('/api/jobs');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
