import type { TrelloCardDetail, TrelloCardSummary } from '../services/trello';

export interface TrelloCandidate {
  id: string;
  name: string;
  listName: string;
  strongMatch: boolean;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findTrelloCandidates(
  job: { name: string; client: string | null; code: string | null },
  cards: TrelloCardSummary[],
): TrelloCandidate[] {
  const jobWords = new Set(
    [job.name, job.client, job.code]
      .filter((v): v is string => Boolean(v && v.trim()))
      .flatMap((v) => normalize(v).split(' '))
      .filter((w) => w.length > 2),
  );

  if (jobWords.size === 0) {
    return [];
  }

  return cards
    .map((card) => {
      const cardWords = new Set(normalize(card.name).split(' ').filter((w) => w.length > 2));
      const matchedWords = [...jobWords].filter((w) => cardWords.has(w));
      return {
        id: card.id,
        name: card.name,
        listName: card.listName,
        score: matchedWords.length,
        strongMatch: matchedWords.length === jobWords.size,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ id, name, listName, strongMatch }) => ({ id, name, listName, strongMatch }));
}

export function buildTrelloEvidenceText(card: TrelloCardDetail): string {
  const lines = [`Lista atual no Trello: ${card.listName}`];

  if (card.checklistItems.length > 0) {
    const checklistLines = card.checklistItems
      .map((item) => `- [${item.checked ? 'x' : ' '}] ${item.name}`)
      .join('\n');
    lines.push('Checklist do Trello:', checklistLines);
  }

  if (card.due) {
    lines.push(`Prazo: ${new Date(card.due).toLocaleDateString('pt-BR')}`);
  }

  if (card.latestComment) {
    lines.push(`Comentário mais recente: "${card.latestComment}"`);
  }

  return lines.join('\n');
}
