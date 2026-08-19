# Redesign Visual "Torre de Controle" — Design Spec

**Data:** 2026-08-19
**Status:** proposto, aguardando revisão do usuário

## Contexto e motivação

Os três planos anteriores (Fundação/Auth, Kanban de Fases, Usuários e Papéis)
entregaram um sistema funcional, mas o resultado visual/interativo ficou
muito abaixo do que o usuário esperava. Após feedback direto ("não é o que
eu esperava do sistema"), o usuário forneceu três referências:

1. Um mockup de interface chamado "Torre de Controle" (duas telas: dashboard
   e painel de detalhe do job) — dark theme, denso em dados operacionais.
2. O site institucional real (`https://ilhacrossmidia.com.br/`) — visual
   claro, minimalista, tipografia limpa.
3. A logo oficial da Ilha Crossmídia — wordmark cursivo multicolorido
   ("vitral"/facetado: magenta → rosa → laranja → verde-amarelado → verde →
   teal → roxo), com "CROSSMÍDIA" em cinza neutro abaixo.

Este spec cobre **apenas o redesign visual e as extensões de dados
necessárias para sustentá-lo**, reaproveitando 100% do backend de
autenticação/usuários/kanban já construído e mesclado em `master`. A
integração real com WhatsApp via OpenWA (conexão ao vivo, leitura
automática de grupos) fica fora de escopo — fica só a classificação por IA
de texto colado manualmente, que o usuário pediu para incluir agora.

## Direção visual definida

**Estrutura/densidade:** a do mockup Torre de Controle — sidebar com
filtros (Farol, Fase), banner de jobs travados, cards de estatística,
tabela de jobs com timeline de responsabilidade, painel lateral do job
com checklist colapsável por fase.

**Paleta e tipografia:** claras, no estilo do site institucional e da
logo — fundo branco/quase-branco, texto em cinza-escuro/quase-preto, sem
tema escuro. As cores das 6 fases são sampleadas da logo em vez de cores
SMPTE genéricas, para reforçar a identidade de marca.

### Tokens de design (estimados — sem hex oficial disponível; ajustar se
houver guia de marca)

```css
:root {
  /* base */
  --bg: #FFFFFF;
  --bg-subtle: #F7F7FA;
  --border: #E5E5EA;
  --text-primary: #1A1A24;
  --text-secondary: #6B7280;

  /* farol (semântico, não vem da logo) */
  --farol-travado: #DC2626;
  --farol-atencao: #F59E0B;
  --farol-fluindo: #16A34A;

  /* fases, sampleadas da logo em ordem de progressão do job */
  --fase-1-comercial: #D6236F;   /* magenta/rosa */
  --fase-2-dotacao:   #F0932B;   /* laranja */
  --fase-3-preprod:   #8FBF4F;   /* verde-amarelado */
  --fase-4-captacao:  #1B9E8C;   /* teal */
  --fase-5-posprod:   #4A3F9E;   /* índigo/roxo-azulado */
  --fase-6-encerra:   #7A2F8F;   /* roxo profundo */
}
```

Tipografia: mantém o par já planejado — **Archivo** (títulos/UI) via Google
Fonts, **IBM Plex Mono** (labels em caixa alta, números, timestamps) via
Google Fonts. O par funciona tanto em tema escuro quanto claro; não muda.

## Modelo de dados — mudanças (todas aditivas)

### 1. Expansão da seed de `statuses`

O checklist por fase do mockup é mais granular que os status atuais (25 no
total). A tela do job "Manifesto de marca" mostra as contagens por fase:
Comercial e Orçamento 5, Dotação e Burocracia 8, Pré-Produção 7, Captação
6, Pós-Produção 8, Encerramento 6 — total 40.

A fase "Dotação e Burocracia" tem o texto exato confirmado pelo mockup (8
itens, batendo com o texto de `action_required` já cadastrado, que já
bundla várias ações numa frase só). As outras 5 fases **não têm texto de
referência do mockup** — a proposta abaixo é minha decomposição do
`action_required` já existente em itens individuais, mantendo a mesma
ordem de progressão. **Precisa da sua confirmação/edição antes da
implementação**, especialmente nomes de papéis responsáveis por item.

| Fase | # | Nome do status (item do checklist) | `primary_role` |
|---|---|---|---|
| Comercial e Orçamento (1) | 1 | Prospecção | Comercial |
| | 2 | Briefing Recebido | Comercial |
| | 3 | Carta Orçamentária/Tratamento criada | Comercial |
| | 4 | Orçamento e Decupagem | Produção Executiva |
| | 5 | Defesa da Proposta | Comercial |
| Dotação e Burocracia (2) | 1 | Dotação orçamentária aprovada pelo CEO | Financeiro |
| | 2 | Planilhas travadas pelo Head-Financeiro | Financeiro |
| | 3 | Atendimento da conta definida | Atendimento |
| | 4 | Assistente de Direção definido | Atendimento |
| | 5 | Contrato assinado pelo cliente | Jurídico/Base |
| | 6 | Nota Fiscal emitida | Financeiro |
| | 7 | Grupos de WhatsApp criados (Executivo, Pós e Geral) | Atendimento |
| | 8 | Pré-cadastro na ANCINE iniciado | Jurídico/Base |
| Pré-Produção (3) | 1 | Reunião de Briefing | Produção |
| | 2 | Contratações (Logística/Freelas) | Produção |
| | 3 | Estética aprovada na PPM | Criativo |
| | 4 | Seguros emitidos | Produção |
| | 5 | PPM aprovada pelo cliente | Criativo |
| | 6 | Ordem do Dia (OD) elaborada | Criativo |
| | 7 | OD enviada com 24h de antecedência | Criativo |
| Captação (4) | 1 | Pré-Light | Elétrica/Maquinaria |
| | 2 | Em Captação (dentro da janela de 12h–14h) | Técnica/Imagem |
| | 3 | Desmontagem | Elétrica/Maquinaria |
| | 4 | Backup em HD realizado (Logger) | Técnica/Imagem |
| | 5 | Prestação de Contas | Produção Executiva |
| | 6 | "Realizado" finalizado pela Produção | Produção Executiva |
| Pós-Produção (5) | 1 | Ingest / Decupagem | Pós |
| | 2 | Montagem | Pós |
| | 3 | Cor | Pós |
| | 4 | Motion | Pós |
| | 5 | QC Interno | Pós |
| | 6 | Aprovação do Cliente | Atendimento |
| | 7 | De Acordo / Aceite Final do cliente | Atendimento |
| | 8 | Libras/Legendas finalizados | Pós |
| Encerramento (6) | 1 | Entrega Final (Mestres) | Qualidade e RH |
| | 2 | Material enviado para Cold Storage | Qualidade e RH |
| | 3 | Pesquisa NPS enviada/respondida | Qualidade e RH |
| | 4 | Fechamento Orçado x Dotado x Realizado | Produção Executiva |
| | 5 | Arquivamento | Qualidade e RH |
| | 6 | Todos os checkboxes preenchidos — Job concluído | Qualidade e RH |

`trigger_label` de cada status vira, por padrão, `"Avançar para: <próximo
item>"` (ou o texto de conclusão de fase no último item de cada fase, como
já existe hoje). Os nomes de fase também simplificam para bater com o
mockup: "Dotação Financeira e Burocracia (Set-up)" → "Dotação e
Burocracia", "Captação (Set de Gravação)" → "Captação", "Encerramento e
Auditoria" → "Encerramento".

Como não há jobs reais em produção ainda (sistema recém-lançado, só dados
de seed), a migração é uma re-seed direta: apagar e recriar `statuses`
com os 40 itens, sem necessidade de migrar histórico de jobs existentes.
**Assunção a confirmar**: nenhum job real foi criado no sistema em uso
ainda.

### 2. Bola com (`jobs.bola_com` + `job_bola_com_history`)

```sql
ALTER TABLE jobs ADD COLUMN bola_com TEXT NOT NULL DEFAULT 'ilha'
  CHECK (bola_com IN ('ilha', 'cliente'));

CREATE TABLE job_bola_com_history (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  bola_com TEXT NOT NULL CHECK (bola_com IN ('ilha', 'cliente')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);
```

Toda troca de `bola_com` (manual, via toggle) grava uma linha nova em
`job_bola_com_history` e atualiza `jobs.bola_com`. Dois números são
derivados do histórico:

- **Dias no lado atual** ("N dias parado com o cliente"): `now() -
  changed_at` da última linha do histórico. Alimenta o farol de alerta e
  o banner de jobs travados.
- **Dias acumulados por lado** (barra "Ilha Xd / Cliente Yd" na timeline
  de responsabilidade): soma da duração de todos os intervalos de cada
  lado no histórico do job (do início até a troca seguinte, ou até agora
  para o intervalo aberto).

### 3. Última atividade do grupo (`jobs.last_whatsapp_activity_at`)

```sql
ALTER TABLE jobs ADD COLUMN last_whatsapp_activity_at TIMESTAMPTZ;
```

Nullable, editado manualmente no painel do job. Quando `NULL`, a linha
"Grupo sem movimento há Xh" não aparece. Quando preenchido, mostra `now()
- last_whatsapp_activity_at` formatado em horas/dias.

## Redesign — Board (`Board.tsx`)

Layout de dashboard:

- **Header**: nome da organização + "Torre de Controle / N jobs".
- **Sidebar**: busca por cliente/job/responsável; filtro **Farol**
  (Travado/Atenção/Fluindo com contagem, clicável, reaproveita
  `computeAlertLevel` já existente); filtro **Fase** (as 6 fases com sua
  cor e contagem de jobs ativos).
- **Banner de travados**: lista jobs com `farol = travado`, mostrando
  cliente, dias parados com o cliente (do `job_bola_com_history`) e
  responsável atual.
- **Cards de estatística**: jobs ativos (não completados); bola com a
  Ilha (contagem); bola com o cliente (contagem); retenção do cliente
  (soma de dias acumulados do lado cliente, todos os jobs ativos);
  entram em set esta semana (jobs cuja fase atual é Captação e cuja
  primeira entrada nessa fase caiu nos últimos/próximos 7 dias — critério
  a confirmar na hora de implementar, já que "entram em set" é um
  conceito novo sem equivalente atual).
- **Tabela de jobs**: mini-barra de progresso por fase (segmento colorido
  por fase, mais preenchido = mais avançado dentro da fase atual); nome
  do grupo/job; fase atual + "Aguardando: `<próximo item não marcado do
  checklist>`"; tag de bola-com com nome do responsável; barra de
  responsabilidade (dois segmentos, Ilha/Cliente, proporcional aos dias
  acumulados) + ponto de farol.

Painel "Grupos do WhatsApp" / "Ler conversa do grupo" do mockup **não
entra** nesta etapa (fica para a integração OpenWA).

## Redesign — Job Detail (`JobDetail.tsx`)

Painel lateral (slide-over):

- Cabeçalho: grupo · código do job, nome do job, fase atual (cor da
  fase), botão fechar.
- Linha de aviso "N dias parado com o cliente" (vermelho, só quando
  `farol = travado`).
- Linha "Grupo sem movimento há Xh" (âmbar, só quando
  `last_whatsapp_activity_at` estiver preenchido) — com um campo/ação
  pra editar esse timestamp manualmente.
- Toggle "Bola com a Ilha · Xd" / "Bola com o cliente · Yd" — clicar troca
  o lado (grava em `job_bola_com_history`).
- Linha de metadados: tipo de grupo, atendimento responsável, responsável
  atual (do `job_role_assignments` da fase corrente).
- Checklist por fase, uma seção por fase (cor + nome + contagem
  `feitos/total`): fase já concluída vem colapsada e 100% marcada; fase
  atual vem expandida por padrão; fases futuras vêm colapsadas e vazias.
  Cada item é o nome do status; marcar/desmarcar mapeia para
  avançar/reverter o status do job (reaproveita `advanceJob` já
  existente — marcar o item N avança o job até esse status).
- **Colar mensagens do WhatsApp**: textarea + botão "Analisar com IA",
  descrito na próxima seção.

## Classificação por IA (colagem manual, escopo do job aberto)

Fluxo: usuário abre um job, cola o texto de uma conversa do WhatsApp
daquele grupo, clica "Analisar com IA".

**Backend — novo endpoint** `POST /api/jobs/:id/classify`
- Corpo: `{ text: string }`.
- Servidor monta um prompt de sistema com: nome do job, fase atual,
  checklist completo da fase atual (itens já marcados e não marcados),
  estado atual de `bola_com`, e as regras de negócio abaixo.
- Chama a API da Anthropic **do servidor** (nunca do navegador — a chave
  fica só em `server/.env`, nova variável `ANTHROPIC_API_KEY`), usando
  o modelo `claude-sonnet-5`.
- Resposta esperada do modelo: lista de sugestões, cada uma com `{ tipo:
  'checklist_item' | 'bola_com', valor, confidence: number (0-1),
  evidencia: string (trecho da mensagem) }`.

**Política de aplicação por confiança:**
- `confidence >= 0.85`: aplica automaticamente (marca o item ou troca a
  bola), grava no histórico correspondente com a evidência como `note`.
  Exceção: se a sugestão for um **retrocesso** de fase (desmarcar um
  item de uma fase anterior à atual), nunca aplica automático — sempre
  vira sugestão pendente de confirmação, mesmo com confiança alta.
- `0.60 <= confidence < 0.85`: mostra como sugestão pendente na tela,
  com botões aplicar/descartar por item.
- `confidence < 0.60`: descarta, não mostra nem aplica.

**Frontend**: `web/src/api/client.ts` ganha `classifyJob(jobId, text)`;
o painel do job mostra o resultado (itens auto-aplicados com um selo
"aplicado pela IA", sugestões pendentes com botões de ação).

## Fora de escopo (explícito)

- Conexão real com WhatsApp (OpenWA, Docker, número dedicado, leitura
  automática de grupos).
- Detecção automática de inatividade do grupo (o campo é manual).
- Troca automática de bola-com (o toggle é manual).
- Painel geral de classificação (a IA só atua dentro de um job já
  aberto, nunca precisa identificar sozinha de qual job se trata).
- Redesign de `Users.tsx` e `Login.tsx` para a nova paleta pode ficar
  para uma segunda passada, já que não fazem parte de nenhuma referência
  visual fornecida — **a confirmar**: incluir esse polish agora ou depois?

## Riscos e assunções

- Cores exatas da marca são estimadas visualmente a partir da logo, não
  extraídas de um guia de marca oficial — ajustável depois se houver hex
  oficial.
- A decomposição dos status das fases 1, 3, 4, 5 e 6 (tudo exceto
  Dotação e Burocracia) é uma proposta minha baseada no texto já
  cadastrado, não confirmada por nenhuma referência visual — precisa de
  revisão do usuário antes da implementação.
- Assume que não há jobs reais em uso no sistema hoje, permitindo re-seed
  direto de `statuses` sem migração de dados históricos.
