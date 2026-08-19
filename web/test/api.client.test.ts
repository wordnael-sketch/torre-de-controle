import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, api, onSessionExpired } from '../src/api/client';

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
        json: async () => ({ error: 'domain_not_allowed' }),
      }),
    );

    await expect(request('/api/auth/google')).rejects.toMatchObject({
      status: 403,
      message: 'domain_not_allowed',
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

describe('api.listUsers / api.inviteUser / api.setUserRole / api.setUserStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listUsers fetches /api/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ users: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.listUsers();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/users'), expect.anything());
  });

  it('inviteUser posts to /api/users/invite', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ user: { id: 1, email: 'a@ilhacrossmidia.com.br', role: 'member', status: 'invited' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.inviteUser({ email: 'a@ilhacrossmidia.com.br', role: 'member' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/invite'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('setUserRole patches /api/users/:id/role', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 1, email: 'a@ilhacrossmidia.com.br', role: 'admin', status: 'active' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.setUserRole(1, 'admin');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/1/role'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('setUserStatus patches /api/users/:id/status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 1, email: 'a@ilhacrossmidia.com.br', role: 'member', status: 'revoked' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.setUserStatus(1, 'revoked');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/1/status'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('onSessionExpired', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies the listener on a 401 from a non-/me endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Not authenticated' }),
      }),
    );

    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(request('/api/jobs')).rejects.toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not notify the listener on a 401 from /api/auth/me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Not authenticated' }),
      }),
    );

    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(request('/api/auth/me')).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
