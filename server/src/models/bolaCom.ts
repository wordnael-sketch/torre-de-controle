import type { AppDatabase } from '../db';

export type BolaCom = 'ilha' | 'cliente';

export interface BolaComDayCounts {
  ilhaDays: number;
  clienteDays: number;
  currentSide: BolaCom;
  currentStreakDays: number;
}

interface HistoryRow {
  bola_com: BolaCom;
  changed_at: string | Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

export async function setBolaCom(
  db: AppDatabase,
  jobId: number,
  bolaCom: BolaCom,
  note?: string,
): Promise<void> {
  await db.query(
    `WITH updated AS (
       UPDATE jobs SET bola_com = $1, updated_at = now() WHERE id = $2
       RETURNING id
     )
     INSERT INTO job_bola_com_history (job_id, bola_com, note)
     SELECT id, $1, $3 FROM updated`,
    [bolaCom, jobId, note ?? null],
  );
}

export async function recordInitialBolaCom(db: AppDatabase, jobId: number): Promise<void> {
  await db.query(
    `INSERT INTO job_bola_com_history (job_id, bola_com) VALUES ($1, 'ilha')`,
    [jobId],
  );
}

export async function getBolaComDayCounts(
  db: AppDatabase,
  jobId: number,
  now: Date = new Date(),
): Promise<BolaComDayCounts> {
  const result = await db.query<HistoryRow>(
    'SELECT bola_com, changed_at FROM job_bola_com_history WHERE job_id = $1 ORDER BY changed_at ASC, id ASC',
    [jobId],
  );

  const rows = result.rows.map((row) => ({
    bolaCom: row.bola_com,
    changedAt: new Date(row.changed_at),
  }));

  let ilhaMs = 0;
  let clienteMs = 0;

  for (let i = 0; i < rows.length; i++) {
    const start = rows[i].changedAt;
    const end = i + 1 < rows.length ? rows[i + 1].changedAt : now;
    const durationMs = end.getTime() - start.getTime();
    if (rows[i].bolaCom === 'ilha') {
      ilhaMs += durationMs;
    } else {
      clienteMs += durationMs;
    }
  }

  const last = rows[rows.length - 1];
  const currentSide: BolaCom = last?.bolaCom ?? 'ilha';
  const currentStreakDays = last ? Math.floor((now.getTime() - last.changedAt.getTime()) / MS_PER_DAY) : 0;

  return {
    ilhaDays: Math.floor(ilhaMs / MS_PER_DAY),
    clienteDays: Math.floor(clienteMs / MS_PER_DAY),
    currentSide,
    currentStreakDays,
  };
}

export async function getBolaComDayCountsForJobs(
  db: AppDatabase,
  jobIds: number[],
  now: Date = new Date(),
): Promise<Map<number, BolaComDayCounts>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  const result = await db.query<{
    job_id: number;
    ilha_seconds: number | null;
    cliente_seconds: number | null;
    current_side: BolaCom;
    last_changed_at: string | Date;
  }>(
    `WITH ordered AS (
       SELECT
         job_id,
         id,
         bola_com,
         changed_at,
         LEAD(changed_at) OVER (PARTITION BY job_id ORDER BY changed_at, id) AS next_changed_at
       FROM job_bola_com_history
       WHERE job_id = ANY($1::int[])
     )
     SELECT
       job_id,
       SUM(EXTRACT(EPOCH FROM (COALESCE(next_changed_at, now()) - changed_at)))
         FILTER (WHERE bola_com = 'ilha') AS ilha_seconds,
       SUM(EXTRACT(EPOCH FROM (COALESCE(next_changed_at, now()) - changed_at)))
         FILTER (WHERE bola_com = 'cliente') AS cliente_seconds,
       (array_agg(bola_com ORDER BY changed_at DESC, id DESC))[1] AS current_side,
       MAX(changed_at) AS last_changed_at
     FROM ordered
     GROUP BY job_id`,
    [jobIds],
  );

  const map = new Map<number, BolaComDayCounts>();
  for (const row of result.rows) {
    const lastChangedAt = new Date(row.last_changed_at);
    map.set(row.job_id, {
      ilhaDays: Math.floor((row.ilha_seconds ?? 0) / SECONDS_PER_DAY),
      clienteDays: Math.floor((row.cliente_seconds ?? 0) / SECONDS_PER_DAY),
      currentSide: row.current_side,
      currentStreakDays: Math.floor((now.getTime() - lastChangedAt.getTime()) / MS_PER_DAY),
    });
  }
  return map;
}
