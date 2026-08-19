# Usuários, Papéis e Convite de Acesso — Ilha Crossmídia

**Data:** 2026-08-19
**Status:** Aprovado para planejamento de implementação
**Specs anteriores:** `2026-08-18-sistema-acompanhamento-jobs-design.md` (fundação),
`2026-08-19-kanban-fases-jobs-design.md` (Kanban) — esta spec substitui a decisão de
"usuário único" da spec da fundação por um modelo multiusuário com controle de acesso.

## 1. Contexto e Problema

O sistema foi construído com um modelo de usuário único: qualquer conta Google do
domínio `ilhacrossmidia.com.br` que fizesse login ganhava acesso completo e
automático (`findOrCreateUser` criava a conta na hora, sem aprovação). Isso foi uma
decisão deliberada do MVP, mas não reflete mais o plano real: outras pessoas da Ilha
vão eventualmente ocupar a função de Gerente de Projeto ou acompanhar jobs, e cada
uma delas vai precisar, no futuro, vincular suas próprias contas de WhatsApp e
Trello (integrações ainda não construídas). Isso exige que o acesso seja controlado
— não é desejável que qualquer e-mail `@ilhacrossmidia.com.br` ganhe acesso completo
automaticamente.

## 2. Objetivo

Introduzir um modelo de dois papéis (admin/member) com controle de acesso por
convite: só quem foi cadastrado antecipadamente por um admin consegue completar o
login. A Wilka nasce como a primeira admin do sistema.

## 3. Decisões de Escopo

- **Dois papéis**: `admin` e `member`. A única diferença funcional entre eles, por
  agora, é que só admin gerencia o acesso de outras pessoas (convidar, trocar papel,
  revogar). Fora isso, member tem o mesmo acesso operacional de hoje ao Kanban (ver e
  mexer em qualquer job) — não há restrição de visibilidade por responsável nesta
  spec.
- **Convite antes do login**: um admin cadastra o e-mail (e o papel) de uma pessoa
  *antes* dela logar. Um e-mail não convidado — mesmo sendo `@ilhacrossmidia.com.br`
  — é rejeitado ao tentar logar, sem criar conta.
- **Revogação**: um admin pode revogar o acesso de alguém já ativo. A pessoa revogada
  perde acesso imediatamente, mesmo que ainda tenha um cookie de sessão válido (a
  cada requisição autenticada, o sistema confirma que o status da conta ainda é
  ativo — não basta ter um token assinado válido).
- **Wilka nasce admin**: via seed no banco (mesmo padrão já usado para o pipeline de
  fases/pessoas do Kanban), sem precisar de nenhum passo manual de configuração.
- **Fora de escopo desta spec**: vínculo de WhatsApp/Trello por pessoa (mencionado
  como motivação, mas a integração em si ainda não existe no sistema — fica para uma
  spec futura); granularidade de permissão além de admin/member (ex: visibilidade
  restrita por job); qualquer fluxo de "esqueci minha senha" (login continua 100%
  via Google OAuth, sem senha própria do sistema).

## 4. Modelo de Dados

### 4.1 Extensão da tabela `users`

A tabela `users` (da spec da fundação) ganha:
- `role TEXT NOT NULL DEFAULT 'member'` — valores `'admin'` ou `'member'`.
- `status TEXT NOT NULL DEFAULT 'invited'` — valores `'invited'`, `'active'`,
  `'revoked'`.
- `google_sub` e `name` passam a ser **anuláveis** — uma conta convidada ainda não
  logou, então não tem `google_sub` (identificador do Google) nem `name` (só
  conhecido a partir do perfil Google no primeiro login).

Ciclo de vida de uma conta:
1. Admin convida por e-mail → linha criada com `status='invited'`, `google_sub` e
   `name` nulos.
2. Pessoa faz login com Google pela primeira vez → sistema confirma que o e-mail
   está convidado (ou já ativo), preenche `google_sub`/`name` a partir do perfil
   Google, muda `status` para `'active'`.
3. Admin pode revogar (`status='revoked'`) a qualquer momento — a pessoa não
   consegue mais logar nem usar uma sessão existente.
4. Admin pode reativar uma conta revogada (`status='active'`) sem precisar
   reconvidar.

### 4.2 Seed do primeiro admin

`schema.sql` insere (idempotente, `ON CONFLICT (email) DO NOTHING`, mesmo padrão do
Kanban): `wilka@ilhacrossmidia.com.br`, `role='admin'`, `status='invited'`. Ela ativa
a própria conta no primeiro login, exatamente como qualquer pessoa convidada — não
há caminho especial de bootstrap além deste seed.

## 5. Fluxo de Login (revisado)

`POST /api/auth/google`:
1. Verifica o ID token do Google (já existente).
2. Verifica se o e-mail é do domínio `ilhacrossmidia.com.br` (já existente) — se não
   for, `403 { error: 'domain_not_allowed' }`.
3. **Novo**: busca uma conta com esse e-mail. Se não existir, ou se existir com
   `status='revoked'`, `403 { error: 'not_invited' }` — nenhuma conta é criada.
4. Se existir com `status='invited'` ou `status='active'`: preenche/atualiza
   `google_sub`/`name`, marca `status='active'`, assina a sessão normalmente.

`GET /api/auth/me` e todas as rotas autenticadas (`/api/jobs/*`, `/api/reference`,
`/api/people*`): **novo** — além de validar o token de sessão (já existente),
confirmam no banco que a conta ainda está com `status='active'`. Uma conta revogada
com sessão ainda válida recebe `401` na próxima requisição, não só no próximo login.

## 6. Gerenciamento de Usuários (Admin)

Nova área, acessível só para `role='admin'`:
- **Listar usuários**: e-mail, nome (quando já ativou), papel, status.
- **Convidar**: e-mail (validado contra o domínio permitido) + papel inicial.
- **Trocar papel**: admin ↔ member para qualquer usuário.
- **Revogar / Reativar**: muda `status` entre `active` e `revoked`.

Um usuário `member` não vê nem acessa essa área (rota protegida por
`role='admin'`, não só por estar logado).

## 7. Testes

- Unidade: convite cria conta `invited` sem `google_sub`; ativação preenche
  `google_sub`/`name` e muda para `active`; revogação bloqueia login subsequente;
  reativação restaura acesso.
- Integração: login rejeitado (`not_invited`) para e-mail nunca convidado; login
  aceito e ativa conta para e-mail convidado; requisição autenticada com sessão
  válida mas conta revogada retorna 401; rotas de gerenciamento de usuários
  retornam 403 para `member`; fluxo completo convite → login → ativação.
