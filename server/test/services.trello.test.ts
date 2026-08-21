import { describe, it, expect, vi } from 'vitest';
import { createHttpTrelloClient } from '../src/services/trello';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('createHttpTrelloClient', () => {
  describe('listBoardCards', () => {
    it('joins cards with their list names', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/boards/board123/lists')) {
          return jsonResponse([
            { id: 'list1', name: 'Em Captação 2026' },
            { id: 'list2', name: 'Concluído' },
          ]);
        }
        if (url.includes('/boards/board123/cards')) {
          return jsonResponse([
            { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', idList: 'list1' },
            { id: 'card2', name: 'NOVA:: SESCOOP', idList: 'list2' },
          ]);
        }
        throw new Error(`unexpected URL: ${url}`);
      });

      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);
      const cards = await client.listBoardCards();

      expect(cards).toEqual([
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
        { id: 'card2', name: 'NOVA:: SESCOOP', listName: 'Concluído' },
      ]);
    });

    it('includes the api key and token as query params on every request', async () => {
      const fetchMock = vi.fn(async () => jsonResponse([]));
      const client = createHttpTrelloClient('my-key', 'my-token', 'board123', fetchMock as unknown as typeof fetch);

      await client.listBoardCards();

      const calledUrls = fetchMock.mock.calls.map((call) => call[0] as string);
      expect(calledUrls.length).toBeGreaterThan(0);
      expect(calledUrls.every((url) => url.includes('key=my-key') && url.includes('token=my-token'))).toBe(true);
    });
  });

  describe('getCard', () => {
    it('returns null for a 404 (deleted/invalid card)', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: 'not found' }, 404));
      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);

      const result = await client.getCard('missing-card');

      expect(result).toBeNull();
    });

    it('parses name, list name, checklist items, due date, comment, and members', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/cards/card1/actions')) {
          return jsonResponse([{ data: { text: 'Cliente aprovou o orçamento hoje' } }]);
        }
        return jsonResponse({
          name: 'WPP:: COLGATE:: CAMPANHA',
          due: '2026-08-28T00:00:00.000Z',
          list: { name: 'Em Captação 2026' },
          checklists: [
            {
              checkItems: [
                { name: 'Contrato assinado', state: 'complete' },
                { name: 'Equipamento reservado', state: 'incomplete' },
              ],
            },
          ],
          members: [{ fullName: 'Wilka Nepomoceno' }],
        });
      });

      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);
      const card = await client.getCard('card1');

      expect(card).toEqual({
        name: 'WPP:: COLGATE:: CAMPANHA',
        listName: 'Em Captação 2026',
        checklistItems: [
          { name: 'Contrato assinado', checked: true },
          { name: 'Equipamento reservado', checked: false },
        ],
        due: '2026-08-28T00:00:00.000Z',
        latestComment: 'Cliente aprovou o orçamento hoje',
        members: ['Wilka Nepomoceno'],
      });
    });

    it('returns latestComment null when there are no comments', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/actions')) {
          return jsonResponse([]);
        }
        return jsonResponse({
          name: 'Card sem comentário',
          due: null,
          list: { name: 'Em Orçamento 2026' },
          checklists: [],
          members: [],
        });
      });

      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);
      const card = await client.getCard('card2');

      expect(card?.latestComment).toBeNull();
    });

    it('throws on a non-404 error response, for the caller to handle', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: 'rate limited' }, 429));
      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);

      await expect(client.getCard('card1')).rejects.toThrow();
    });
  });
});
