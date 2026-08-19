import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, api } from '../src/api/client';

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

describe('api.getJob / api.advanceJob / api.setJobStatus / api.assignRole', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getJob fetches /api/jobs/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { id: 1, name: 'Job' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.getJob(1);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/jobs/1'), expect.anything());
  });

  it('advanceJob posts to /api/jobs/:id/advance', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { id: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.advanceJob(1, 'nota');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/advance'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('setJobStatus posts to /api/jobs/:id/status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { id: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.setJobStatus(1, 42, 'nota');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/status'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('assignRole puts to /api/jobs/:id/roles/:area', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ roleAssignment: { area: 'Comercial', personId: 1, personName: 'Anne' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.assignRole(1, 'Comercial', 2);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/roles/Comercial'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('assignRole URL-encodes an area containing a slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ roleAssignment: { area: 'Jurídico/Base', personId: 1, personName: 'Carol' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.assignRole(1, 'Jurídico/Base', 2);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/jobs/1/roles/');
    expect(calledUrl).not.toContain('roles/Jurídico/Base'); // would be the broken, unencoded form
    expect(decodeURIComponent(calledUrl.split('/roles/')[1])).toBe('Jurídico/Base');
  });
});
