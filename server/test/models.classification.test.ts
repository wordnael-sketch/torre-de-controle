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
});
