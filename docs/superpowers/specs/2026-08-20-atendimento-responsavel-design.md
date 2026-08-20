# Atendimento Responsável Obrigatório — Design Spec

**Data:** 2026-08-20
**Status:** aprovado, aguardando plano de implementação

## Contexto e motivação

O setor de Atendimento (liderado pela Head Wilka, com as executivas de
contas Camila, Andrea, Larissa, Karina, Isabela, Bianca e Renata) é a
"ponte" entre a Ilha Crossmídia, clientes e agências, presente do início
ao fim de um job: desde a definição da executiva responsável logo após o
fechamento da venda, passando pela burocracia (faturamento, contrato,
ANCINE), pré-produção (briefing, PPM), captação (recepção no set) e
pós-produção (tradução de feedback do cliente, aprovação final), até o
encerramento (NPS, liberação de divulgação).

Hoje o sistema já tem um mecanismo genérico de atribuição de pessoas a
papéis por fase (`job_role_assignments`), e "Atendimento" já é um dos
papéis usados — mas essa atribuição é **totalmente opcional**: nada
impede um job de existir, do início ao fim, sem nenhuma pessoa de
Atendimento atribuída. Além disso o papel só aparece em 2 das 6 fases
("Dotação e Burocracia" e "Pós-Produção"), quando na prática o Atendimento
acompanha o job inteiro, e só uma pessoa (Wilka) está cadastrada na área.

Este spec cobre: tornar o Atendimento um responsável único por job (não
mais por fase), exigi-lo na criação do job, permitir que qualquer usuário
logado o atribua/reatribua a qualquer momento, e cadastrar as executivas
que faltam.

## Direção confirmada

- **Responsável único por job**, não por fase: um campo novo em `jobs`,
  não mais uma linha em `job_role_assignments`. Definido uma vez (o
  mesmo mecanismo pelo qual a Wilka distribui a demanda assim que a venda
  fecha), vale para todas as fases do job.
- **Obrigatório desde a criação do job**: o formulário de criação e o
  endpoint `POST /api/jobs` passam a exigir a escolha de um Atendimento
  responsável; não é possível criar um job sem isso.
- **Jobs já existentes (os 27 importados de Trello/WhatsApp) não são
  bloqueados retroativamente**: continuam com o campo vazio até alguém
  preenchê-lo pela interface.
- **Qualquer usuário logado pode atribuir ou reatribuir** o Atendimento
  responsável a qualquer momento, em qualquer job — sem checagem de
  permissão além de estar autenticado (mesmo padrão de acesso já usado no
  resto do sistema). Uma vez definido, só pode ser trocado por outra
  pessoa da área Atendimento — não pode ser limpo de volta para vazio
  (mantém a garantia de que todo job com o campo preenchido continua
  preenchido).
- **Wilka (Head) e as executivas de contas ficam no mesmo grupo
  "Atendimento"**, com um campo de cargo (`title`) livre e opcional em
  `people`, só para diferenciação visual — sem hierarquia funcional nova
  no sistema (não afeta quem pode ser escolhido nem permissões).

## Modelo de dados

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS atendimento_person_id INTEGER REFERENCES people(id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS title TEXT;
```

- `jobs.atendimento_person_id`: aceita `NULL` no banco (necessário para
  não quebrar os 27 jobs já existentes) — a obrigatoriedade é imposta na
  validação do endpoint de criação, não por `NOT NULL`.
- `people.title`: texto livre e opcional, usado hoje só para "Head" (Wilka)
  e "Executiva de Contas" (as demais). Nenhuma outra área usa esse campo
  por enquanto; ele aparece na interface quando presente e é omitido
  quando `NULL`, sem exigir nada de outras áreas.
- **"Atendimento" sai de `phase_roles`**: remover as duas linhas
  (`'Dotação e Burocracia', 'Atendimento'` e `'Pós-Produção',
  'Atendimento'`) — deixa de ser um papel selecionável por fase, já que
  agora é um campo único do job. Qualquer linha existente em
  `job_role_assignments` com `area = 'Atendimento'` (não deve haver
  nenhuma nos 27 jobs reais, mas por segurança) é migrada: se o job ainda
  não tiver `atendimento_person_id`, copia o `person_id` daquela linha
  para lá; a linha antiga é então removida junto com a limpeza de
  `phase_roles`.

### Efeito colateral a observar (não é bug, é consequência esperada)

Várias `statuses.primary_role` já valem `'Atendimento'` (ex: "Atendimento
da conta definida", "Aprovação do Cliente"). O mecanismo de "pessoa em
destaque" do Board (`highlighted_person_name`, ver seção "Backend") hoje
busca esse nome em `job_role_assignments` filtrando por
`area = primary_role` **da fase atual**. Como Atendimento deixa de existir
nessa tabela, a subquery precisa passar a resolver esses casos a partir de
`jobs.atendimento_person_id` em vez de `job_role_assignments` — detalhado
abaixo. Sem esse ajuste, o nome em destaque no Board simplesmente some
para todo job cujo status atual tem `primary_role = 'Atendimento'`.

O checklist "Atendimento da conta definida" (fase Dotação e Burocracia)
continua existindo sem mudança de comportamento — como o Atendimento já é
escolhido na criação do job, esse marco tende a já estar satisfeito
informalmente bem antes de o job chegar a essa fase; isso é uma
consequência aceitável do novo fluxo, não algo que este spec precisa
resolver (o checklist continua sendo avançado manualmente, como hoje).

## Backend

### Criação do job (`POST /api/jobs`)

Payload passa a exigir `atendimentoPersonId: number`. Validação:
- Ausente ou não numérico → `400 { error: 'atendimentoPersonId is required' }`.
- `personId` não existe, ou existe mas não é da área `'Atendimento'`, ou
  está `active: false` → `400 { error: 'atendimentoPersonId must reference an active person in the Atendimento area' }`.

`createJob` (`server/src/models/job.ts`) passa a receber e gravar
`atendimentoPersonId` no `INSERT INTO jobs`.

### Reatribuição (`PATCH /api/jobs/:id/atendimento`)

Novo endpoint, mesmo padrão de autenticação dos demais
(`requireAuth` + `requireActiveUser`, sem checagem extra de papel/role de
usuário). Payload: `{ personId: number }` (sempre obrigatório — este
endpoint só reatribui, nunca limpa):
- `personId` ausente/não numérico → `400`.
- `personId` não existe, não é da área Atendimento, ou está inativo →
  `400` (mesma mensagem da criação).
- Job não encontrado → `404`.
- Sucesso → `200 { job: Job }` (job atualizado, mesmo formato de
  `GET /api/jobs/:id`).

### `highlighted_person_name` (Board — pessoa em destaque)

A subquery em `JOB_SELECT` (`server/src/models/job.ts`) que hoje resolve
`highlighted_person_name` via `job_role_assignments` passa a tratar o
caso `primary_role = 'Atendimento'` separadamente, puxando de
`jobs.atendimento_person_id → people.name` em vez da tabela de
atribuições por fase. Para todo outro `primary_role`, o comportamento
atual (via `job_role_assignments`) continua sem mudança.

### `GET /api/jobs/:id` (detalhe do job)

Resposta ganha `atendimentoPersonId: number | null` e
`atendimentoPersonName: string | null` (mesmo padrão de campos
"id + nome" já usado em outros lugares do payload de `Job`).

### `GET /api/people`

Resposta de cada pessoa ganha `title: string | null`.

## Frontend

### Criação do job (`Board.tsx`)

O formulário de novo job (`board-new-job-form`) ganha um `<select>`
obrigatório "Atendimento responsável", populado com
`people.filter(p => p.area === 'Atendimento' && p.active)`, ordenado por
nome. Sem seleção válida, o formulário não submete (mesma validação em
cliente que já existe para o nome do job) e mostra a mesma área de erro
(`board-error`) já usada pelo formulário.

Isso implica que `Board.tsx` passa a carregar `people` (hoje só
`JobDetail.tsx` carrega) — reaproveita `api.listPeople()`, já existente.

### Detalhe do job (`JobDetail.tsx`)

Novo bloco de destaque, logo abaixo do cabeçalho (`job-detail-header`) e
acima dos avisos de bola-com/atividade do WhatsApp — mesma posição de
prioridade visual dos avisos existentes:
- Mostra nome (+ cargo, se `title` presente) do Atendimento responsável.
- Um `<select>` (mesmo padrão do `job-detail-role-row` já usado para os
  outros papéis) permite reatribuir a qualquer momento, chamando o novo
  `api.setAtendimento(jobId, personId)`.
- Se `atendimentoPersonId` for `null` (só pode acontecer em job antigo,
  nunca em job novo) — mostra um aviso visual (mesma classe
  `job-detail-warning` usada para os outros alertas) chamando atenção
  para a ausência, com o próprio `<select>` funcionando como a forma de
  resolver.

O papel "Atendimento" some das linhas genéricas de papel por fase
(`phase.roles.map(...)`) automaticamente, já que deixou de existir em
`phase_roles` — nenhuma mudança de código extra necessária ali além da
migração de dados do backend.

### `api/client.ts`

- `Job`/`JobDetail`: novos campos `atendimentoPersonId: number | null`,
  `atendimentoPersonName: string | null`.
- `Person`: novo campo `title: string | null`.
- `createJob`: assinatura passa a exigir `atendimentoPersonId: number`.
- Novo método `setAtendimento: (id: number, personId: number) => request<{ job: Job }>(...)`
  chamando `PATCH /api/jobs/:id/atendimento`.

## Cadastro de pessoas (dado, não código)

```sql
INSERT INTO people (name, area, title) VALUES
  ('Camila', 'Atendimento', 'Executiva de Contas'),
  ('Andrea', 'Atendimento', 'Executiva de Contas'),
  ('Larissa (Brasília)', 'Atendimento', 'Executiva de Contas'),
  ('Karina', 'Atendimento', 'Executiva de Contas'),
  ('Isabela', 'Atendimento', 'Executiva de Contas'),
  ('Bianca (Brasília)', 'Atendimento', 'Executiva de Contas'),
  ('Renata (RJ)', 'Atendimento', 'Executiva de Contas')
ON CONFLICT (name, area) DO NOTHING;

UPDATE people SET title = 'Head' WHERE name = 'Wilka' AND area = 'Atendimento';
```

Nota: já existe uma pessoa `('Camila', 'Produção')` na tabela — a nova
`('Camila', 'Atendimento')` não colide, pois a chave única é
`(name, area)`, não `name` sozinho.

## Não-metas (fora de escopo deste spec)

- Não cria um sistema geral de hierarquia/cargos para outras áreas — só
  o campo `title` opcional, usado hoje apenas em Atendimento.
- Não adiciona filtro por Atendimento no Board nem coluna dedicada na
  tabela — só o destaque já existente via `highlightedPersonName` na
  busca e nos jobs travados, que passa a incluir Atendimento
  automaticamente pela mudança na subquery.
- Não mexe no checklist "Atendimento da conta definida" nem em nenhum
  outro status/checklist — comportamento de avanço de fase inalterado.
- Não implementa a auto-atribuição de Atendimento via membros do card do
  Trello — isso já está coberto pelo spec/plano separado da integração
  com Trello (`2026-08-20-integracao-trello-design.md`), que hoje
  descreve o preenchimento de áreas vazias em `job_role_assignments`;
  quando aquele plano for implementado, sua lógica de correspondência de
  nome precisará ser adaptada para escrever em
  `jobs.atendimento_person_id` em vez de `job_role_assignments` para a
  área Atendimento especificamente — apontado aqui para não ser
  esquecido, não resolvido neste spec.

## Testes (cobertura esperada, detalhada no plano)

- Backend: criação de job sem `atendimentoPersonId` → 400; com
  `personId` de outra área → 400; com `personId` inativo → 400; com
  `personId` válido → 201 e job criado com o campo preenchido.
  Reatribuição via `PATCH /:id/atendimento` — sucesso, pessoa inválida,
  job inexistente. `highlighted_person_name` resolvendo corretamente para
  um status com `primary_role = 'Atendimento'` a partir do novo campo.
- Frontend: formulário de criação bloqueia submit sem Atendimento
  selecionado; `JobDetail` mostra nome+cargo quando preenchido e aviso
  quando vazio; reatribuição via `<select>` chama `setAtendimento` e
  atualiza a tela.
