CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;
ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'invited';
-- Preferência de densidade da Torre de Controle (agrupado por fase vs.
-- tabela plana). Fica no perfil do usuário, não em localStorage, pra não
-- se perder ao trocar de máquina e pra dar pra fixar um padrão em quem
-- entra novo no time. Validado na rota (mesmo padrão já usado por
-- bola_com), sem CHECK constraint — Postgres não aceita
-- "ADD CONSTRAINT IF NOT EXISTS", e este arquivo roda em todo boot.
ALTER TABLE users ADD COLUMN IF NOT EXISTS board_density TEXT NOT NULL DEFAULT 'agrupado';

INSERT INTO users (email, role, status) VALUES
  ('wilka@ilhacrossmidia.com.br', 'admin', 'invited')
ON CONFLICT (email) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  client TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS phases (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "order" INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE ("order"),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS statuses (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  "order" INTEGER NOT NULL,
  name TEXT NOT NULL,
  action_required TEXT NOT NULL,
  trigger_label TEXT NOT NULL,
  primary_role TEXT NOT NULL,
  UNIQUE (phase_id, "order")
);

CREATE TABLE IF NOT EXISTS phase_roles (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  area TEXT NOT NULL,
  UNIQUE (phase_id, area)
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (name, area)
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_id INTEGER REFERENCES statuses(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS job_role_assignments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  area TEXT NOT NULL,
  person_id INTEGER REFERENCES people(id),
  UNIQUE (job_id, phase_id, area)
);

CREATE TABLE IF NOT EXISTS job_status_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  from_status_id INTEGER REFERENCES statuses(id),
  to_status_id INTEGER NOT NULL REFERENCES statuses(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

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

INSERT INTO people (name, area) VALUES
  ('Anne', 'Comercial'),
  ('Ronaldo', 'Comercial'),
  ('Binho', 'Comercial'),
  ('Vic', 'Comercial'),
  ('Adriano', 'Produção Executiva'),
  ('Mônica', 'Produção Executiva'),
  ('Rodolpho', 'Produção Executiva'),
  ('Juliano', 'Produção Executiva'),
  ('Flávia Lebre', 'Produção Executiva'),
  ('Fagner', 'Financeiro'),
  ('Dani', 'Financeiro'),
  ('Carol', 'Jurídico/Base'),
  ('Maíce', 'Produção'),
  ('Camila', 'Produção'),
  ('Alex', 'Produção'),
  ('Rodrigo', 'Produção'),
  ('Mateus', 'Produção'),
  ('Brendow', 'Criativo'),
  ('Camila', 'Locação/Elenco/Arte'),
  ('Rita', 'Locação/Elenco/Arte'),
  ('Priscila', 'Locação/Elenco/Arte'),
  ('Tiago', 'Locação/Elenco/Arte'),
  ('Coghi', 'Técnica/Imagem'),
  ('Lirton', 'Técnica/Imagem'),
  ('Japa', 'Técnica/Imagem'),
  ('Samir', 'Técnica/Imagem'),
  ('Fino', 'Técnica/Imagem'),
  ('Rafa', 'Elétrica/Maquinaria'),
  ('Mateus', 'Elétrica/Maquinaria'),
  ('Gabriel Fernando', 'Pós'),
  ('Nathan', 'Pós'),
  ('Brunão', 'Pós'),
  ('Tavares', 'Pós'),
  ('Cedrique', 'Pós'),
  ('Bruno Okumura', 'Qualidade e RH'),
  ('Maria Alice', 'Qualidade e RH'),
  ('Julia', 'Qualidade e RH'),
  ('Gabriella', 'Marketing'),
  ('Danilo', 'Marketing')
ON CONFLICT (name, area) DO NOTHING;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bola_com TEXT NOT NULL DEFAULT 'ilha'
  CHECK (bola_com IN ('ilha', 'cliente'));

CREATE TABLE IF NOT EXISTS job_bola_com_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  bola_com TEXT NOT NULL CHECK (bola_com IN ('ilha', 'cliente')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_whatsapp_activity_at TIMESTAMPTZ;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS atendimento_person_id INTEGER REFERENCES people(id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS title TEXT;

-- Atendimento stops being a per-phase role assignment and becomes a
-- single job-level field. Any existing job_role_assignments row for the
-- Atendimento area is migrated onto the new column before the old rows
-- (and the phase_roles entries that made them possible) are removed.
UPDATE jobs j
SET atendimento_person_id = jra.person_id
FROM job_role_assignments jra
WHERE jra.job_id = j.id
  AND jra.area = 'Atendimento'
  AND j.atendimento_person_id IS NULL
  AND jra.person_id IS NOT NULL;

DELETE FROM job_role_assignments WHERE area = 'Atendimento';
DELETE FROM phase_roles WHERE area = 'Atendimento';

-- O seed original de Atendimento (Camila, Andrea, Larissa (Brasília),
-- Karina, Isabela, Bianca (Brasília) e por fim Renata (RJ)) foi todo
-- removido: cada uma foi renomeada pro nome completo do Trello ou excluída
-- depois que este seed já tinha rodado, e como o INSERT roda em todo boot,
-- o "ON CONFLICT (name, area) DO NOTHING" parava de proteger assim que o
-- nome exato mudava — cada cold start recriava a pessoa antiga do zero.
-- Sem ninguém mais nessa lista original pra seedar, este bloco não existe
-- mais — ver histórico do commit se precisar recuperar o texto.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_card_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_linked_at TIMESTAMPTZ;

-- Últimos comentários "STATUS" do card do Trello vinculado (autor, texto, data),
-- mais recente primeiro. Sempre sobrescrito por completo a cada sync — não é
-- histórico incremental, é o retrato atual do que está no Trello.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_status_updates JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Espelho somente-leitura do checklist real do card do Trello (nome + marcado),
-- pra exibir ao lado do checklist de fases do sistema — que continua sendo a
-- única fonte de verdade pra avanço de fase/prazo/responsabilidade. Sempre
-- sobrescrito por completo a cada sync, igual trello_status_updates acima.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Impede duas pessoas vinculando o mesmo card do Trello a dois jobs
-- diferentes: sync automático (webhook) só enxerga um deles pra sempre,
-- deixando o outro congelado — foi exatamente isso que gerou duplicatas
-- travadas em produção.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_trello_card_id_unique_idx
  ON jobs (trello_card_id) WHERE trello_card_id IS NOT NULL;

-- Impede dois jobs com o mesmo nome (ignorando maiúscula/minúscula e
-- espaços nas pontas) — nomes duplicados criados por engano confundiam
-- qual job era o "de verdade".
CREATE UNIQUE INDEX IF NOT EXISTS jobs_name_unique_idx ON jobs (lower(trim(name)));

-- Marca quando o sistema desvinculou um job do Trello sozinho (card
-- arquivado ou apagado lá) — distinto da desvinculação manual pelo botão
-- "desvincular", que nunca marca isso. Mostrado como aviso na tela do job;
-- limpo automaticamente assim que o job é vinculado a um card de novo.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_auto_unlinked_at TIMESTAMPTZ;

-- Espelho da descrição do card do Trello vinculado — antes só era buscada ao
-- vivo na hora de abrir o job (nunca persistida), o que a deixava fora de
-- alcance da busca global. Sobrescrita por completo a cada sync, igual aos
-- outros espelhos do Trello acima.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_description TEXT;

-- Atendimento backup: normalmente o card do Trello tem 2 pessoas atribuídas
-- (Membros) — a principal continua em atendimento_person_id (quem postou o
-- último "STATUS"), a outra vira o backup aqui. Preenchido só quando ainda
-- está vazio (não sobrescreve um backup já definido manualmente), diferente
-- do principal, que sempre sobrescreve a partir do autor do STATUS.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS atendimento_backup_person_id INTEGER REFERENCES people(id);
