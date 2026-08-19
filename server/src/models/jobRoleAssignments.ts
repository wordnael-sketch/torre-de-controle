import type { AppDatabase } from '../db';

export interface RoleAssignment {
  area: string;
  personId: number | null;
  personName: string | null;
}

export async function getJobRoleAssignments(
  db: AppDatabase,
  jobId: number,
  phaseId: number,
): Promise<RoleAssignment[]> {
  const result = await db.query<{ area: string; person_id: number | null; person_name: string | null }>(
    `SELECT pr.area, jra.person_id, person.name AS person_name
     FROM phase_roles pr
     LEFT JOIN job_role_assignments jra
       ON jra.phase_id = pr.phase_id AND jra.area = pr.area AND jra.job_id = $1
     LEFT JOIN people person ON person.id = jra.person_id
     WHERE pr.phase_id = $2
     ORDER BY pr.area`,
    [jobId, phaseId],
  );

  return result.rows.map((row) => ({
    area: row.area,
    personId: row.person_id,
    personName: row.person_name,
  }));
}

export async function setJobRoleAssignment(
  db: AppDatabase,
  jobId: number,
  phaseId: number,
  area: string,
  personId: number | null,
): Promise<RoleAssignment> {
  await db.query(
    `INSERT INTO job_role_assignments (job_id, phase_id, area, person_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id, phase_id, area) DO UPDATE SET person_id = EXCLUDED.person_id`,
    [jobId, phaseId, area, personId],
  );

  const result = await db.query<{ person_name: string | null }>(
    'SELECT name AS person_name FROM people WHERE id = $1',
    [personId],
  );

  return {
    area,
    personId,
    personName: personId ? result.rows[0]?.person_name ?? null : null,
  };
}
