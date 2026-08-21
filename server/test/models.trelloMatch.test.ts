import { describe, it, expect } from 'vitest';
import { findTrelloCandidates } from '../src/models/trelloMatch';

describe('findTrelloCandidates', () => {
  const cards = [
    { id: 'c1', name: 'WPP:: COLGATE:: CAMPANHA LW COLOR CORRECT WAVE 2', listName: 'Em Captação 2026' },
    { id: 'c2', name: 'NOVA:: SESCOOP:: LICITAÇÃO', listName: 'Em Pré-Produção 2026' },
    { id: 'c3', name: '6P:: BARÃO DE MAUÁ:: VESTIBULAR 2027', listName: 'Em Pós Produção' },
  ];

  it('finds a strong match when every job word appears in the card name', () => {
    const candidates = findTrelloCandidates(
      { name: 'Campanha Color Correct Wave 2', client: 'Colgate', code: null },
      cards,
    );

    expect(candidates[0].id).toBe('c1');
    expect(candidates[0].strongMatch).toBe(true);
  });

  it('does not mark a partial match as strong', () => {
    const candidates = findTrelloCandidates(
      { name: 'Vestibular 2028', client: 'Barão de Mauá', code: null },
      cards,
    );

    expect(candidates[0].id).toBe('c3');
    expect(candidates[0].strongMatch).toBe(false);
  });

  it('returns an empty list when nothing matches', () => {
    const candidates = findTrelloCandidates({ name: 'Job Sem Relação Nenhuma', client: null, code: null }, cards);

    expect(candidates).toEqual([]);
  });

  it('is accent- and case-insensitive', () => {
    const candidates = findTrelloCandidates(
      { name: 'campanha color correct wave 2', client: 'colgate', code: null },
      cards,
    );

    expect(candidates[0].id).toBe('c1');
  });

  it('caps results at 10 candidates', () => {
    const manyCards = Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`,
      name: `TESTE:: CLIENTE:: JOB ${i}`,
      listName: 'Em Orçamento 2026',
    }));

    const candidates = findTrelloCandidates({ name: 'Job', client: 'Cliente', code: null }, manyCards);

    expect(candidates.length).toBeLessThanOrEqual(10);
  });
});
