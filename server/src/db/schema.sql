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

INSERT INTO users (email, role, status) VALUES
  ('wilka@ilhacrossmidia.com.br', 'admin', 'invited')
ON CONFLICT (email) DO NOTHING;

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

INSERT INTO phases ("order", name) VALUES
  (1, 'Comercial e Orçamento'),
  (2, 'Dotação Financeira e Burocracia (Set-up)'),
  (3, 'Pré-Produção'),
  (4, 'Captação (Set de Gravação)'),
  (5, 'Pós-Produção'),
  (6, 'Encerramento e Auditoria')
ON CONFLICT (name) DO NOTHING;

INSERT INTO phase_roles (phase_id, area)
SELECT p.id, v.area
FROM (VALUES
  ('Comercial e Orçamento', 'Comercial'),
  ('Comercial e Orçamento', 'Produção Executiva'),
  ('Dotação Financeira e Burocracia (Set-up)', 'Financeiro'),
  ('Dotação Financeira e Burocracia (Set-up)', 'Atendimento'),
  ('Dotação Financeira e Burocracia (Set-up)', 'Jurídico/Base'),
  ('Pré-Produção', 'Produção'),
  ('Pré-Produção', 'Criativo'),
  ('Pré-Produção', 'Locação/Elenco/Arte'),
  ('Captação (Set de Gravação)', 'Técnica/Imagem'),
  ('Captação (Set de Gravação)', 'Elétrica/Maquinaria'),
  ('Captação (Set de Gravação)', 'Produção Executiva'),
  ('Captação (Set de Gravação)', 'Financeiro'),
  ('Pós-Produção', 'Pós'),
  ('Pós-Produção', 'Atendimento'),
  ('Encerramento e Auditoria', 'Qualidade e RH'),
  ('Encerramento e Auditoria', 'Produção Executiva'),
  ('Encerramento e Auditoria', 'Marketing')
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
    'Avançar para: Orçamento e Decupagem', 'Comercial'),
  ('Comercial e Orçamento', 3, 'Orçamento e Decupagem',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Defesa da Proposta', 'Produção Executiva'),
  ('Comercial e Orçamento', 4, 'Defesa da Proposta',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Tocar a Buzina', 'Comercial'),

  ('Dotação Financeira e Burocracia (Set-up)', 1, 'Dotação e Travamento',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Avançar para: Aguardando Contrato', 'Financeiro'),
  ('Dotação Financeira e Burocracia (Set-up)', 2, 'Aguardando Contrato',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Avançar para: NF Emitida', 'Jurídico/Base'),
  ('Dotação Financeira e Burocracia (Set-up)', 3, 'NF Emitida',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Avançar para: Grupos Criados', 'Financeiro'),
  ('Dotação Financeira e Burocracia (Set-up)', 4, 'Grupos Criados',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Contrato assinado anexado no Drive e pastas movidas para "Em execução"', 'Atendimento'),

  ('Pré-Produção', 1, 'Reunião de Briefing',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Contratações (Logística/Freelas)', 'Produção'),
  ('Pré-Produção', 2, 'Contratações (Logística/Freelas)',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Aprovação PPM', 'Produção'),
  ('Pré-Produção', 3, 'Aprovação PPM',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: OD Enviada', 'Criativo'),
  ('Pré-Produção', 4, 'OD Enviada',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Assistente de Direção (AD) envia a Ordem do Dia (OD) com 24h de antecedência', 'Criativo'),

  ('Captação (Set de Gravação)', 1, 'Pré-Light',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Em Captação', 'Elétrica/Maquinaria'),
  ('Captação (Set de Gravação)', 2, 'Em Captação',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Desmontagem', 'Técnica/Imagem'),
  ('Captação (Set de Gravação)', 3, 'Desmontagem',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Prestação de Contas', 'Elétrica/Maquinaria'),
  ('Captação (Set de Gravação)', 4, 'Prestação de Contas',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Logger realiza backup em HD e Produção finaliza o "Realizado"', 'Produção Executiva'),

  ('Pós-Produção', 1, 'Ingest / Decupagem',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Montagem / Cor / Motion', 'Pós'),
  ('Pós-Produção', 2, 'Montagem / Cor / Motion',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: QC Interno', 'Pós'),
  ('Pós-Produção', 3, 'QC Interno',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Aprovação do Cliente', 'Pós'),
  ('Pós-Produção', 4, 'Aprovação do Cliente',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Acessibilidade', 'Atendimento'),
  ('Pós-Produção', 5, 'Acessibilidade',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Cliente dá o "De Acordo/Aceite Final" e recursos como Libras/Legendas são finalizados', 'Pós'),

  ('Encerramento e Auditoria', 1, 'Entrega Final (Mestres)',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Pesquisa NPS', 'Qualidade e RH'),
  ('Encerramento e Auditoria', 2, 'Pesquisa NPS',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Fechamento Orçado x Dotado x Realizado', 'Qualidade e RH'),
  ('Encerramento e Auditoria', 3, 'Fechamento Orçado x Dotado x Realizado',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Arquivamento', 'Produção Executiva'),
  ('Encerramento e Auditoria', 4, 'Arquivamento',
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
  ('Wilka', 'Atendimento'),
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
