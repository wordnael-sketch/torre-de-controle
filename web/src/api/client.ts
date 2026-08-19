const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export type UserRole = 'admin' | 'member';
export type UserStatus = 'invited' | 'active' | 'revoked';

export interface User {
  id: number;
  email: string;
  name?: string | null;
  role: UserRole;
  status: UserStatus;
}

export type AlertLevel = 'green' | 'yellow' | 'red';

export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
  statusId: number | null;
  statusName: string | null;
  phaseId: number | null;
  phaseName: string | null;
  completedAt: string | null;
  alertLevel: AlertLevel;
  highlightedPersonName: string | null;
}

export interface RoleAssignment {
  area: string;
  personId: number | null;
  personName: string | null;
}

export interface StatusHistoryEntry {
  id: number;
  fromStatusId: number | null;
  toStatusId: number;
  changedAt: string;
  note: string | null;
}

export interface JobDetail extends Job {
  actionRequired: string | null;
  triggerLabel: string | null;
  roleAssignments: RoleAssignment[];
  statusHistory: StatusHistoryEntry[];
}

export interface Status {
  id: number;
  phaseId: number;
  order: number;
  name: string;
  actionRequired: string;
  triggerLabel: string;
  primaryRole: string;
}

export interface Phase {
  id: number;
  order: number;
  name: string;
  roles: string[];
  statuses: Status[];
}

export interface Person {
  id: number;
  name: string;
  area: string;
  active: boolean;
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  loginWithGoogle: (idToken: string) =>
    request<{ user: User }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  listJobs: () => request<{ jobs: Job[] }>('/api/jobs'),
  createJob: (job: { name: string; code?: string; client?: string }) =>
    request<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(job) }),
  getJob: (id: number) => request<{ job: JobDetail }>(`/api/jobs/${id}`),
  advanceJob: (id: number, note?: string) =>
    request<{ job: Job }>(`/api/jobs/${id}/advance`, { method: 'POST', body: JSON.stringify({ note }) }),
  setJobStatus: (id: number, statusId: number, note?: string) =>
    request<{ job: Job }>(`/api/jobs/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ statusId, note }),
    }),
  assignRole: (id: number, area: string, personId: number | null) =>
    request<{ roleAssignment: RoleAssignment }>(`/api/jobs/${id}/roles/${encodeURIComponent(area)}`, {
      method: 'PUT',
      body: JSON.stringify({ personId }),
    }),
  getReference: () => request<{ phases: Phase[] }>('/api/reference'),
  listPeople: () => request<{ people: Person[] }>('/api/people'),
  createPerson: (input: { name: string; area: string }) =>
    request<{ person: Person }>('/api/people', { method: 'POST', body: JSON.stringify(input) }),
  listUsers: () => request<{ users: User[] }>('/api/users'),
  inviteUser: (input: { email: string; role: UserRole }) =>
    request<{ user: User }>('/api/users/invite', { method: 'POST', body: JSON.stringify(input) }),
  setUserRole: (id: number, role: UserRole) =>
    request<{ user: User }>(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  setUserStatus: (id: number, status: 'active' | 'revoked') =>
    request<{ user: User }>(`/api/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};
