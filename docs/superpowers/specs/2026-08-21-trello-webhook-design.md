# Webhook do Trello (atualização automática) — Design Spec

**Data:** 2026-08-21
**Status:** aprovado, aguardando plano de implementação

## Contexto e motivação

A integração de leitura com o Trello (`docs/superpowers/specs/2026-08-20-integracao-trello-design.md`,
já em produção) sincroniza um job só quando alguém abre a página dele no
Torre de Controle — puxa o card do Trello na hora, passa pelo
classificador de IA e aplica sugestões conforme a confiança. Isso deixou
webhooks explicitamente fora de escopo, como fase futura.

O usuário quer que qualquer atualização feita num card do Trello já
vinculado apareça no sistema automaticamente, sem precisar que alguém
abra o job primeiro. Este spec cobre essa fase futura: um endpoint que o
Trello chama sozinho a cada mudança no board.

## Direção confirmada

- **Só jobs já vinculados.** O webhook não tenta descobrir/vincular jobs
  novos — isso continua acontecendo do jeito que já funciona, quando
  alguém abre o job pela primeira vez. Card sem job vinculado = evento
  ignorado.
- **Aplica tudo, sem faixa de confiança**, só para atualizações vindas do
  Trello. Qualquer sugestão do classificador que passe pela validação
  estrutural (`isValidRawSuggestion`) é aplicada na hora, independente da
  confiança — sem a faixa "pendente" (60–84%) nem o descarte por baixa
  confiança (<60%) que a sincronização manual ainda usa.
  - As duas travas de integridade dos dados continuam valendo sempre,
    mesmo nesse modo: nunca retroceder a fase automaticamente, e nunca
    reescrever um status/lado que o job já está (evita duplicar
    histórico à toa).
  - **A sincronização disparada por abrir o job (`POST /:id/trello-sync`)
    não muda** — continua com as faixas de 85%/60% de hoje.
- **Um board só**, mesma credencial única já configurada — sem mudança
  de escopo em relação ao spec anterior.
- **Verificação de assinatura obrigatória**: qualquer chamada ao endpoint
  que não vier assinada pelo Trello é rejeitada. Sem isso, a URL do
  endpoint sozinha seria suficiente pra qualquer pessoa forjar uma
  atualização num job.
- **Configuração é um passo manual único**, feito depois do deploy — o
  app não se registra sozinho como webhook do Trello a cada subida.

## Credenciais novas

Duas variáveis novas em `server/.env` (nunca expostas ao frontend), somando-se
às três que já existem (`TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_ID`):

```
TRELLO_API_SECRET=
TRELLO_WEBHOOK_CALLBACK_URL=
```

`TRELLO_API_SECRET` é o "Secret" mostrado na mesma tela do Trello
Power-Ups onde a `TRELLO_API_KEY` foi gerada (não é o `TRELLO_TOKEN`).
`TRELLO_WEBHOOK_CALLBACK_URL` é a URL pública de produção que o Trello vai
chamar — ex.: `https://torre-de-controle-teal.vercel.app/api/trello-webhook`.

O webhook fica desabilitado (endpoint responde `200` sem processar nada)
se essas duas variáveis, junto com as três já existentes, não estiverem
todas configuradas — mesmo padrão de degradação já usado para
`ANTHROPIC_API_KEY` e para o restante do Trello.

## Verificação de assinatura

O Trello assina cada `POST` de webhook com o cabeçalho `X-Trello-Webhook`:

```
X-Trello-Webhook = base64(HMAC-SHA1(TRELLO_API_SECRET, corpo_bruto_da_requisição + TRELLO_WEBHOOK_CALLBACK_URL))
```

Pra isso funcionar, o servidor precisa ter acesso aos bytes brutos do
corpo da requisição (não só o JSON já parseado) — o `express.json()`
global em `server/src/app.ts` passa a guardar o buffer bruto via sua
opção `verify`, disponível em `req` para o handler do webhook usar no
cálculo do HMAC. Isso não muda o comportamento de nenhuma outra rota.

Uma requisição cujo cabeçalho não bate com o HMAC calculado é rejeitada
com `401`, sem tocar em nenhum job.

## Endpoint

**`POST /api/trello-webhook`** — sem autenticação de usuário (o Trello
não é um usuário logado); a segurança vem inteiramente da verificação de
assinatura acima. Registrado fora do `requireAuth`/`requireActiveUser`
que protege as demais rotas.

**`HEAD /api/trello-webhook`** — responde `200` sem corpo e sem
processar nada. O Trello manda um `HEAD` pra essa URL no momento em que o
webhook é registrado, só pra confirmar que ela existe e responde.

Fluxo do `POST`:

1. Se `TRELLO_API_KEY`/`TOKEN`/`BOARD_ID`/`API_SECRET`/`WEBHOOK_CALLBACK_URL`
   não estiverem todos configurados: responde `200` sem processar (mesmo
   padrão de degradação silenciosa do resto da integração).
2. Calcula o HMAC do corpo bruto + `TRELLO_WEBHOOK_CALLBACK_URL` e compara
   com o cabeçalho `X-Trello-Webhook`. Se não bater: `401`, não processa.
3. Lê `action.data.card.id` do payload. Ações do Trello que não trazem um
   card (ex.: mudanças de membro do board) não têm esse campo — nesse
   caso responde `200` e não faz nada.
4. Procura um job com esse `trello_card_id`. Se não achar nenhum (a
   grande maioria dos ~430 cards do board não corresponde a nenhum job
   aqui): responde `200`, não faz nada.
5. Se achar: chama a função de sincronização compartilhada (ver seção
   seguinte) com o modo "aplica tudo" ligado, e responde `200` com o
   resultado.
6. Se a chamada ao Trello pra buscar o card falhar (rede, limite de
   taxa): responde `200` mesmo assim (evita que o Trello desative o
   webhook depois de falhas repetidas) e só registra o erro no log do
   servidor — não há um usuário esperando essa resposta.

## Sincronização compartilhada (refatoração)

Os passos que hoje estão dentro da rota `POST /:id/trello-sync` — buscar
o card, atualizar responsáveis a partir dos membros do card, montar o
texto de evidência, chamar o classificador — saem para uma função nova,
`syncJobFromTrello`, em `server/src/models/trelloLink.ts`:

```ts
export interface TrelloSyncResult {
  status: 'synced' | 'card_not_found';
  suggestions?: ResolvedSuggestion[];
  trelloCard?: { name: string; listName: string };
}

export async function syncJobFromTrello(
  db: AppDatabase,
  trelloClient: TrelloClient,
  classifier: Classifier,
  job: Job,
  options: { bypassConfidenceGate: boolean },
): Promise<TrelloSyncResult>
```

Tanto `POST /:id/trello-sync` (chama com `bypassConfidenceGate: false`,
comportamento idêntico ao de hoje) quanto o novo `POST /api/trello-webhook`
(chama com `bypassConfidenceGate: true`) passam a usar essa única função —
sem lógica duplicada entre os dois caminhos.

## Bypass da faixa de confiança em `classifyAndApply`

`server/src/models/classification.ts` ganha um parâmetro novo, opcional,
sem mudar o comportamento de quem já chama a função sem ele:

```ts
export async function classifyAndApply(
  db: AppDatabase,
  classifier: Classifier,
  jobId: number,
  pastedText: string,
  options: { bypassConfidenceGate?: boolean } = {},
): Promise<ResolvedSuggestion[]>
```

Dentro de `resolveAndApply`, quando `bypassConfidenceGate` é `true`:

- O descarte por confiança abaixo de 60% (`SUGGEST_THRESHOLD`) não se
  aplica — qualquer sugestão estruturalmente válida (já passou por
  `isValidRawSuggestion`) é candidata a aplicar.
- Onde hoje a condição de auto-aplicar é
  `suggestion.confidence >= AUTO_APPLY_THRESHOLD && !isRegression`, o
  bypass remove só a exigência de confiança — vira `!isRegression`. A
  trava contra retroceder fase **continua exigida sempre**, com ou sem
  bypass.
- As duas checagens de "já está nesse status/lado, não faz nada" (linhas
  129–135 e 152–157 do arquivo atual) continuam idênticas, com ou sem
  bypass — não são sobre confiança, são sobre não duplicar histórico à
  toa.
- Quando o bypass está ligado e a sugestão não é regressão, o resultado é
  sempre `'auto_aplicado'` (nunca `'pendente'`) — a chamada quem decide
  cortar aplica; o que sobra pra descartar é só regressão de fase ou
  reconfirmação, não confiança.

## Registro do webhook no Trello (passo manual, uma vez)

Depois do deploy com as credenciais configuradas, o registro é uma
chamada única à API do Trello (feita por mim, com `curl`, usando a key,
token e secret já configurados):

```
POST https://api.trello.com/1/webhooks
  ?key={TRELLO_API_KEY}
  &token={TRELLO_TOKEN}
  &callbackURL={TRELLO_WEBHOOK_CALLBACK_URL}
  &idModel={TRELLO_BOARD_ID}
  &description=Torre de Controle - sincronização automática
```

O Trello confere a `callbackURL` com um `HEAD` antes de aceitar o
registro — por isso o endpoint precisa já estar no ar (deploy feito)
antes desse passo. Uma vez registrado, o webhook fica válido
indefinidamente do lado do Trello; não precisa repetir esse passo em
deploys futuros, a não ser que a URL de produção mude.

## Erros e degradação

- Credenciais do webhook incompletas: endpoint sempre responde `200` sem
  processar — mesmo padrão do resto da integração Trello.
- Assinatura inválida: `401`, evento ignorado.
- Ação sem card, ou card sem job vinculado: `200`, evento ignorado.
- Falha ao buscar o card no Trello, ou classificador de IA não
  configurado (`ANTHROPIC_API_KEY` ausente): `200`, evento ignorado,
  erro registrado só no log do servidor — não existe uma tela de usuário
  esperando essa resposta, então não há onde mostrar um erro visível.
- Card vinculado que sumiu do Trello (retorna `null`): mesmo tratamento
  que a sincronização manual já dá hoje — desvincula o job
  (`trello_card_id = NULL`), pra próxima vez que alguém abrir o job a
  vinculação rodar de novo.

## Fora de escopo (explícito)

- Descoberta/vinculação automática de jobs novos via webhook — só jobs
  já vinculados são afetados.
- Qualquer escrita de volta no Trello.
- Fila ou processamento assíncrono do evento — o handler processa e
  responde de forma síncrona, dentro da mesma requisição.
- Re-registro automático do webhook a cada deploy.
- Múltiplos boards.

## Riscos e assunções

- O handler roda de forma síncrona, incluindo a chamada ao classificador
  de IA — no volume atual (dezenas de jobs, eventos esporádicos), isso
  fica bem dentro do tempo de execução de uma function da Vercel. Se o
  volume crescer muito, isso pode precisar virar assíncrono no futuro,
  mas não é um problema hoje.
- Sem faixa de confiança, uma leitura ruidosa do classificador (ex.: um
  comentário do Trello mal interpretado) aplica direto no job, sem
  chance de revisão manual antes — foi uma escolha explícita do usuário
  ao aprovar este spec, sabendo que remove essa proteção especificamente
  para atualizações vindas do Trello.
- Se o Trello mudar o formato do payload de webhook (ação sem
  `data.card.id` num formato inesperado), o evento é simplesmente
  ignorado (não há `card.id` pra casar com um job) — comportamento
  seguro por padrão, sem quebrar nada.
