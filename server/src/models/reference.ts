import type { AppDatabase } from '../db';

export interface Phase {
  id: number;
  order: number;
  name: string;
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

export interface PhaseWithStatuses extends Phase {
  roles: string[];
  statuses: Status[];
}

interface PhaseRow {
  id: number;
  order: number;
  name: string;
}

interface StatusRow {
  id: number;
  phase_id: number;
  order: number;
  name: string;
  action_required: string;
  trigger_label: string;
  primary_role: string;
}

interface RoleRow {
  phase_id: number;
  area: string;
}

function toStatus(row: StatusRow): Status {
  return {
    id: row.id,
    phaseId: row.phase_id,
    order: row.order,
    name: row.name,
    actionRequired: row.action_required,
    triggerLabel: row.trigger_label,
    primaryRole: row.primary_role,
  };
}

export async function listPhasesWithStatuses(db: AppDatabase): Promise<PhaseWithStatuses[]> {
  const [phasesResult, statusesResult, rolesResult] = await Promise.all([
    db.query<PhaseRow>('SELECT id, "order", name FROM phases ORDER BY "order"'),
    db.query<StatusRow>(
      'SELECT id, phase_id, "order", name, action_required, trigger_label, primary_role FROM statuses ORDER BY phase_id, "order"',
    ),
    db.query<RoleRow>('SELECT phase_id, area FROM phase_roles ORDER BY phase_id, area'),
  ]);

  return phasesResult.rows.map((phase) => ({
    id: phase.id,
    order: phase.order,
    name: phase.name,
    roles: rolesResult.rows.filter((r) => r.phase_id === phase.id).map((r) => r.area),
    statuses: statusesResult.rows.filter((s) => s.phase_id === phase.id).map(toStatus),
  }));
}
