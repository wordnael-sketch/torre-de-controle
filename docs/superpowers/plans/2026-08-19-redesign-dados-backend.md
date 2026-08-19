# Redesign — Dados e Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expandir o modelo de dados e o backend para sustentar o redesign visual "Torre de Controle": checklist granular por fase, "bola com" (Ilha/cliente) com histórico, última atividade manual do grupo de WhatsApp, e classificação por IA de mensagens coladas manualmente.

**Architecture:** Extensão aditiva do schema Postgres existente (`server/src/db/schema.sql`, aplicado a cada boot via `createDb`), novos módulos de modelo (`bolaCom.ts`, `classification.ts`) e um novo serviço (`services/classifier.ts`) que chama a API da Anthropic do lado do servidor. Três novas rotas em `routes/jobs.ts`. Nenhuma mudança de frontend neste plano — é o pré-requisito de dados/API para o plano de redesign visual que vem depois.

**Tech Stack:** Node.js + Express + TypeScript, `pg`, `vitest` + `supertest`, `@anthropic-ai/sdk` (nova dependência).

**Spec:** [docs/superpowers/specs/2026-08-19-redesign-visual-torre-de-controle-design.md](../specs/2026-08-19-redesign-visual-torre-de-controle-design.md)

## Global Constraints

- Toda rota de `/api/jobs` continua atrás de `requireAuth` → `requireActiveUser` (já aplicado via `router.use` em `routes/jobs.ts` — não remover).
- Todo handler assíncrono (rota ou middleware) deve ser envolvido em `asyncHandler` (`server/src/utils/asyncHandler.ts`) — incidente real anterior: handler assíncrono sem wrap derrubou o processo.
- Toda escrita que precisa atualizar `jobs` E inserir uma linha de histórico correspondente deve ser atômica (uma única query com CTE `WITH ... UPDATE ... RETURNING id) INSERT ... SELECT ... FROM updated`), seguindo o padrão já usado em `applyStatusChange` (`server/src/models/job.ts:140-162`).
- A chave `ANTHROPIC_API_KEY` nunca é exposta ao frontend — só existe em `server/.env` e só é lida em `server/src/index.ts`.
- Testes rodam contra o Supabase real via `withTestTransaction` (`server/test/helpers/testDb.ts`), com `BEGIN`/`ROLLBACK` por teste — nunca usar mocks de banco nos testes de modelo/rota.
- Não há jobs reais em produção hoje (confirmado: só existe o job de teste `ZZ_PROBE_REVIEW_JOB`, id 562, criado por uma revisão de plano anterior) — a Task 1 assume isso e trava com erro explícito (`RAISE EXCEPTION`) se encontrar outros jobs, em vez de apagar dados silenciosamente.

---

### Task 1: Expandir e renomear phases/statuses (checklist granular)

**Files:**
- Modify: `server/src/db/schema.sql:84-202` (blocos de INSERT de `phases`, `phase_roles`, `statuses`)
- Modify: `server/test/schema.pipeline.test.ts`
- Modify: `server/test/models.reference.test.ts`
- Modify: `server/test/routes.jobs.test.ts:227-251` (teste "accepts an area containing a slash")

**Interfaces:**
- Consumes: nada de tasks anteriores (é a primeira task).
- Produces: 6 fases (3 renomeadas: "Dotação e Burocracia", "Captação", "Encerramento"; 3 mantidas: "Comercial e Orçamento", "Pré-Produção", "Pós-Produção") com 40 status no total (5, 8, 7, 6, 8, 6 por fase, nessa ordem). Nomes de status exatos usados pelas próximas tasks: nenhuma task depois desta referencia nomes de status específicos, só a estrutura genérica (`Status[]` de `listPhasesWithStatuses`).

- [ ] **Step 1: Substituir o bloco de seed de `phases`, `phase_roles` e `statuses` em `schema.sql`**

Substitua as linhas 84 a 202 de `server/src/db/schema.sql` (do `INSERT INTO phases` até o `ON CONFLICT (phase_id, "order") DO NOTHING;` final dos status) pelo bloco abaixo. Ele primeiro migra os dados antigos (guardado por um `IF EXISTS`, então roda uma única vez e depois vira no-op) e em seguida faz os inserts normais com `ON CONFLICT DO NOTHING`, do mesmo jeito que o resto do arquivo:

```sql
-- Migração única: expande os 25 status "bundled" originais em 40 marcos
-- individuais de checklist e renomeia 3 fases para o nome curto usado na UI.
-- Guardado por IF EXISTS: roda uma vez (quando a fase com o nome antigo ainda
-- existe) e depois vira no-op para sempre, como o resto deste arquivo.
DO $$
DECLARE
  other_jobs_count INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM phases WHERE name = 'Dotação Financeira e Burocracia (Set-up)') THEN
    SELECT count(*) INTO other_jobs_count FROM jobs WHERE name <> 'ZZ_PROBE_REVIEW_JOB';

    IF other_jobs_count > 0 THEN
      RAISE EXCEPTION 'Migração de status abortada: % job(s) reais além do probe de teste existem. Esta migração assume que não há jobs reais em uso ainda — resolva manualmente antes de reaplicar.', other_jobs_count;
    END IF;

    DELETE FROM job_role_assignments WHERE job_id IN (SELECT id FROM jobs);
    DELETE FROM job_status_history WHERE job_id IN (SELECT id FROM jobs);
    DELETE FROM jobs;
    DELETE FROM statuses;
    DELETE FROM phase_roles;
    DELETE FROM phases;
  END IF;
END $$;

INSERT INTO phases ("order", name) VALUES
  (1, 'Comercial e Orçamento'),
  (2, 'Dotação e Burocracia'),
  (3, 'Pré-Produção'),
  (4, 'Captação'),
  (5, 'Pós-Produção'),
  (6, 'Encerramento')
ON CONFLICT (name) DO NOTHING;

INSERT INTO phase_roles (phase_id, area)
SELECT p.id, v.area
FROM (VALUES
  ('Comercial e Orçamento', 'Comercial'),
  ('Comercial e Orçamento', 'Produção Executiva'),
  ('Dotação e Burocracia', 'Financeiro'),
  ('Dotação e Burocracia', 'Atendimento'),
  ('Dotação e Burocracia', 'Jurídico/Base'),
  ('Pré-Produção', 'Produção'),
  ('Pré-Produção', 'Criativo'),
  ('Pré-Produção', 'Locação/Elenco/Arte'),
  ('Captação', 'Técnica/Imagem'),
  ('Captação', 'Elétrica/Maquinaria'),
  ('Captação', 'Produção Executiva'),
  ('Captação', 'Financeiro'),
  ('Pós-Produção', 'Pós'),
  ('Pós-Produção', 'Atendimento'),
  ('Encerramento', 'Qualidade e RH'),
  ('Encerramento', 'Produção Executiva'),
  ('Encerramento', 'Marketing')
) AS v(phase_name, area)
JOIN phases p ON p.name = v.phase_name
ON CONFLICT (phase_id, area) DO NOTHING;

INSERT INTO statuses (phase_id, "order", name, action_required, trigger_label, primary_role)
SELECT p.id, v."order", v.name, v.action_required, v.trigger_label, v.primary_role
FROM (VALUES
  ('Comercial e Orçamento', 1, 'Prospecção',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Briefing Recebido', 'Comercial'),
  ('Comercial e Orçamento', 2, 'Briefing Recebido',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Carta Orçamentária/Tratamento criada', 'Comercial'),
  ('Comercial e Orçamento', 3, 'Carta Orçamentária/Tratamento criada',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Orçamento e Decupagem', 'Comercial'),
  ('Comercial e Orçamento', 4, 'Orçamento e Decupagem',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Defesa da Proposta', 'Produção Executiva'),
  ('Comercial e Orçamento', 5, 'Defesa da Proposta',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Tocar a Buzina', 'Comercial'),

  ('Dotação e Burocracia', 1, 'Dotação orçamentária aprovada pelo CEO',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Avançar para: Planilhas travadas pelo Head-Financeiro', 'Financeiro'),
  ('Dotação e Burocracia', 2, 'Planilhas travadas pelo Head-Financeiro',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Avançar para: Atendimento da conta definida', 'Financeiro'),
  ('Dotação e Burocracia', 3, 'Atendimento da conta definida',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Avançar para: Assistente de Direção definido', 'Atendimento'),
  ('Dotação e Burocracia', 4, 'Assistente de Direção definido',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Avançar para: Contrato assinado pelo cliente', 'Atendimento'),
  ('Dotação e Burocracia', 5, 'Contrato assinado pelo cliente',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Avançar para: Nota Fiscal emitida', 'Jurídico/Base'),
  ('Dotação e Burocracia', 6, 'Nota Fiscal emitida',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Avançar para: Grupos de WhatsApp criados (Executivo, Pós e Geral)', 'Financeiro'),
  ('Dotação e Burocracia', 7, 'Grupos de WhatsApp criados (Executivo, Pós e Geral)',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Avançar para: Pré-cadastro na ANCINE iniciado', 'Atendimento'),
  ('Dotação e Burocracia', 8, 'Pré-cadastro na ANCINE iniciado',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD), Jurídico aprova o contrato, e a Nota Fiscal e os grupos de WhatsApp são organizados antes do início da produção.',
    'Contrato assinado anexado no Drive e pastas movidas para "Em execução"', 'Jurídico/Base'),

  ('Pré-Produção', 1, 'Reunião de Briefing',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Contratações (Logística/Freelas)', 'Produção'),
  ('Pré-Produção', 2, 'Contratações (Logística/Freelas)',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Estética aprovada na PPM', 'Produção'),
  ('Pré-Produção', 3, 'Estética aprovada na PPM',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Seguros emitidos', 'Criativo'),
  ('Pré-Produção', 4, 'Seguros emitidos',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: PPM aprovada pelo cliente', 'Produção'),
  ('Pré-Produção', 5, 'PPM aprovada pelo cliente',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Ordem do Dia (OD) elaborada', 'Criativo'),
  ('Pré-Produção', 6, 'Ordem do Dia (OD) elaborada',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: OD enviada com 24h de antecedência', 'Criativo'),
  ('Pré-Produção', 7, 'OD enviada com 24h de antecedência',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Assistente de Direção (AD) envia a Ordem do Dia (OD) com 24h de antecedência', 'Criativo'),

  ('Captação', 1, 'Pré-Light',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Em Captação', 'Elétrica/Maquinaria'),
  ('Captação', 2, 'Em Captação',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Desmontagem', 'Técnica/Imagem'),
  ('Captação', 3, 'Desmontagem',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Backup em HD realizado (Logger)', 'Elétrica/Maquinaria'),
  ('Captação', 4, 'Backup em HD realizado (Logger)',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Prestação de Contas', 'Técnica/Imagem'),
  ('Captação', 5, 'Prestação de Contas',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: "Realizado" finalizado pela Produção', 'Produção Executiva'),
  ('Captação', 6, '"Realizado" finalizado pela Produção',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Logger realiza backup em HD e Produção finaliza o "Realizado"', 'Produção Executiva'),

  ('Pós-Produção', 1, 'Ingest / Decupagem',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Montagem', 'Pós'),
  ('Pós-Produção', 2, 'Montagem',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Cor', 'Pós'),
  ('Pós-Produção', 3, 'Cor',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Motion', 'Pós'),
  ('Pós-Produção', 4, 'Motion',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: QC Interno', 'Pós'),
  ('Pós-Produção', 5, 'QC Interno',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Aprovação do Cliente', 'Pós'),
  ('Pós-Produção', 6, 'Aprovação do Cliente',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: De Acordo / Aceite Final do cliente', 'Atendimento'),
  ('Pós-Produção', 7, 'De Acordo / Aceite Final do cliente',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Libras/Legendas finalizados', 'Atendimento'),
  ('Pós-Produção', 8, 'Libras/Legendas finalizados',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Cliente dá o "De Acordo/Aceite Final" e recursos como Libras/Legendas são finalizados', 'Pós'),

  ('Encerramento', 1, 'Entrega Final (Mestres)',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Material enviado para Cold Storage', 'Qualidade e RH'),
  ('Encerramento', 2, 'Material enviado para Cold Storage',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Pesquisa NPS enviada/respondida', 'Qualidade e RH'),
  ('Encerramento', 3, 'Pesquisa NPS enviada/respondida',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Fechamento Orçado x Dotado x Realizado', 'Qualidade e RH'),
  ('Encerramento', 4, 'Fechamento Orçado x Dotado x Realizado',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Arquivamento', 'Produção Executiva'),
  ('Encerramento', 5, 'Arquivamento',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Todos os checkboxes preenchidos — Job concluído', 'Qualidade e RH'),
  ('Encerramento', 6, 'Todos os checkboxes preenchidos — Job concluído',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Todos os checkboxes preenchidos — Job concluído', 'Qualidade e RH')
) AS v(phase_name, "order", name, action_required, trigger_label, primary_role)
JOIN phases p ON p.name = v.phase_name
ON CONFLICT (phase_id, "order") DO NOTHING;
```

- [ ] **Step 2: Atualizar `server/test/schema.pipeline.test.ts`**

Substitua o conteúdo do arquivo inteiro por:

```typescript
import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db';

describe('pipeline schema', () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required to run this test');
  }

  it('seeds exactly the 6 fixed phases in order', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ order: number; name: string }>(
        'SELECT "order", name FROM phases ORDER BY "order"',
      );
      expect(result.rows).toEqual([
        { order: 1, name: 'Comercial e Orçamento' },
        { order: 2, name: 'Dotação e Burocracia' },
        { order: 3, name: 'Pré-Produção' },
        { order: 4, name: 'Captação' },
        { order: 5, name: 'Pós-Produção' },
        { order: 6, name: 'Encerramento' },
      ]);
    } finally {
      await db.end();
    }
  });

  it('seeds exactly 40 statuses across the 6 phases, each with a valid primary_role', async () => {
    const db = await createDb(connectionString);
    try {
      const countResult = await db.query<{ count: string }>('SELECT count(*) FROM statuses');
      expect(Number(countResult.rows[0].count)).toBe(40);

      const orphanRoles = await db.query(
        `SELECT s.id FROM statuses s
         WHERE NOT EXISTS (
           SELECT 1 FROM phase_roles pr WHERE pr.phase_id = s.phase_id AND pr.area = s.primary_role
         )`,
      );
      expect(orphanRoles.rows).toEqual([]);
    } finally {
      await db.end();
    }
  });

  it('seeds each phase with its documented checklist item count', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ name: string; count: string }>(
        `SELECT p.name, count(s.id) AS count
         FROM phases p
         JOIN statuses s ON s.phase_id = p.id
         GROUP BY p.name, p."order"
         ORDER BY p."order"`,
      );
      expect(result.rows.map((r) => ({ name: r.name, count: Number(r.count) }))).toEqual([
        { name: 'Comercial e Orçamento', count: 5 },
        { name: 'Dotação e Burocracia', count: 8 },
        { name: 'Pré-Produção', count: 7 },
        { name: 'Captação', count: 6 },
        { name: 'Pós-Produção', count: 8 },
        { name: 'Encerramento', count: 6 },
      ]);
    } finally {
      await db.end();
    }
  });

  it('seeds at least 38 people across the pre-loaded areas', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ count: string }>('SELECT count(*) FROM people');
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(38);
    } finally {
      await db.end();
    }
  });

  it('adds status_id and completed_at columns to jobs', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'jobs'
           AND column_name IN ('status_id', 'completed_at')`,
      );
      const names = result.rows.map((r) => r.column_name).sort();
      expect(names).toEqual(['completed_at', 'status_id']);
    } finally {
      await db.end();
    }
  });
});
```

- [ ] **Step 3: Atualizar `server/test/models.reference.test.ts`**

Substitua o conteúdo do arquivo inteiro por:

```typescript
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
        'Dotação e Burocracia',
        'Pré-Produção',
        'Captação',
        'Pós-Produção',
        'Encerramento',
      ]);

      const fase1 = phases[0];
      expect(fase1.roles).toEqual(['Comercial', 'Produção Executiva']);
      expect(fase1.statuses.map((s) => s.name)).toEqual([
        'Prospecção',
        'Briefing Recebido',
        'Carta Orçamentária/Tratamento criada',
        'Orçamento e Decupagem',
        'Defesa da Proposta',
      ]);
      expect(fase1.statuses[4].triggerLabel).toBe('Tocar a Buzina');
    });
  });
});
```

- [ ] **Step 4: Atualizar o teste de área com barra em `server/test/routes.jobs.test.ts`**

No arquivo `server/test/routes.jobs.test.ts`, dentro do bloco `describe('PUT /api/jobs/:id/roles/:area', ...)`, substitua o teste `'accepts an area containing a slash when the client encodes it'` (linhas 227-251) por:

```typescript
  it('accepts an area containing a slash when the client encodes it', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      // Job starts in Fase 1, which doesn't have "Jurídico/Base" — move it to
      // Fase 2 first (which does) via the manual status route.
      const created = await agent.post('/api/jobs').send({ name: 'Job Área Com Barra Teste' });
      const fase2Status = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Contrato assinado pelo cliente'`,
      );
      await agent.post(`/api/jobs/${created.body.job.id}/status`).send({ statusId: fase2Status.rows[0].id });

      const personRow = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Carol' AND area = 'Jurídico/Base'`,
      );

      const res = await agent
        .put(`/api/jobs/${created.body.job.id}/roles/${encodeURIComponent('Jurídico/Base')}`)
        .send({ personId: personRow.rows[0].id });

      expect(res.status).toBe(200);
      expect(res.body.roleAssignment.personName).toBe('Carol');
    });
  });
```

- [ ] **Step 5: Rodar a suíte inteira do servidor e confirmar que passa**

Run: `cd server && npm test`
Expected: todos os testes passam, incluindo os 3 arquivos alterados acima. Preste atenção especial a qualquer teste em `models.job.test.ts` ou `models.jobStatusHistory.test.ts` que falhe por depender de um nome de status — eles não deveriam quebrar (os nomes que usam — 'Prospecção', 'Briefing Recebido', 'Aprovação PPM', 'Defesa da Proposta', 'Arquivamento' — não existem mais como está: **atenção**, 'Arquivamento' e 'Aprovação PPM' foram renomeados/removidos nesta migração (ver lista de status acima: o último status de Encerramento agora se chama 'Todos os checkboxes preenchidos — Job concluído', e Pré-Produção não tem mais 'Aprovação PPM', tem 'PPM aprovada pelo cliente'). Se `npm test` apontar falhas nesses dois arquivos, corrija as strings citadas para os nomes novos (`'Todos os checkboxes preenchidos — Job concluído'` no lugar de `'Arquivamento'`, `'PPM aprovada pelo cliente'` no lugar de `'Aprovação PPM'`) antes de prosseguir — isso não estava previsto no escopo original do plano, mas é uma consequência direta da renomeação e deve ser corrigido aqui, não deixado quebrado.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/schema.sql server/test/schema.pipeline.test.ts server/test/models.reference.test.ts server/test/routes.jobs.test.ts server/test/models.job.test.ts server/test/models.jobStatusHistory.test.ts
git commit -m "feat(db): expand statuses into granular per-phase checklist items"
```

(Inclua `models.job.test.ts` e `models.jobStatusHistory.test.ts` no commit apenas se você precisou editá-los no Step 5.)

---

### Task 2: Bola com (Ilha/Cliente) — coluna, histórico e endpoint

**Files:**
- Modify: `server/src/db/schema.sql` (adicionar ao final do arquivo, após o bloco de `people`)
- Create: `server/src/models/bolaCom.ts`
- Modify: `server/src/models/job.ts`
- Modify: `server/src/routes/jobs.ts`
- Create: `server/test/models.bolaCom.test.ts`
- Modify: `server/test/routes.jobs.test.ts` (novo describe para a rota)

**Interfaces:**
- Consumes: `AppDatabase` de `server/src/db/index.ts`; padrão de CTE atômico de `applyStatusChange` (`server/src/models/job.ts:140-162`).
- Produces: `setBolaCom(db, jobId, bolaCom, note?): Promise<void>`; `getBolaComDayCounts(db, jobId, now?): Promise<BolaComDayCounts>` com `{ ilhaDays: number; clienteDays: number; currentSide: 'ilha' | 'cliente'; currentStreakDays: number }`; `Job.bolaCom: 'ilha' | 'cliente'` (novo campo no tipo já existente `Job`).

- [ ] **Step 1: Adicionar a coluna e a tabela de histórico ao schema**

No final de `server/src/db/schema.sql` (depois do bloco `INSERT INTO people (...) ON CONFLICT (name, area) DO NOTHING;`), adicione:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bola_com TEXT NOT NULL DEFAULT 'ilha'
  CHECK (bola_com IN ('ilha', 'cliente'));

CREATE TABLE IF NOT EXISTS job_bola_com_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  bola_com TEXT NOT NULL CHECK (bola_com IN ('ilha', 'cliente')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);
```

- [ ] **Step 2: Escrever o teste que falha para o novo módulo**

Crie `server/test/models.bolaCom.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { setBolaCom, getBolaComDayCounts } from '../src/models/bolaCom';
import { withTestTransaction } from './helpers/testDb';

describe('bola com', () => {
  it('defaults a new job to "ilha" with a zero-day streak', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bola Com Padrão Teste' });

      expect(job.bolaCom).toBe('ilha');

      const counts = await getBolaComDayCounts(db, job.id);
      expect(counts.currentSide).toBe('ilha');
      expect(counts.currentStreakDays).toBe(0);
    });
  });

  it('setBolaCom switches the current side and records history', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bola Com Troca Teste' });

      await setBolaCom(db, job.id, 'cliente', 'Cliente pediu ajustes');

      const counts = await getBolaComDayCounts(db, job.id);
      expect(counts.currentSide).toBe('cliente');
    });
  });

  it('accumulates days on each side across multiple switches', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bola Com Acumulado Teste' });

      // Força timestamps de histórico no passado para simular dias decorridos,
      // já que o teste roda em segundos, não em dias reais.
      await db.query(
        `UPDATE job_bola_com_history SET changed_at = now() - interval '5 days' WHERE job_id = $1`,
        [job.id],
      );
      await db.query(
        `INSERT INTO job_bola_com_history (job_id, bola_com, changed_at)
         VALUES ($1, 'cliente', now() - interval '2 days')`,
        [job.id],
      );

      const counts = await getBolaComDayCounts(db, job.id);

      expect(counts.ilhaDays).toBe(3);
      expect(counts.clienteDays).toBe(2);
      expect(counts.currentSide).toBe('cliente');
      expect(counts.currentStreakDays).toBe(2);
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd server && npx vitest run test/models.bolaCom.test.ts`
Expected: FAIL — `Cannot find module '../src/models/bolaCom'`.

- [ ] **Step 4: Criar `server/src/models/bolaCom.ts`**

```typescript
import type { AppDatabase } from '../db';

export type BolaCom = 'ilha' | 'cliente';

export interface BolaComDayCounts {
  ilhaDays: number;
  clienteDays: number;
  currentSide: BolaCom;
  currentStreakDays: number;
}

interface HistoryRow {
  bola_com: BolaCom;
  changed_at: string | Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function setBolaCom(
  db: AppDatabase,
  jobId: number,
  bolaCom: BolaCom,
  note?: string,
): Promise<void> {
  await db.query(
    `WITH updated AS (
       UPDATE jobs SET bola_com = $1, updated_at = now() WHERE id = $2
       RETURNING id
     )
     INSERT INTO job_bola_com_history (job_id, bola_com, note)
     SELECT id, $1, $3 FROM updated`,
    [bolaCom, jobId, note ?? null],
  );
}

export async function recordInitialBolaCom(db: AppDatabase, jobId: number): Promise<void> {
  await db.query(
    `INSERT INTO job_bola_com_history (job_id, bola_com) VALUES ($1, 'ilha')`,
    [jobId],
  );
}

export async function getBolaComDayCounts(
  db: AppDatabase,
  jobId: number,
  now: Date = new Date(),
): Promise<BolaComDayCounts> {
  const result = await db.query<HistoryRow>(
    'SELECT bola_com, changed_at FROM job_bola_com_history WHERE job_id = $1 ORDER BY changed_at ASC, id ASC',
    [jobId],
  );

  const rows = result.rows.map((row) => ({
    bolaCom: row.bola_com,
    changedAt: new Date(row.changed_at),
  }));

  let ilhaMs = 0;
  let clienteMs = 0;

  for (let i = 0; i < rows.length; i++) {
    const start = rows[i].changedAt;
    const end = i + 1 < rows.length ? rows[i + 1].changedAt : now;
    const durationMs = end.getTime() - start.getTime();
    if (rows[i].bolaCom === 'ilha') {
      ilhaMs += durationMs;
    } else {
      clienteMs += durationMs;
    }
  }

  const last = rows[rows.length - 1];
  const currentSide: BolaCom = last?.bolaCom ?? 'ilha';
  const currentStreakDays = last ? Math.floor((now.getTime() - last.changedAt.getTime()) / MS_PER_DAY) : 0;

  return {
    ilhaDays: Math.floor(ilhaMs / MS_PER_DAY),
    clienteDays: Math.floor(clienteMs / MS_PER_DAY),
    currentSide,
    currentStreakDays,
  };
}
```

- [ ] **Step 5: Rodar o teste de novo e ver passar**

Run: `cd server && npx vitest run test/models.bolaCom.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Ligar `bola_com` ao tipo `Job` e inicializar no `createJob`**

Em `server/src/models/job.ts`, adicione o import no topo do arquivo:

```typescript
import { recordInitialBolaCom } from './bolaCom';
```

Na interface `Job` (linhas 5-19), adicione o campo depois de `highlightedPersonName`:

```typescript
  highlightedPersonName: string | null;
  bolaCom: 'ilha' | 'cliente';
```

Na interface `JobRow` (linhas 21-34), adicione depois de `highlighted_person_name`:

```typescript
  highlighted_person_name: string | null;
  bola_com: 'ilha' | 'cliente';
```

Em `rowToJob` (linhas 55-74), adicione ao objeto retornado, depois de `highlightedPersonName`:

```typescript
    highlightedPersonName: row.highlighted_person_name,
    bolaCom: row.bola_com,
```

Em `createJob` (linhas 99-119), adicione a chamada de inicialização depois que o job é criado, antes do `return`:

```typescript
export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Promise<Job> {
  const firstStatusId = await getFirstStatusId(db);

  const inserted = await db.query<{ id: number }>(
    `WITH new_job AS (
       INSERT INTO jobs (name, code, client, status_id) VALUES ($1, $2, $3, $4) RETURNING id
     ), history AS (
       INSERT INTO job_status_history (job_id, from_status_id, to_status_id)
       SELECT id, NULL, $4 FROM new_job
     )
     SELECT id FROM new_job`,
    [input.name, input.code ?? null, input.client ?? null, firstStatusId],
  );

  const jobId = inserted.rows[0].id;
  await recordInitialBolaCom(db, jobId);
  const job = await getJobById(db, jobId);
  return job!;
}
```

Note que `JOB_SELECT` já usa `j.*` (linha 38), então `bola_com` aparece automaticamente na query — não precisa editar `JOB_SELECT`.

- [ ] **Step 7: Rodar a suíte de modelo de job e confirmar que nada quebrou**

Run: `cd server && npx vitest run test/models.job.test.ts test/models.bolaCom.test.ts`
Expected: PASS em todos.

- [ ] **Step 8: Adicionar a rota `PATCH /api/jobs/:id/bola-com`**

Em `server/src/routes/jobs.ts`, atualize o import do topo:

```typescript
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus } from '../models/job';
import { setBolaCom, getBolaComDayCounts } from '../models/bolaCom';
```

Adicione a rota depois do bloco `router.put('/:id/roles/:area', ...)` (antes do `return router;` final):

```typescript
  router.patch(
    '/:id/bola-com',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const { bolaCom } = req.body as { bolaCom?: string };
      if (bolaCom !== 'ilha' && bolaCom !== 'cliente') {
        res.status(400).json({ error: 'bolaCom must be "ilha" or "cliente"' });
        return;
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      await setBolaCom(deps.db, jobId, bolaCom);
      const job = await getJobById(deps.db, jobId);
      const bolaComDayCounts = await getBolaComDayCounts(deps.db, jobId);
      res.json({ job, bolaComDayCounts });
    }),
  );
```

Também inclua `bolaComDayCounts` na resposta de `GET /:id`. No handler existente de `router.get('/:id', ...)`, troque:

```typescript
      const [statusRow, roleAssignments, statusHistory] = await Promise.all([
        deps.db.query<{ action_required: string; trigger_label: string }>(
          'SELECT action_required, trigger_label FROM statuses WHERE id = $1',
          [job.statusId],
        ),
        job.phaseId ? getJobRoleAssignments(deps.db, jobId, job.phaseId) : Promise.resolve([]),
        getJobStatusHistory(deps.db, jobId),
      ]);

      res.json({
        job: {
          ...job,
          actionRequired: statusRow.rows[0]?.action_required ?? null,
          triggerLabel: statusRow.rows[0]?.trigger_label ?? null,
          roleAssignments,
          statusHistory,
        },
      });
```

por:

```typescript
      const [statusRow, roleAssignments, statusHistory, bolaComDayCounts] = await Promise.all([
        deps.db.query<{ action_required: string; trigger_label: string }>(
          'SELECT action_required, trigger_label FROM statuses WHERE id = $1',
          [job.statusId],
        ),
        job.phaseId ? getJobRoleAssignments(deps.db, jobId, job.phaseId) : Promise.resolve([]),
        getJobStatusHistory(deps.db, jobId),
        getBolaComDayCounts(deps.db, jobId),
      ]);

      res.json({
        job: {
          ...job,
          actionRequired: statusRow.rows[0]?.action_required ?? null,
          triggerLabel: statusRow.rows[0]?.trigger_label ?? null,
          roleAssignments,
          statusHistory,
          bolaComDayCounts,
        },
      });
```

- [ ] **Step 9: Escrever os testes de rota**

Em `server/test/routes.jobs.test.ts`, adicione ao final do arquivo (antes da última chave de fechamento, ou seja, como um novo `describe` no nível superior, depois do `describe('error handling on jobs routes', ...)`):

```typescript
describe('PATCH /api/jobs/:id/bola-com', () => {
  it('switches bola-com and returns updated day counts', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Bola Com Rota Teste' });
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/bola-com`)
        .send({ bolaCom: 'cliente' });

      expect(res.status).toBe(200);
      expect(res.body.job.bolaCom).toBe('cliente');
      expect(res.body.bolaComDayCounts.currentSide).toBe('cliente');
    });
  });

  it('rejects an invalid bolaCom value', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Bola Com Inválida Teste' });
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/bola-com`)
        .send({ bolaCom: 'terceiro' });

      expect(res.status).toBe(400);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.patch('/api/jobs/999999999/bola-com').send({ bolaCom: 'ilha' });

      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 10: Rodar a suíte inteira**

Run: `cd server && npm test`
Expected: todos os testes passam.

- [ ] **Step 11: Commit**

```bash
git add server/src/db/schema.sql server/src/models/bolaCom.ts server/src/models/job.ts server/src/routes/jobs.ts server/test/models.bolaCom.test.ts server/test/routes.jobs.test.ts
git commit -m "feat(jobs): add bola-com (ilha/cliente) tracking with day-count history"
```

---

### Task 3: Última atividade do grupo de WhatsApp (campo manual)

**Files:**
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/models/job.ts`
- Modify: `server/src/routes/jobs.ts`
- Modify: `server/test/routes.jobs.test.ts`

**Interfaces:**
- Consumes: `Job` de `server/src/models/job.ts` (Task 2).
- Produces: `Job.lastWhatsappActivityAt: string | null`; `setLastWhatsappActivity(db, jobId, value): Promise<void>` em `server/src/models/job.ts`.

- [ ] **Step 1: Adicionar a coluna ao schema**

No final de `server/src/db/schema.sql`, depois do bloco adicionado na Task 2, adicione:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_whatsapp_activity_at TIMESTAMPTZ;
```

- [ ] **Step 2: Ligar o campo ao tipo `Job`**

Em `server/src/models/job.ts`, na interface `Job`, adicione depois de `bolaCom`:

```typescript
  bolaCom: 'ilha' | 'cliente';
  lastWhatsappActivityAt: string | null;
```

Na interface `JobRow`, adicione depois de `bola_com`:

```typescript
  bola_com: 'ilha' | 'cliente';
  last_whatsapp_activity_at: string | Date | null;
```

Em `rowToJob`, adicione ao objeto retornado, depois de `bolaCom: row.bola_com,`:

```typescript
    bolaCom: row.bola_com,
    lastWhatsappActivityAt: row.last_whatsapp_activity_at
      ? new Date(row.last_whatsapp_activity_at).toISOString()
      : null,
```

Adicione a função de atualização no final do arquivo `server/src/models/job.ts`:

```typescript
export async function setLastWhatsappActivity(
  db: AppDatabase,
  jobId: number,
  value: string | null,
): Promise<void> {
  await db.query('UPDATE jobs SET last_whatsapp_activity_at = $1, updated_at = now() WHERE id = $2', [
    value,
    jobId,
  ]);
}
```

- [ ] **Step 3: Adicionar a rota `PATCH /api/jobs/:id/last-activity`**

Em `server/src/routes/jobs.ts`, atualize o import:

```typescript
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus, setLastWhatsappActivity } from '../models/job';
```

Adicione a rota depois da rota `PATCH /:id/bola-com` criada na Task 2:

```typescript
  router.patch(
    '/:id/last-activity',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      const { lastWhatsappActivityAt } = req.body as { lastWhatsappActivityAt?: string | null };

      if (lastWhatsappActivityAt !== null && lastWhatsappActivityAt !== undefined) {
        const parsed = new Date(lastWhatsappActivityAt);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'lastWhatsappActivityAt must be a valid ISO date string or null' });
          return;
        }
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      await setLastWhatsappActivity(deps.db, jobId, lastWhatsappActivityAt ?? null);
      const job = await getJobById(deps.db, jobId);
      res.json({ job });
    }),
  );
```

- [ ] **Step 4: Escrever os testes de rota**

Em `server/test/routes.jobs.test.ts`, adicione ao final do arquivo:

```typescript
describe('PATCH /api/jobs/:id/last-activity', () => {
  it('sets the last WhatsApp activity timestamp', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Última Atividade Rota Teste' });
      const timestamp = '2026-08-18T10:00:00.000Z';
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: timestamp });

      expect(res.status).toBe(200);
      expect(res.body.job.lastWhatsappActivityAt).toBe(timestamp);
    });
  });

  it('clears the timestamp when null is sent', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Limpar Última Atividade Teste' });
      await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: '2026-08-18T10:00:00.000Z' });

      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: null });

      expect(res.status).toBe(200);
      expect(res.body.job.lastWhatsappActivityAt).toBeNull();
    });
  });

  it('rejects an invalid date string', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Data Inválida Teste' });
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: 'não é uma data' });

      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd server && npm test`
Expected: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/schema.sql server/src/models/job.ts server/src/routes/jobs.ts server/test/routes.jobs.test.ts
git commit -m "feat(jobs): add manual last WhatsApp activity timestamp"
```

---

### Task 4: Classificação por IA (colagem manual de mensagens)

**Files:**
- Modify: `server/package.json` (nova dependência)
- Create: `server/src/services/classifier.ts`
- Create: `server/src/models/classification.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/jobs.ts`
- Create: `server/test/models.classification.test.ts`
- Modify: `server/test/routes.jobs.test.ts`

**Interfaces:**
- Consumes: `Job.bolaCom` e `setBolaCom` (Task 2); `Status`/`listPhasesWithStatuses` de `server/src/models/reference.ts`; `setJobStatus` de `server/src/models/job.ts`.
- Produces: `Classifier` interface e `createAnthropicClassifier(apiKey): Classifier` em `server/src/services/classifier.ts`; `classifyAndApply(db, classifier, jobId, pastedText): Promise<ResolvedSuggestion[]>` em `server/src/models/classification.ts`; rota `POST /api/jobs/:id/classify`.

- [ ] **Step 1: Adicionar a dependência do SDK da Anthropic**

Em `server/package.json`, adicione ao objeto `dependencies` (mantendo ordem alfabética com as demais):

```json
    "@anthropic-ai/sdk": "^0.32.1",
```

Run: `cd server && npm install`
Expected: instala sem erro, `package-lock.json` atualizado.

- [ ] **Step 2: Criar o serviço de classificação (`services/classifier.ts`)**

```typescript
import Anthropic from '@anthropic-ai/sdk';

export interface ChecklistItemForPrompt {
  name: string;
  done: boolean;
}

export interface ClassifyInput {
  jobName: string;
  phaseName: string;
  checklist: ChecklistItemForPrompt[];
  bolaCom: 'ilha' | 'cliente';
  pastedText: string;
}

export interface RawSuggestion {
  tipo: 'checklist_item' | 'bola_com';
  valor: string;
  confidence: number;
  evidencia: string;
}

export interface Classifier {
  classify(input: ClassifyInput): Promise<RawSuggestion[]>;
}

const SUGGESTIONS_TOOL = {
  name: 'record_suggestions',
  description:
    'Registra as atualizações sugeridas para o job com base nas mensagens de WhatsApp analisadas.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestions: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            tipo: { type: 'string' as const, enum: ['checklist_item', 'bola_com'] },
            valor: { type: 'string' as const },
            confidence: { type: 'number' as const },
            evidencia: { type: 'string' as const },
          },
          required: ['tipo', 'valor', 'confidence', 'evidencia'],
        },
      },
    },
    required: ['suggestions'],
  },
};

function buildSystemPrompt(input: ClassifyInput): string {
  const checklistLines = input.checklist
    .map((item) => `- [${item.done ? 'x' : ' '}] ${item.name}`)
    .join('\n');

  return `Você analisa mensagens de WhatsApp de uma produtora audiovisual e identifica quais marcos do checklist da fase atual de um job foram concluídos, e se a responsabilidade ("bola") está com a Ilha (produtora) ou com o cliente.

Job: ${input.jobName}
Fase atual: ${input.phaseName}
Checklist da fase atual:
${checklistLines}

Bola com atualmente: ${input.bolaCom === 'ilha' ? 'a Ilha' : 'o cliente'}

Regras:
- Só sugira itens de checklist que estão na lista acima, usando o texto exato do item em "valor".
- Para bola_com, "valor" deve ser exatamente "ilha" ou "cliente".
- confidence é um número de 0 a 1 refletindo o quão certo você está da sugestão.
- evidencia deve ser um trecho literal da mensagem que embasa a sugestão.
- Não invente marcos fora da lista. Se nada relevante mudou, chame a ferramenta com uma lista vazia de sugestões.`;
}

interface ToolUseBlock {
  type: 'tool_use';
  input: unknown;
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_use';
}

export function createAnthropicClassifier(apiKey: string): Classifier {
  const client = new Anthropic({ apiKey });

  return {
    async classify(input: ClassifyInput): Promise<RawSuggestion[]> {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: buildSystemPrompt(input),
        messages: [{ role: 'user', content: input.pastedText }],
        tools: [SUGGESTIONS_TOOL],
        tool_choice: { type: 'tool', name: 'record_suggestions' },
      });

      const toolUse = response.content.find(isToolUseBlock);

      if (!toolUse) {
        return [];
      }

      const parsed = toolUse.input as { suggestions?: RawSuggestion[] };
      return parsed.suggestions ?? [];
    },
  };
}
```

- [ ] **Step 3: Escrever os testes que falham para `models/classification.ts`**

Crie `server/test/models.classification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { classifyAndApply } from '../src/models/classification';
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import { withTestTransaction } from './helpers/testDb';

function fakeClassifier(suggestions: RawSuggestion[]): Classifier {
  return {
    classify: async () => suggestions,
  };
}

describe('classifyAndApply', () => {
  it('auto-applies a high-confidence forward checklist suggestion', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Auto-Aplica Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.9,
          evidencia: 'Cliente confirmou o briefing por aqui',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved).toHaveLength(1);
      expect(resolved[0].outcome).toBe('auto_aplicado');
    });
  });

  it('leaves a mid-confidence suggestion pending without applying it', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Pendente Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.7,
          evidencia: 'Parece que o briefing foi recebido',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('pendente');
    });
  });

  it('discards a low-confidence suggestion', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Descartada Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.3,
          evidencia: 'Menção vaga',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');
    });
  });

  it('never auto-applies a phase regression, even with high confidence', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Retrocesso Teste' });

      // Avança o job manualmente até "Orçamento e Decupagem" (order 4) antes de
      // simular uma sugestão de retrocesso para "Briefing Recebido" (order 2).
      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Orçamento e Decupagem'`,
      );
      await db.query('UPDATE jobs SET status_id = $1 WHERE id = $2', [targetStatus.rows[0].id, job.id]);

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.95,
          evidencia: 'Cliente disse que o briefing anterior estava errado',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('pendente');
    });
  });

  it('auto-applies a high-confidence bola-com suggestion', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Bola Com Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'bola_com',
          valor: 'cliente',
          confidence: 0.9,
          evidencia: 'Aguardando aprovação do cliente',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('auto_aplicado');

      const updated = await db.query<{ bola_com: string }>('SELECT bola_com FROM jobs WHERE id = $1', [job.id]);
      expect(updated.rows[0].bola_com).toBe('cliente');
    });
  });

  it('discards a suggestion naming a checklist item that does not exist', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Classificação Item Inexistente Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Item que não existe no checklist',
          confidence: 0.95,
          evidencia: 'texto qualquer',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto colado qualquer');

      expect(resolved[0].outcome).toBe('descartado');
    });
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd server && npx vitest run test/models.classification.test.ts`
Expected: FAIL — `Cannot find module '../src/models/classification'`.

- [ ] **Step 5: Criar `server/src/models/classification.ts`**

```typescript
import type { AppDatabase } from '../db';
import { getJobById, setJobStatus } from './job';
import { listPhasesWithStatuses, type Status } from './reference';
import { setBolaCom } from './bolaCom';
import type { Classifier, RawSuggestion } from '../services/classifier';

export type SuggestionOutcome = 'auto_aplicado' | 'pendente' | 'descartado';

export interface ResolvedSuggestion extends RawSuggestion {
  outcome: SuggestionOutcome;
}

const AUTO_APPLY_THRESHOLD = 0.85;
const SUGGEST_THRESHOLD = 0.6;

export async function classifyAndApply(
  db: AppDatabase,
  classifier: Classifier,
  jobId: number,
  pastedText: string,
): Promise<ResolvedSuggestion[]> {
  const job = await getJobById(db, jobId);
  if (!job || !job.phaseId) {
    throw new Error('Job not found or has no current phase');
  }

  const phases = await listPhasesWithStatuses(db);
  const phase = phases.find((p) => p.id === job.phaseId);
  if (!phase) {
    throw new Error('Job phase not found in reference data');
  }

  const currentStatus = phase.statuses.find((s) => s.id === job.statusId);
  const currentOrder = currentStatus?.order ?? 0;

  const checklist = phase.statuses.map((status) => ({
    name: status.name,
    done: status.order <= currentOrder,
  }));

  const raw = await classifier.classify({
    jobName: job.name,
    phaseName: phase.name,
    checklist,
    bolaCom: job.bolaCom,
    pastedText,
  });

  const resolved: ResolvedSuggestion[] = [];
  for (const suggestion of raw) {
    const outcome = await resolveAndApply(db, jobId, phase.statuses, currentOrder, suggestion);
    resolved.push({ ...suggestion, outcome });
  }

  return resolved;
}

async function resolveAndApply(
  db: AppDatabase,
  jobId: number,
  statuses: Status[],
  currentOrder: number,
  suggestion: RawSuggestion,
): Promise<SuggestionOutcome> {
  if (suggestion.confidence < SUGGEST_THRESHOLD) {
    return 'descartado';
  }

  if (suggestion.tipo === 'checklist_item') {
    const target = statuses.find((s) => s.name === suggestion.valor);
    if (!target) {
      return 'descartado';
    }

    const isRegression = target.order < currentOrder;
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;

    if (suggestion.confidence >= AUTO_APPLY_THRESHOLD && !isRegression) {
      await setJobStatus(db, jobId, target.id, evidenceNote);
      return 'auto_aplicado';
    }

    return 'pendente';
  }

  if (suggestion.valor !== 'ilha' && suggestion.valor !== 'cliente') {
    return 'descartado';
  }

  if (suggestion.confidence >= AUTO_APPLY_THRESHOLD) {
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;
    await setBolaCom(db, jobId, suggestion.valor, evidenceNote);
    return 'auto_aplicado';
  }

  return 'pendente';
}
```

- [ ] **Step 6: Rodar os testes de novo e ver passar**

Run: `cd server && npx vitest run test/models.classification.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 7: Ligar o `Classifier` opcional em `app.ts` e `index.ts`**

Em `server/src/app.ts`, atualize os imports e a interface `AppDeps`:

```typescript
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppDatabase } from './db';
import { createAuthRouter, type VerifyIdToken } from './routes/auth';
import { createJobsRouter } from './routes/jobs';
import { createReferenceRouter } from './routes/reference';
import { createUsersRouter } from './routes/users';
import type { Classifier } from './services/classifier';

export interface AppDeps {
  db: AppDatabase;
  verifyIdToken: VerifyIdToken;
  jwtSecret: string;
  allowedDomain: string;
  frontendUrl: string;
  classifier?: Classifier;
}
```

O resto de `app.ts` não muda — `deps` já é passado inteiro para `createJobsRouter(deps)`.

Em `server/src/routes/jobs.ts`, atualize `JobsRouterDeps`:

```typescript
export interface JobsRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
  classifier?: Classifier;
}
```

(adicione `import type { Classifier } from '../services/classifier';` ao topo do arquivo, junto aos outros imports.)

Em `server/src/index.ts`, adicione a leitura da variável de ambiente e a construção do classifier real:

```typescript
import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';
import { createAnthropicClassifier } from './services/classifier';

const port = Number(process.env.PORT ?? 4000);
const connectionString = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
if (!googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required');
}

async function main() {
  const db = await createDb(connectionString!);

  const app = createApp({
    db,
    verifyIdToken: createGoogleVerifier(googleClientId!),
    jwtSecret: jwtSecret!,
    allowedDomain,
    frontendUrl,
    classifier: anthropicApiKey ? createAnthropicClassifier(anthropicApiKey) : undefined,
  });

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    if (!anthropicApiKey) {
      console.warn('ANTHROPIC_API_KEY not set — POST /api/jobs/:id/classify will return 503');
    }
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

`classifier` é opcional de propósito: nenhum dos `buildApp` helpers dos testes de rota existentes (`routes.jobs.test.ts`, `routes.reference.test.ts`, `routes.auth.test.ts`, `routes.users.test.ts`) precisa mudar — eles continuam construindo o app sem `classifier`, e só a rota `/classify` checa se ele foi fornecido.

- [ ] **Step 8: Adicionar a rota `POST /api/jobs/:id/classify`**

Em `server/src/routes/jobs.ts`, atualize o import:

```typescript
import { classifyAndApply } from '../models/classification';
```

Adicione a rota depois de `PATCH /:id/last-activity`:

```typescript
  router.post(
    '/:id/classify',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      if (!deps.classifier) {
        res.status(503).json({ error: 'ia_nao_configurada' });
        return;
      }

      const { text } = req.body as { text?: string };
      if (!text || !text.trim()) {
        res.status(400).json({ error: 'text is required' });
        return;
      }

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const suggestions = await classifyAndApply(deps.db, deps.classifier, jobId, text);
      res.json({ suggestions });
    }),
  );
```

- [ ] **Step 9: Escrever os testes de rota com um classifier falso**

Em `server/test/routes.jobs.test.ts`, adicione ao topo do arquivo o import do tipo:

```typescript
import type { Classifier, RawSuggestion } from '../src/services/classifier';
```

E adicione ao final do arquivo:

```typescript
function fakeClassifier(suggestions: RawSuggestion[]): Classifier {
  return { classify: async () => suggestions };
}

describe('POST /api/jobs/:id/classify', () => {
  it('returns 503 when no classifier is configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Sem IA Teste' });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/classify`)
        .send({ text: 'qualquer coisa' });

      expect(res.status).toBe(503);
    });
  });

  it('classifies pasted text and returns resolved suggestions', async () => {
    await withTestTransaction(async (db) => {
      const app = createApp({
        db,
        verifyIdToken: async () => ({
          sub: 'google-sub-1',
          email: 'wilka@ilhacrossmidia.com.br',
          name: 'Wilka',
        }),
        jwtSecret: JWT_SECRET,
        allowedDomain: ALLOWED_DOMAIN,
        frontendUrl: FRONTEND_URL,
        classifier: fakeClassifier([
          {
            tipo: 'checklist_item',
            valor: 'Briefing Recebido',
            confidence: 0.9,
            evidencia: 'Cliente confirmou o briefing',
          },
        ]),
      });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Com IA Teste' });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/classify`)
        .send({ text: 'Cliente confirmou o briefing agora' });

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.suggestions[0].outcome).toBe('auto_aplicado');
    });
  });

  it('rejects empty text', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Texto Vazio Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/classify`).send({ text: '' });

      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 10: Rodar a suíte inteira do servidor**

Run: `cd server && npm test`
Expected: todos os testes passam.

- [ ] **Step 11: Verificar o build de produção**

Run: `cd server && npm run build`
Expected: compila sem erro de tipos.

- [ ] **Step 12: Adicionar `ANTHROPIC_API_KEY` ao `.env` local**

Manualmente, adicione a linha `ANTHROPIC_API_KEY=<sua chave real>` ao arquivo `server/.env` (gitignored, não commitado). Sem essa chave, o servidor sobe normalmente mas `/api/jobs/:id/classify` responde 503.

- [ ] **Step 13: Commit**

```bash
git add server/package.json server/package-lock.json server/src/services/classifier.ts server/src/models/classification.ts server/src/app.ts server/src/index.ts server/src/routes/jobs.ts server/test/models.classification.test.ts server/test/routes.jobs.test.ts
git commit -m "feat(jobs): add AI classification of pasted WhatsApp text via Anthropic API"
```

---

## Encerramento deste plano

Depois da Task 4, o backend expõe tudo que o redesign visual (próximo plano, ainda não escrito) precisa consumir: `Job.bolaCom`, `Job.lastWhatsappActivityAt`, `bolaComDayCounts` no detalhe do job, checklist de 40 itens granulares via `/api/reference`, e `POST /api/jobs/:id/classify`. Nenhuma mudança de frontend faz parte deste plano — `web/src/api/client.ts` e as páginas React continuam como estão até o próximo plano.
