import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { classifyAndApply } from '../src/models/classification';
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import { withTestTransaction } from './helpers/testDb';

function fakeClassifier(suggestions: RawSuggestion[]): Classifier {
  return {
    classify: async () => suggestions,
  };
}

describe('classifyAndApply', () => {
  it('auto-applies a high-confidence forward checklist suggestion', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Auto-Aplica Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.9,
          evidencia: 'Cliente confirmou o briefing por aqui',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved).toHaveLength(1);
      expect(resolved[0].outcome).toBe('auto_aplicado');
    });
  });

  it('leaves a mid-confidence suggestion pending without applying it', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Pendente Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.7,
          evidencia: 'Parece que o briefing foi recebido',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('pendente');

      const updated = await db.query<{ status_id: number }>('SELECT status_id FROM jobs WHERE id = $1', [job.id]);
      expect(updated.rows[0].status_id).toBe(job.statusId);
    });
  });

  it('discards a low-confidence suggestion', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Descartada Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.3,
          evidencia: 'Menção vaga',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');
    });
  });

  it('never auto-applies a phase regression, even with high confidence', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Retrocesso Teste' });

      // Avança o job manualmente até "Orçamento e Decupagem" (order 4) antes de
      // simular uma sugestão de retrocesso para "Briefing Recebido" (order 2).
      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Orçamento e Decupagem'`,
      );
      await db.query('UPDATE jobs SET status_id = $1 WHERE id = $2', [targetStatus.rows[0].id, job.id]);

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.95,
          evidencia: 'Cliente disse que o briefing anterior estava errado',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('pendente');

      const updated = await db.query<{ status_id: number }>('SELECT status_id FROM jobs WHERE id = $1', [job.id]);
      expect(updated.rows[0].status_id).toBe(targetStatus.rows[0].id);
    });
  });

  it('auto-applies only the furthest forward suggestion in a batch, treating an earlier one as a regression against the post-write state (not the stale pre-batch state)', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Retrocesso Dentro Do Lote Teste' });
      // createJob starts the job at "Prospecção" (order 1) in "Comercial e Orçamento".

      const forwardStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Defesa da Proposta'`, // order 5
      );
      const middleStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Carta Orçamentária/Tratamento criada'`, // order 3
      );

      // A single paste reporting multiple completed milestones is the exact
      // real-world case this feature exists for: the batch here contains a
      // legitimate forward jump to order 5, followed by a suggestion targeting
      // order 3. Order 3 is only a "regression" relative to the state AFTER the
      // first suggestion is applied (5), not relative to the job's state before
      // the batch started (1) — the second suggestion must be checked against
      // wherever the job actually stands after suggestion one, not a frozen
      // pre-loop snapshot.
      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Defesa da Proposta',
          confidence: 0.9,
          evidencia: 'Proposta defendida e aprovada pelo cliente',
        },
        {
          tipo: 'checklist_item',
          valor: 'Carta Orçamentária/Tratamento criada',
          confidence: 0.9,
          evidencia: 'Carta orçamentária mencionada em mensagem antiga',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved).toHaveLength(2);
      expect(resolved[0].outcome).toBe('auto_aplicado');
      expect(resolved[1].outcome).toBe('pendente');

      const updated = await db.query<{ status_id: number }>('SELECT status_id FROM jobs WHERE id = $1', [job.id]);
      expect(updated.rows[0].status_id).toBe(forwardStatus.rows[0].id);
      expect(updated.rows[0].status_id).not.toBe(middleStatus.rows[0].id);
    });
  });

  it('auto-applies a high-confidence bola-com suggestion', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Bola Com Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'bola_com',
          valor: 'cliente',
          confidence: 0.9,
          evidencia: 'Aguardando aprovação do cliente',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('auto_aplicado');

      const updated = await db.query<{ bola_com: string }>('SELECT bola_com FROM jobs WHERE id = $1', [job.id]);
      expect(updated.rows[0].bola_com).toBe('cliente');
    });
  });

  it('discards a suggestion naming a checklist item that does not exist', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Item Inexistente Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Item que não existe no checklist',
          confidence: 0.95,
          evidencia: 'texto qualquer',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');
    });
  });

  it('discards a checklist suggestion that only re-confirms the job\'s current status, without writing a no-op history row', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Reconfirma Status Teste' });
      // createJob starts the job at "Prospecção" (order 1) in "Comercial e Orçamento".

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: job.statusName!,
          confidence: 0.95,
          evidencia: 'confirma que já estava feito',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');

      // Only the single initial row createJob writes should exist — a naive
      // re-apply would insert a second row and reset the alert-level clock.
      const history = await db.query<{ count: string }>(
        'SELECT count(*) FROM job_status_history WHERE job_id = $1',
        [job.id],
      );
      expect(Number(history.rows[0].count)).toBe(1);
    });
  });

  it('discards a bola-com suggestion that only re-confirms the side the ball is already with, without writing a no-op history row', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Reconfirma Bola Com Teste' });
      // createJob starts the job with bolaCom 'ilha'.

      const classifier = fakeClassifier([
        {
          tipo: 'bola_com',
          valor: 'ilha',
          confidence: 0.95,
          evidencia: 'confirma que a bola ainda está com a Ilha',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');

      // Only the single initial row recordInitialBolaCom writes should exist —
      // a naive re-apply would insert a second row and zero an in-progress streak.
      const history = await db.query<{ count: string }>(
        'SELECT count(*) FROM job_bola_com_history WHERE job_id = $1',
        [job.id],
      );
      expect(Number(history.rows[0].count)).toBe(1);
    });
  });

  it('discards a suggestion with a malformed (non-numeric) confidence instead of throwing', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Confidence Malformada Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: '0.9' as unknown as number,
          evidencia: 'texto',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');
    });
  });

  it('discards a suggestion with an unrecognized tipo instead of falling through to the bola_com branch', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Tipo Inválido Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'unknown_type' as unknown as 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.95,
          evidencia: 'texto',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');
    });
  });
});
