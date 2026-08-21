import { describe, it, expect } from 'vitest';
import { findTrelloCandidates, extractStatusUpdates } from '../src/models/trelloMatch';
import type { TrelloComment } from '../src/services/trello';

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

describe('extractStatusUpdates', () => {
  function comment(overrides: Partial<TrelloComment>): TrelloComment {
    return { author: 'Alguém', text: '', postedAt: '2026-08-20T00:00:00.000Z', ...overrides };
  }

  it('keeps only comments that start with STATUS, with or without the pin emoji', () => {
    const comments = [
      comment({ text: '📌STATUS 20.08 às 13h51\nFilme em montagem.' }),
      comment({ text: 'Ficou ótimo, obrigado!' }),
      comment({ text: 'STATUS 19.08 às 14h40\nPrevisto envio no fim do dia.' }),
    ];

    const updates = extractStatusUpdates(comments);

    expect(updates).toEqual([
      { author: 'Alguém', text: '📌STATUS 20.08 às 13h51\nFilme em montagem.', postedAt: '2026-08-20T00:00:00.000Z' },
      {
        author: 'Alguém',
        text: 'STATUS 19.08 às 14h40\nPrevisto envio no fim do dia.',
        postedAt: '2026-08-20T00:00:00.000Z',
      },
    ]);
  });

  it('is case-insensitive', () => {
    const updates = extractStatusUpdates([comment({ text: 'status rápido: tudo certo' })]);
    expect(updates).toHaveLength(1);
  });

  it('does not match "status" in the middle of a sentence', () => {
    const updates = extractStatusUpdates([comment({ text: 'Qual o status disso?' })]);
    expect(updates).toEqual([]);
  });

  it('caps the result at the given limit, keeping the input order (newest first)', () => {
    const comments = Array.from({ length: 8 }, (_, i) => comment({ text: `STATUS item ${i}` }));

    const updates = extractStatusUpdates(comments, 5);

    expect(updates).toHaveLength(5);
    expect(updates[0].text).toBe('STATUS item 0');
  });

  it('returns an empty list when there are no comments', () => {
    expect(extractStatusUpdates([])).toEqual([]);
  });
});
