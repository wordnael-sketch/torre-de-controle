export interface TrelloCardSummary {
  id: string;
  name: string;
  listName: string;
}

export interface TrelloChecklistItem {
  name: string;
  checked: boolean;
}

export interface TrelloCardDetail {
  name: string;
  listName: string;
  checklistItems: TrelloChecklistItem[];
  due: string | null;
  latestComment: string | null;
  members: string[];
}

export interface TrelloClient {
  listBoardCards(): Promise<TrelloCardSummary[]>;
  getCard(cardId: string): Promise<TrelloCardDetail | null>;
}

type FetchFn = typeof fetch;

interface TrelloListResponse {
  id: string;
  name: string;
}

interface TrelloCardListResponse {
  id: string;
  name: string;
  idList: string;
}

interface TrelloCheckItemResponse {
  name: string;
  state: 'complete' | 'incomplete';
}

interface TrelloChecklistResponse {
  checkItems: TrelloCheckItemResponse[];
}

interface TrelloMemberResponse {
  fullName: string;
}

interface TrelloCardDetailResponse {
  name: string;
  due: string | null;
  list?: { name: string };
  checklists?: TrelloChecklistResponse[];
  members?: TrelloMemberResponse[];
}

interface TrelloCommentActionResponse {
  data: { text: string };
}

export function createHttpTrelloClient(
  apiKey: string,
  token: string,
  boardId: string,
  fetchImpl: FetchFn = fetch,
): TrelloClient {
  const authQuery = `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;

  async function trelloGet<T>(path: string, extraParams: string): Promise<T> {
    const res = await fetchImpl(`https://api.trello.com/1${path}?${authQuery}${extraParams}`);
    if (!res.ok) {
      throw new Error(`Trello API error ${res.status} on ${path}`);
    }
    return (await res.json()) as T;
  }

  return {
    async listBoardCards(): Promise<TrelloCardSummary[]> {
      const [lists, cards] = await Promise.all([
        trelloGet<TrelloListResponse[]>(`/boards/${boardId}/lists`, '&fields=name'),
        trelloGet<TrelloCardListResponse[]>(`/boards/${boardId}/cards`, '&fields=name,idList'),
      ]);
      const listNameById = new Map(lists.map((l) => [l.id, l.name]));
      return cards.map((card) => ({
        id: card.id,
        name: card.name,
        listName: listNameById.get(card.idList) ?? '',
      }));
    },

    async getCard(cardId: string): Promise<TrelloCardDetail | null> {
      const res = await fetchImpl(
        `https://api.trello.com/1/cards/${cardId}?${authQuery}` +
          '&fields=name,due&checklists=all&checklist_fields=name&list=true&members=true&member_fields=fullName',
      );

      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`Trello API error ${res.status} on /cards/${cardId}`);
      }

      const card = (await res.json()) as TrelloCardDetailResponse;

      const checklistItems: TrelloChecklistItem[] = (card.checklists ?? []).flatMap((checklist) =>
        checklist.checkItems.map((item) => ({
          name: item.name,
          checked: item.state === 'complete',
        })),
      );

      const comments = await trelloGet<TrelloCommentActionResponse[]>(
        `/cards/${cardId}/actions`,
        '&filter=commentCard&limit=1',
      );

      return {
        name: card.name,
        listName: card.list?.name ?? '',
        checklistItems,
        due: card.due,
        latestComment: comments[0]?.data.text ?? null,
        members: (card.members ?? []).map((m) => m.fullName),
      };
    },
  };
}
