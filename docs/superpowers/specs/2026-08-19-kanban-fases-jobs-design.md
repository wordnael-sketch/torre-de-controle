# Kanban de Fases e Responsáveis — Ilha Crossmídia (Módulo 1)

**Data:** 2026-08-19
**Status:** Aprovado para planejamento de implementação
**Spec anterior:** `2026-08-18-sistema-acompanhamento-jobs-design.md` (fundação: auth, jobs
básico, integrações Trello/WhatsApp) — esta spec estende o modelo de Job dessa fundação.

## 1. Contexto e Problema

A spec original modelava a fase de um job como derivada do Trello (a lista onde o card
está) e um único campo de texto livre para "responsável atual". Na prática, o fluxo real
da Ilha Crossmídia é muito mais granular: **6 fases macro, ~24 status dentro delas**, cada
fase com **múltiplos papéis atuando em paralelo** (ex: Financeiro + Atendimento + Jurídico
simultaneamente na Fase 2), cada papel preenchido por uma de um conjunto de pessoas
específicas, e cada avanço de status disparado por uma ação de negócio nomeada (ex:
"Tocar a Buzina", "AD envia OD").

Esta spec substitui o modelo simplificado de fase/responsável da spec original por esse
fluxo real, mantendo o sistema de usuário único (Gerente de Projeto).

## 2. Objetivo

Dar ao Gerente um Kanban onde cada Job é um card que passa pelas 6 fases da Ilha, com
visibilidade de quem está com a "bola" em cada momento, histórico completo de todas as
mudanças de status, e os gatilhos de avanço específicos de cada etapa do processo real.

## 3. Decisões de Escopo

- **Status vira ação no sistema, não no Trello.** A fase/status do job passa a ser
  controlada inteiramente dentro deste sistema (botão de avanço com gatilho nomeado),
  não mais derivada do polling do Trello. O vínculo Trello (de planos futuros) continua
  existindo só como referência/mensagens — não dirige mais o status.
- **Usuário único continua.** Só o Gerente de Projeto loga e opera o sistema. Os gatilhos
  descritos (ex: "Executivo clica em Tocar a Buzina") são ações que o Gerente registra no
  sistema com base no que observa no mundo real (WhatsApp, conversas, Trello) — não é
  necessário login por pessoa/papel.
- **Fluxo fixo, não editável no MVP.** As 6 fases e ~24 status são hardcoded no sistema
  (é o processo real da empresa). Uma futura tela de configuração do fluxo fica fora de
  escopo por ora.
- **Sem drag-and-drop.** Avanço de status é por botão de gatilho na página do job (com
  opção de selecionar manualmente outro status quando a realidade não for linear), não
  arrastar cards no board.
- **Cadastro de Pessoas.** Substitui o texto livre de "responsável" por um cadastro
  formal (nome + área), com pré-carga dos nomes já mapeados abaixo, editável pelo
  Gerente depois.

## 4. Modelo de Dados

### 4.1 Fluxo fixo (fases, status, papéis esperados)

Tabelas de referência, populadas via seed/migration — o conteúdo abaixo é definitivo
para o MVP:

| # | Fase | Status (em ordem) | Papéis esperados (área) |
|---|---|---|---|
| 1 | Comercial e Orçamento | Prospecção → Briefing Recebido → Orçamento e Decupagem → Defesa da Proposta | Comercial · Produção Executiva |
| 2 | Dotação Financeira e Burocracia (Set-up) | Dotação e Travamento → Aguardando Contrato → NF Emitida → Grupos Criados | Financeiro · Atendimento · Jurídico/Base |
| 3 | Pré-Produção | Reunião de Briefing → Contratações (Logística/Freelas) → Aprovação PPM → OD Enviada | Produção · Criativo · Locação/Elenco/Arte |
| 4 | Captação (Set de Gravação) | Pré-Light → Em Captação → Desmontagem → Prestação de Contas | Técnica/Imagem · Elétrica/Maquinaria · Produção Executiva e Financeiro |
| 5 | Pós-Produção | Ingest/Decupagem → Montagem/Cor/Motion → QC Interno → Aprovação do Cliente → Acessibilidade | Pós · Atendimento |
| 6 | Encerramento e Auditoria | Entrega Final (Mestres) → Pesquisa NPS → Fechamento Orçado x Dotado x Realizado → Arquivamento | Qualidade e RH · Produção Executiva · Marketing |

Cada **status** também guarda, como texto fixo de referência exibido na UI:
- `ação_exigida`: o que precisa acontecer nesse status (ex: "Preenchimento do Briefing
  Padronizado e criação da Carta Orçamentária/Tratamento").
- `gatilho_avanço`: o rótulo do botão/ação que avança para o próximo status (ex: "Tocar
  a Buzina", "AD envia OD com 24h de antecedência").
- `papel_principal` (assumido pelo redator desta spec a partir do texto do gatilho —
  **revisar antes de aprovar**): qual papel da fase é o "responsável principal" exibido
  em destaque no card enquanto o job está nesse status. Ex.: no gatilho "Executivo clica
  em Tocar a Buzina" (fim da Fase 1), o papel principal é Comercial; em "AD envia OD"
  (fim da Fase 3), é Criativo; em "Logger realiza backup em HD" (fim da Fase 4), é
  Técnica/Imagem. Essa coluna é só um destaque de UI — não bloqueia o avanço.

### 4.2 Pessoas

Tabela `people`: id, nome, área (uma das áreas da tabela acima), ativo (bool).

Pré-carga inicial (editável depois pelo Gerente):

| Área | Pessoas |
|---|---|
| Comercial | Anne, Ronaldo, Binho, Vic |
| Produção Executiva | Adriano, Mônica, Rodolpho, Juliano, Flávia Lebre |
| Financeiro | Fagner, Dani |
| Atendimento | Wilka |
| Jurídico/Base | Carol |
| Produção | Maíce, Camila, Alex, Rodrigo, Mateus |
| Criativo | Brendow |
| Locação/Elenco/Arte | Camila, Rita, Priscila, Tiago |
| Técnica/Imagem | Coghi, Lirton, Japa, Samir, Fino |
| Elétrica/Maquinaria | Rafa, Mateus |
| Pós | Gabriel Fernando, Nathan, Brunão, Tavares, Cedrique |
| Qualidade e RH | Bruno Okumura, Maria Alice, Julia |
| Marketing | Gabriella, Danilo |

(Pessoas citadas sem nome específico na descrição original — "Produtora de Base",
"Diretor de Cena", "Produtores de Base", "time de IA", "colaboradora designada" — não
entram na pré-carga; o Gerente cadastra conforme necessário.)

### 4.3 Job — extensão

O `job` existente (spec anterior) ganha:
- `status_atual_id` (FK para status, substitui a ideia de fase derivada do Trello).
- `concluido_em` (timestamp nulo; preenchido quando o job atinge o último status da
  Fase 6 — "Arquivamento").

### 4.4 Atribuição de papéis por job

Tabela `job_role_assignment`: job_id, fase_id, papel (área), pessoa_id. Uma linha por
papel esperado da fase, por job. Persiste mesmo depois que o job avança de fase (histórico
de quem trabalhou em cada frente), editável a qualquer momento pelo Gerente.

### 4.5 Histórico de status

Tabela `job_status_history`: job_id, status_anterior_id (nulo no primeiro registro),
status_novo_id, alterado_em (timestamp), nota (texto livre opcional). Todo avanço grava
uma linha aqui — base para o farol de alerta e para o futuro Módulo 2 calcular tempo por
fase/status.

## 5. Fluxo de Avanço

- Página do job mostra o status atual, seu `ação_exigida` (texto de apoio), e um botão
  com o rótulo do `gatilho_avanço` daquele status. Clicar avança para o próximo status na
  ordem fixa e grava no histórico.
- Alternativa: um seletor manual permite escolher qualquer outro status diretamente
  (pular etapas, voltar), para os casos em que o fluxo real não é 100% linear (ex.:
  repetir uma Reunião de Briefing). Mudança manual também grava no histórico com uma nota
  indicando que foi um ajuste manual (não pelo gatilho padrão).
- Ao atingir o último status ("Arquivamento"), o job é marcado concluído
  (`concluido_em` preenchido) e sai da visão ativa do Kanban (mas continua acessível/
  consultável).

## 6. Dashboard — Kanban

- **Board principal**: 6 colunas fixas (as macro-fases). Cada card mostra: nome do job,
  cliente, rótulo do status atual, pessoa em destaque (papel principal daquele status,
  conforme §4.1), e farol de alerta.
- **Farol de alerta**: reaproveita a regra já prevista na spec anterior — tempo parado no
  status atual sem avanço. Default inicial: amarelo após 3 dias sem mudança de status,
  vermelho após 7 dias (valor configurável globalmente, não por status, no MVP).
- **Clique no card** abre a página do job: status atual + ação exigida + botão de
  gatilho + seletor manual, atribuição de pessoas por papel da fase atual (editável),
  histórico completo de status (linha do tempo), e o que já existia (notas diárias, feed
  de mensagens do WhatsApp quando a integração existir).
- **Criar job**: mesmo formulário atual (nome/código/cliente); status inicial já vem
  como "Prospecção" (primeiro status da Fase 1).

## 7. Fora de Escopo (fica para depois)

- **Módulo 2 (Painel Executivo)**: saúde financeira (Orçado x Dotado x Realizado),
  índice de retenção/gargalos cliente vs. interno, alertas de compliance (limite de
  14h de set) com notificação a CEO/RH, NPS consolidado. Spec separada, depende dos
  dados de histórico de status que este módulo passa a gravar.
- Fluxo de fases/status configurável pelo Gerente (editar/adicionar status) — hardcoded
  por ora.
- Drag-and-drop no board.
- Multi-usuário / login por pessoa/papel.
- Notificações push/e-mail (o farol e os destaques ficam só no próprio dashboard, como
  já definido na spec anterior).
- Regras de farol por status individual (o MVP usa um único par de limiares global).

## 8. Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| `papel_principal` assumido incorretamente para algum dos ~24 status (ver §4.1) | É só destaque de UI, não bloqueia nada; fácil de corrigir depois de revisão do Gerente |
| Fluxo real ter exceções não lineares (pular/voltar status) | Seletor manual de status sempre disponível, além do botão de gatilho padrão |
| Pessoas/papéis mudarem com o tempo (ex: alguém sai da empresa) | Cadastro de Pessoas tem campo `ativo`; atribuições antigas continuam no histórico mesmo se a pessoa for desativada |

## 9. Testes

- Testes de unidade: cálculo de farol de alerta (dado um histórico de status, retorna
  verde/amarelo/vermelho), transição de status (avanço padrão vs. manual, gravação
  correta no histórico), marcação de conclusão ao atingir o último status.
- Testes de integração: rotas de listagem do board agrupado por fase, rota de detalhe do
  job com atribuições e histórico, rota de avanço de status (padrão e manual).
