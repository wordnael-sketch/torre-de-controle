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
