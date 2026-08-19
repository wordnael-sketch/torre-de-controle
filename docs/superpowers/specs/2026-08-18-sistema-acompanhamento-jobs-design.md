# Sistema de Acompanhamento de Jobs — Ilha Crossmídia

**Data:** 2026-08-18
**Status:** Aprovado para planejamento de implementação

## 1. Contexto e Problema

A Ilha Crossmídia é uma produtora audiovisual cujo fluxo de produção (jobs) passa por
seis grandes fases — Comercial/Orçamento, Pós-venda/Dotação, Pré-Produção, Captação,
Pós-Produção e Encerramento — envolvendo dezenas de papéis (Comercial, Produção
Executiva, Atendimento, Direção, Produção, Técnica, Pós-Produção, Financeiro,
Jurídico, Marketing, RH).

Hoje, o acompanhamento do andamento de cada job depende de:
- **Trello**: um board único (`ATENDIMENTO:: ILHA :: STATUS`) onde cada card é um job
  e a lista em que o card está representa sua fase atual.
- **WhatsApp**: cada job tem um conjunto de grupos (ex: `EXEC`, `GERAL`, `PÓS`) nomeados
  com um padrão consistente (`PREFIXO CÓDIGO-ANO_CLIENTE_DESCRIÇÃO`, ex:
  `EXEC 0307-2026_COLGATE_WPP-LW COLOR CORRECT WAVE 2`), onde periodicamente é postada
  uma mensagem formatada de status (ex: `*COLGATE - STATUS 1608 (domingo)*` seguida de
  blocos como Drive, Cronograma, PPM).

Não existe hoje uma visão unificada: o Gerente de Projeto precisa checar manualmente o
Trello e vasculhar dezenas de grupos de WhatsApp para saber o status real de cada job,
quem é o responsável no momento e se há algum gargalo.

## 2. Objetivo

Construir um sistema web que dê ao Gerente de Projeto uma "torre de controle" com a
visão de todos os jobs, seus status, responsáveis e histórico — consolidando dados do
Trello e do WhatsApp automaticamente, com edição manual sempre disponível para manter
tudo atualizado.

## 3. Usuário e Escopo de Acesso

- **Usuário único**: o Gerente de Projeto. Não há outros perfis/dashboards no MVP.
- Login via **Google OAuth**, restrito ao domínio `ilhacrossmidia.com.br` (Google
  Workspace já usado pela empresa). Sem senha própria do sistema.
- No primeiro acesso, o Gerente passa por um onboarding de vínculo de contas (seção 6).

## 4. Arquitetura

Serviço único, hospedado na nuvem, processo **sempre ativo** (sem "scale to zero" —
a conexão do WhatsApp precisa ficar aberta continuamente para captar mensagens em
tempo real).

Componentes internos:

- **Frontend web** (React/Vite SPA) — o dashboard do Gerente.
- **API** (Node.js/Express) — serve o frontend e expõe os dados.
- **Conector WhatsApp** (biblioteca não-oficial tipo Baileys, protocolo WhatsApp Web) —
  mantém a sessão logada via QR Code, escuta mensagens dos grupos vinculados.
- **Conector Trello** — consome a API oficial do Trello via polling periódico
  (~5 minutos) para saber em qual lista (fase) cada card vinculado está.
- **Banco de dados**: SQLite em disco persistente. Suficiente para 1 usuário e o
  volume de dados esperado; migrável para Postgres se o escopo crescer no futuro.

**Hospedagem recomendada**: plataforma com disco persistente e processo "always-on"
(ex: Railway, Render em plano pago, ou uma VPS pequena com Docker). Planos serverless
com "scale-to-zero" são inadequados — eles derrubariam a sessão do WhatsApp.

**Risco assumido e aceito pelo usuário**: o uso de uma biblioteca não-oficial de
WhatsApp Web viola os Termos de Uso do WhatsApp e pode levar ao banimento do número
vinculado. Não há alternativa oficial viável para este caso de uso (a WhatsApp
Business API não cobre leitura de grupos internos). Mitigação: usar um número
dedicado (não crítico) para o vínculo, e desenhar o conector para reconectar de forma
gradual (evitar reconexões agressivas que aumentem o risco de flag).

## 5. Modelo de Dados (essencial)

- **Job**: id, nome, código (se houver), cliente, fase atual (derivada do Trello),
  responsável atual (campo editável pelo Gerente), notas gerais.
- **Vínculo Trello**: `job_id ↔ trello_card_id`.
- **Vínculo WhatsApp**: `job_id ↔ [group_jid]` (um job pode ter vários grupos: Exec,
  Geral, Pós, etc.).
- **Mensagem de status**: mensagens capturadas nos grupos vinculados que batem com o
  padrão de status (`*CLIENTE - STATUS ddmm (dia)*` ou variações próximas) — texto
  completo, timestamp, grupo de origem. Marcadas como destaque no feed do job.
- **Feed de mensagens**: demais mensagens dos grupos vinculados, guardadas como
  histórico cronológico simples (sem tentativa de interpretação automática).
- **Nota diária**: entradas manuais do Gerente por job — texto livre + timestamp,
  editável e adicionável a qualquer momento.
- **Histórico de fase**: registro automático toda vez que o Trello mover o card de
  lista — fase anterior, fase nova, timestamp. Permite calcular tempo gasto por fase.

## 6. Onboarding e Vínculo de Contas

1. **Login Google** (domínio restrito).
2. **Vincular WhatsApp**: o sistema exibe um QR Code na tela; o Gerente escaneia pelo
   app do WhatsApp (fluxo padrão de WhatsApp Web/multi-dispositivo). A sessão fica
   salva no servidor. Se a sessão cair (expirar, ser deslogada no celular), o
   dashboard mostra um aviso pedindo novo escaneamento.
3. **Vincular Trello**: fluxo OAuth padrão do Trello (autoriza o app, gera token). O
   sistema lista os boards visíveis e o Gerente escolhe o board de acompanhamento de
   jobs (`ATENDIMENTO:: ILHA :: STATUS`).

## 7. Vínculo Job ↔ Trello ↔ WhatsApp

Não há um identificador comum confiável entre Trello e WhatsApp hoje (os cards do
Trello não trazem o código do job que aparece nos nomes dos grupos). Portanto o
vínculo é **assistido, não automático**:

- Ao criar/configurar um job no sistema, o Gerente busca pelo nome; o sistema sugere
  candidatos:
  - **Trello**: cards cujo título tem maior similaridade textual com o nome buscado.
  - **WhatsApp**: grupos cujo nome contém termos parecidos (incluindo o código do job,
    quando presente, ex: `0307-2026`).
- O Gerente confirma manualmente os vínculos corretos (pode ser mais de um grupo de
  WhatsApp por job — Exec, Geral, Pós — mas apenas um card do Trello).
- Vínculos ficam salvos e não precisam ser refeitos depois.

## 8. Integração WhatsApp — Comportamento

- O conector escuta continuamente todos os grupos vinculados a algum job.
- Mensagens que casam com o padrão de cabeçalho de status são destacadas como
  "mensagem de status oficial" na página do job.
- As demais mensagens compõem um feed cronológico simples, sem tentativa de
  extrair/inferir status automaticamente a partir de texto livre (risco de erro e
  desconfiança do usuário — fora de escopo do MVP).

## 9. Integração Trello — Comportamento

- Poll a cada ~5 minutos no board configurado.
- A lista onde o card vinculado está = fase atual do job, mapeada para as 6 fases do
  fluxo da Ilha.
- Mudança de lista dispara: atualização do status do job + novo registro no histórico
  de fase.

## 10. Dashboard do Gerente

- **Visão geral**: todos os jobs agrupados por fase (espelhando as listas do Trello),
  com indicador visual tipo farol (verde/amarelo/vermelho) por job.
- **Página do job**: fase atual, responsável (editável), histórico de fase, feed de
  mensagens do WhatsApp (com destaque para as mensagens de status oficiais), campo de
  notas diárias (adicionar/editar a qualquer momento).
- **Alertas (farol)**: regras configuráveis, com defaults derivados do fluxo mapeado
  da Ilha — ex: job parado há mais de X dias na mesma fase sem mensagem de status nova
  = amarelo; mais de Y dias = vermelho. Regras super específicas do negócio (ex:
  limite de 14h de set) ficam como nota manual do Gerente no MVP, não automatizadas.

## 11. Fora do Escopo do MVP

- Múltiplos usuários, perfis ou permissões por setor.
- Detecção automática de mudança de fase por IA a partir do texto livre do WhatsApp.
- Notificações push ou por e-mail (fica só no próprio dashboard).
- Regras de alerta hiper-específicas do negócio (ex: limite de horas de set) —
  ficam manuais por enquanto, podem virar regra automática numa iteração futura.
- Vínculo automático Trello↔WhatsApp sem confirmação humana (sem identificador comum
  confiável hoje).

## 12. Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| Banimento do número de WhatsApp vinculado (uso de biblioteca não-oficial) | Usar número dedicado, não crítico; reconexão gradual, não agressiva |
| Perda de mensagens se o processo cair | Reconexão automática + sincronização de histórico recente ao reconectar (limitada pelo que o protocolo permite) |
| Vínculo Job↔Trello↔WhatsApp errado no cadastro | Confirmação manual obrigatória do Gerente antes de salvar qualquer vínculo sugerido |
| Hospedagem "dormir" por inatividade e derrubar sessão do WhatsApp | Escolher plano/plataforma explicitamente "always-on", sem scale-to-zero |

## 13. Testes

- Testes automatizados de unidade para: extração/matching de padrão de mensagem de
  status, lógica de sugestão de candidatos (similaridade de nome), cálculo de farol de
  alerta, cálculo de histórico de fase.
- Testes manuais guiados para os fluxos de integração real (login Google, QR Code do
  WhatsApp, OAuth do Trello) — não são facilmente automatizáveis por dependerem de
  serviços externos reais.
