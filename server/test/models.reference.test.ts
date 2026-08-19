import { describe, it, expect } from 'vitest';
import { listPhasesWithStatuses } from '../src/models/reference';
import { withTestTransaction } from './helpers/testDb';

describe('listPhasesWithStatuses', () => {
  it('returns the 6 fixed phases in order, each with its statuses and roles', async () => {
    await withTestTransaction(async (db) => {
      const phases = await listPhasesWithStatuses(db);

      expect(phases).toHaveLength(6);
      expect(phases.map((p) => p.name)).toEqual([
        'Comercial e Orçamento',
        'Dotação Financeira e Burocracia (Set-up)',
        'Pré-Produção',
        'Captação (Set de Gravação)',
        'Pós-Produção',
        'Encerramento e Auditoria',
      ]);

      const fase1 = phases[0];
      expect(fase1.roles).toEqual(['Comercial', 'Produção Executiva']);
      expect(fase1.statuses.map((s) => s.name)).toEqual([
        'Prospecção',
        'Briefing Recebido',
        'Orçamento e Decupagem',
        'Defesa da Proposta',
      ]);
      expect(fase1.statuses[3].triggerLabel).toBe('Tocar a Buzina');
    });
  });
});
