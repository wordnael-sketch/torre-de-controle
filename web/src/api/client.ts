const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type SessionExpiredListener = () => void;
let sessionExpiredListener: SessionExpiredListener | null = null;

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListener = listener;
  return () => {
    if (sessionExpiredListener === listener) {
      sessionExpiredListener = null;
    }
  };
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
    if (res.status === 401 && path !== '/api/auth/me') {
      sessionExpiredListener?.();
    }
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

export type BolaCom = 'ilha' | 'cliente';

export interface BolaComDayCounts {
  ilhaDays: number;
  clienteDays: number;
  currentSide: BolaCom;
  currentStreakDays: number;
}

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
  bolaCom: BolaCom;
  lastWhatsappActivityAt: string | null;
  actionRequired: string | null;
  triggerLabel: string | null;
  trelloCardId: string | null;
  atendimentoPersonId: number | null;
  atendimentoPersonName: string | null;
  bolaComDayCounts?: BolaComDayCounts;
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
  roleAssignments: RoleAssignment[];
  statusHistory: StatusHistoryEntry[];
  bolaComDayCounts: BolaComDayCounts;
}

export type SuggestionOutcome = 'auto_aplicado' | 'pendente' | 'descartado';

export interface ClassifySuggestion {
  tipo: 'checklist_item' | 'bola_com';
  valor: string;
  confidence: number;
  evidencia: string;
  outcome: SuggestionOutcome;
}

export interface TrelloCandidate {
  id: string;
  name: string;
  listName: string;
  strongMatch: boolean;
}

export interface TrelloCardSummary {
  name: string;
  listName: string;
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
  title: string | null;
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
  createJob: (job: { name: string; code?: string; client?: string; atendimentoPersonId: number }) =>
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
  setAtendimento: (id: number, personId: number) =>
    request<{ job: Job }>(`/api/jobs/${id}/atendimento`, {
      method: 'PATCH',
      body: JSON.stringify({ personId }),
    }),
  setBolaCom: (id: number, bolaCom: BolaCom) =>
    request<{ job: Job; bolaComDayCounts: BolaComDayCounts }>(`/api/jobs/${id}/bola-com`, {
      method: 'PATCH',
      body: JSON.stringify({ bolaCom }),
    }),
  setLastActivity: (id: number, lastWhatsappActivityAt: string | null) =>
    request<{ job: Job }>(`/api/jobs/${id}/last-activity`, {
      method: 'PATCH',
      body: JSON.stringify({ lastWhatsappActivityAt }),
    }),
  classifyJob: (id: number, text: string) =>
    request<{ suggestions: ClassifySuggestion[] }>(`/api/jobs/${id}/classify`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  getTrelloCandidates: (id: number) =>
    request<{ candidates: TrelloCandidate[] }>(`/api/jobs/${id}/trello-candidates`),
  setTrelloLink: (id: number, trelloCardId: string | null) =>
    request<{ job: Job }>(`/api/jobs/${id}/trello-link`, {
      method: 'POST',
      body: JSON.stringify({ trelloCardId }),
    }),
  syncTrello: (id: number) =>
    request<{ suggestions: ClassifySuggestion[]; trelloCard: TrelloCardSummary }>(
      `/api/jobs/${id}/trello-sync`,
      { method: 'POST' },
    ),
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
