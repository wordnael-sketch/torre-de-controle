# Integração com Trello — Design Spec

**Data:** 2026-08-20
**Status:** aprovado, aguardando plano de implementação

## Contexto e motivação

A equipe da Ilha Crossmídia já organiza o trabalho no Trello, num único
board compartilhado ("ATENDIMENTO:: ILHA :: STATUS - 2026 É NOSSO!"): as
listas do board representam as fases do pipeline (Em Orçamento, Aguardando
Aprovação, Em Pré-Produção, Em Captação, Em Pós-Produção (Montagem), Em Pós
(Ajuste/Formatos), Em Aprovação (cliente), Saídas de Cópias, Aguardando
NF, Contrato Aguardando Assinatura, Concluído, Perdidos), e cada card é um
job, nomeado no padrão `CLIENTE :: PROJETO :: DESCRIÇÃO`. Cada card carrega
um checklist interno (tipicamente ~19 itens), prazo, comentários e
responsáveis.

Este spec cobre a leitura desses dados do Trello para alimentar
automaticamente o checklist e a fase de um job no Torre de Controle,
reaproveitando o classificador por IA já construído para a colagem manual
de mensagens do WhatsApp — sem escrever de volta no Trello, sem
interface visual do Trello dentro do sistema.

## Direção confirmada

- **Só leitura**: nunca escreve no Trello.
- **Um board só**, configurado uma vez no servidor (mesmo padrão do
  `ANTHROPIC_API_KEY`) — suportar múltiplos boards fica para uma fase
  futura, se necessário.
- **Credencial única da equipe** (API key + token do Trello), não OAuth
  por pessoa.
- **Vinculação automática por nome/código na primeira vez**, com
  confirmação manual quando a busca não é inequívoca; depois disso, a
  ligação fica salva e a busca por nome não roda de novo.
- **Sincronização automática toda vez que o job é aberto** (se já
  vinculado), passando os dados do card pelo mesmo classificador de IA
  que já processa o texto colado do WhatsApp — mesmas regras de
  confiança (≥0.85 auto-aplica, 0.60–0.84 vira sugestão pendente, <0.60
  descarta) e a mesma trava de nunca retroceder fase automaticamente.

## Modelo de dados

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_card_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_linked_at TIMESTAMPTZ;
```

Nenhuma tabela nova de histórico: as sugestões aplicadas a partir do
Trello passam pelos mesmos `setJobStatus`/`setBolaCom` já usados hoje, que
já gravam histórico com uma nota de evidência — a nota, nesse caso, é
derivada do texto montado a partir do card do Trello (ver seção
"Sincronização").

## Credenciais

Três novas variáveis em `server/.env` (nunca expostas ao frontend):

```
TRELLO_API_KEY=
TRELLO_TOKEN=
TRELLO_BOARD_ID=
```

Sem essas três configuradas, os novos endpoints (`/trello-candidates`,
`/trello-link`, `/trello-sync`) respondem `503`, exatamente como o
`/classify` já faz hoje quando `ANTHROPIC_API_KEY` não está configurada —
o sistema continua funcionando normalmente, só sem essa funcionalidade.

## Cliente Trello (backend)

Novo módulo `server/src/services/trello.ts`, espelhando a forma de
`server/src/services/classifier.ts`: uma interface `TrelloClient` com um
`createHttpTrelloClient(apiKey, token, boardId)`, que faz chamadas à API
REST do Trello (`https://api.trello.com/1/...`, autenticação via
query-string `key`/`token`, não headers) e expõe:

- `listBoardCards(): Promise<TrelloCardSummary[]>` — todos os cards do
  board configurado, com `id`, `name`, `listName`. Usado só na
  vinculação (busca por nome).
- `getCard(cardId: string): Promise<TrelloCardDetail | null>` — um card
  específico: `listName`, itens de checklist (`{ name, checked }[]`,
  agregando todos os checklists do card), `due` (prazo, opcional),
  `latestComment` (texto do comentário mais recente, opcional; a API do
  Trello expõe isso via `actions?filter=commentCard&limit=1`), `members`
  (nomes). Retorna `null` se o card não existe mais (foi apagado/movido
  pra outro board).

## Vinculação de um job a um card

**Endpoint:** `GET /api/jobs/:id/trello-candidates`

Chamado pelo frontend quando `job.trelloCardId` é nulo. Busca todos os
cards do board (`listBoardCards`), normaliza nomes (minúsculo, sem
acento/pontuação) e pontua cada card por sobreposição de palavras com
`job.name`/`job.client`/`job.code`. Retorna os candidatos ordenados por
pontuação (`{ id, name, listName }[]`, no máximo 10).

O frontend decide o que fazer com a lista:
- **Exatamente 1 candidato com pontuação forte** (definição exata na
  hora do plano: ex. todas as palavras do nome do job aparecem no nome
  do card) → vincula automaticamente, sem perguntar.
- **0 ou 2+ candidatos, ou 1 candidato fraco** → mostra a lista pro
  usuário escolher (ou "nenhum desses").

**Endpoint:** `POST /api/jobs/:id/trello-link`
Corpo: `{ trelloCardId: string | null }` (`null` desvincula). Grava
`trello_card_id` e `trello_linked_at` (ou limpa ambos).

## Sincronização (a cada abertura do job)

**Endpoint:** `POST /api/jobs/:id/trello-sync`

Só funciona se `job.trelloCardId` estiver preenchido. Passos:

1. `getCard(job.trelloCardId)`. Se retornar `null` (card sumiu), limpa o
   vínculo (`trello_card_id = NULL`) e responde `404
   { error: 'trello_card_not_found' }` — o frontend deve então oferecer
   vincular de novo.
2. Monta um texto de evidência a partir do card, por exemplo:
   ```
   Lista atual no Trello: Em Captação 2026
   Checklist do Trello:
   - [x] Contrato assinado
   - [x] Equipe confirmada
   - [ ] Equipamento reservado
   Prazo: 28 de agosto
   Comentário mais recente: "Cliente aprovou o orçamento hoje"
   ```
3. Chama a função **já existente** `classifyAndApply(db, classifier,
   jobId, textoDeEvidencia)` (de `server/src/models/classification.ts`,
   construída no plano de backend anterior) — nenhuma lógica nova de
   classificação, threshold ou proteção contra retrocesso: é o mesmo
   caminho de código que `POST /api/jobs/:id/classify` já usa para texto
   colado manualmente.
4. Responde `{ suggestions: ResolvedSuggestion[] }` — mesmo formato que
   `/classify` já retorna hoje.

Se `ANTHROPIC_API_KEY` não estiver configurada (o classificador de IA
propriamente dito, não o Trello), o `classifyAndApply` já lida com isso
hoje através da rota `/classify`; a rota `/trello-sync` deve verificar a
mesma condição e responder `503 { error: 'ia_nao_configurada' }` antes
de sequer chamar o Trello, para não gastar uma chamada de API à toa.

## Frontend (JobDetail)

- Ao montar a página: se `job.trelloCardId` for nulo, chama
  `GET /trello-candidates`; se vier exatamente 1 candidato forte, chama
  `POST /trello-link` automaticamente; senão, mostra um seletor simples
  (lista de cards encontrados + opção "nenhum desses / vincular
  depois").
- Se `job.trelloCardId` já estiver preenchido: chama
  `POST /trello-sync` automaticamente ao montar a página, e renderiza o
  resultado **reaproveitando o mesmo componente de sugestões** que já
  existe para a colagem manual do WhatsApp (lista "aplicado pela IA" +
  lista de pendentes com Aplicar/Descartar).
- Um indicador pequeno e discreto mostra "Vinculado ao card: `<nome>`",
  com uma ação para desvincular (`trello-link` com `null`).
- O painel de "Colar mensagens do WhatsApp" continua existindo,
  inalterado, como segunda via manual de alimentar o mesmo classificador.

## Erros e degradação

- Sem `TRELLO_API_KEY`/`TOKEN`/`BOARD_ID` configurados: `/trello-candidates`
  e `/trello-sync` respondem `503`; o frontend simplesmente não mostra
  nada relacionado a Trello (nem o indicador de vínculo, nem o seletor).
- Chamada à API do Trello falha (rede, limite de taxa, credencial
  inválida): resposta `502 { error: 'trello_api_error' }`; o frontend
  mostra um erro discreto, sem travar o resto da página.
- Card apagado/movido: tratado no passo 1 da sincronização (limpa o
  vínculo, pede pra vincular de novo).

## Fora de escopo (explícito)

- Qualquer escrita de volta no Trello (mover card, marcar checklist,
  comentar).
- Múltiplos boards.
- Conexão individual por usuário (OAuth pessoal do Trello).
- Webhooks do Trello (atualização em tempo real sem abrir o job) — a
  sincronização só acontece quando alguém abre a tela do job.
- Interface visual mostrando o board/cards do Trello dentro do sistema.

## Riscos e assunções

- A correspondência de fase (lista do Trello → fase do Torre de
  Controle) e a interpretação dos itens do checklist do Trello contra
  os 40 itens já cadastrados dependem inteiramente do classificador de
  IA — não há mapeamento determinístico. Isso já é o comportamento
  aceito para o WhatsApp; aqui só muda a origem do texto.
- A API do Trello permite no máximo ~300 requisições a cada 10s por
  token — para o volume desta equipe (dezenas de jobs, aberturas
  esporádicas), isso não deve ser um problema, mas fica registrado.
- Assume que o board configurado (`TRELLO_BOARD_ID`) é estável e não
  muda de estrutura radicalmente sem aviso — se as listas forem
  renomeadas, o classificador de IA ainda deve interpretar
  razoavelmente bem, já que não depende de nomes exatos.
