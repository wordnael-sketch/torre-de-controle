export interface TrelloCardSummary {
  id: string;
  name: string;
  listName: string;
}

export interface TrelloChecklistItem {
  name: string;
  checked: boolean;
}

export interface TrelloComment {
  author: string;
  text: string;
  postedAt: string;
}

export interface TrelloLabel {
  name: string;
  color: string | null;
}

export interface TrelloCardDetail {
  name: string;
  listName: string;
  checklistItems: TrelloChecklistItem[];
  due: string | null;
  latestComment: string | null;
  members: string[];
  comments: TrelloComment[];
  description: string | null;
  url: string;
  labels: TrelloLabel[];
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

interface TrelloLabelResponse {
  name: string;
  color: string | null;
}

interface TrelloCardDetailResponse {
  name: string;
  due: string | null;
  desc: string | null;
  shortUrl: string;
  list?: { name: string };
  checklists?: TrelloChecklistResponse[];
  members?: TrelloMemberResponse[];
  labels?: TrelloLabelResponse[];
}

interface TrelloCommentActionResponse {
  date: string;
  data: { text: string };
  memberCreator?: { fullName: string };
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
          '&fields=name,due,desc,shortUrl&checklists=all&checklist_fields=name&list=true' +
          '&members=true&member_fields=fullName&labels=true',
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

      const commentActions = await trelloGet<TrelloCommentActionResponse[]>(
        `/cards/${cardId}/actions`,
        '&filter=commentCard&limit=30&member_creator=true&member_creator_fields=fullName',
      );
      // A API do Trello já retorna as actions da mais recente pra mais antiga.
      const comments: TrelloComment[] = commentActions.map((action) => ({
        author: action.memberCreator?.fullName ?? 'Desconhecido',
        text: action.data.text,
        postedAt: action.date,
      }));

      return {
        name: card.name,
        listName: card.list?.name ?? '',
        checklistItems,
        due: card.due,
        latestComment: comments[0]?.text ?? null,
        members: (card.members ?? []).map((m) => m.fullName),
        comments,
        description: card.desc || null,
        url: card.shortUrl,
        labels: (card.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
      };
    },
  };
}
