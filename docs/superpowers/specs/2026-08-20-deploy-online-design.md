# Deploy Online (GitHub + Vercel) — Design Spec

**Data:** 2026-08-20
**Status:** aprovado, aguardando plano de implementação

## Contexto e motivação

"Torre de Controle" roda hoje só localmente: `server/` (Node/Express +
TypeScript) num terminal, `web/` (Vite + React + TypeScript) noutro, ambos
apontando para um Postgres real já hospedado no Supabase. O repositório
Git local está 88 commits à frente de um remoto GitHub inacessível
("Repository not found") — nunca foi possível dar push nesta sessão.

Este spec cobre colocar o sistema no ar: um repositório GitHub novo
recebendo todo o histórico local, e um deploy automático na Vercel a
partir dele, mantendo o Postgres do Supabase como está (só ajustando a
porta de conexão usada em produção).

## Direção confirmada

- **Repositório GitHub novo**, nome `torre-de-controle`, privado,
  recebendo o histórico completo do branch `master` atual (não o remoto
  antigo quebrado).
- **Um único projeto Vercel** servindo frontend e backend no mesmo
  domínio — não dois projetos separados.
- **O Express inteiro vira uma única Vercel Function** (não quebrado por
  rota) — a Vercel detecta e adapta automaticamente um app Express
  exportado como handler. Nenhuma rota, modelo, ou lógica de negócio
  muda.
- **Deploy automático a cada push no `master`** — sem preview deploys por
  PR por enquanto (YAGNI; dá para adicionar depois).
- **Conexão com o banco em produção usa a porta 6543** (pooler
  "transaction" do Supabase, feito para muitas conexões curtas e
  concorrentes) em vez da porta 5432 (pooler "session", usada hoje só em
  desenvolvimento local) — troca só na variável de ambiente da Vercel,
  `DATABASE_URL` local continua igual.

## Arquitetura

```
repo (GitHub, privado)
├── web/          → build estático (Vite), servido pela Vercel como assets
├── server/
│   ├── src/       → inalterado (models, routes, app.ts, etc.)
│   └── api/
│       └── index.ts   → NOVO: cria db+app uma vez, exporta o app Express
└── vercel.json    → NOVO: aponta /api/* para server/api/index.ts,
                      aponta o resto para o build estático de web/
```

`server/src/index.ts` (o `app.listen()` atual, usado por `npm run dev`)
não muda — continua sendo como o desenvolvimento local roda o servidor.
`server/api/index.ts` é um segundo ponto de entrada, só para produção na
Vercel: mesmo `createDb`/`createApp` das mesmas fontes, só que sem
`app.listen()` — a Vercel chama o app exportado diretamente a cada
requisição. Como a criação de `db`/`app` acontece fora do handler (no
escopo do módulo), instâncias "quentes" da function reaproveitam a mesma
conexão entre chamadas, em vez de recriar tudo a cada requisição.

## Variáveis de ambiente (cadastradas na Vercel)

Backend (mesmas do `server/.env`, valores de produção):
- `DATABASE_URL` — igual à de hoje, mas com `:6543` em vez de `:5432`.
- `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `ALLOWED_EMAIL_DOMAIN`,
  `ANTHROPIC_API_KEY` — mesmos valores de hoje.
- `FRONTEND_URL` — passa a ser a própria URL de produção da Vercel (já
  que frontend e backend ficam no mesmo domínio).
- `NODE_ENV=production` — já é o que ativa `secure`/`sameSite: 'none'`
  no cookie de sessão (`server/src/routes/auth.ts`), sem mudança de
  código necessária, só de ambiente.

Frontend (build-time, Vite):
- `VITE_GOOGLE_CLIENT_ID` — mesmo valor de hoje. Fica em texto aberto no
  bundle final (é assim que o Google Identity Services funciona no
  navegador — não é segredo).
- `VITE_API_BASE_URL` — fica **vazio/não definido** em produção, já que
  o cliente HTTP (`web/src/api/client.ts`) já usa caminho relativo por
  padrão quando essa variável não está setada, e frontend+backend
  estarão no mesmo domínio.

## Passo manual fora do código: Google OAuth

O domínio novo de produção da Vercel precisa ser adicionado manualmente
em "Authorized JavaScript origins" do OAuth Client ID no Google Cloud
Console — isso não pode ser automatizado por aqui, é uma configuração na
conta Google do projeto. Necessário antes do login funcionar em produção.

## Pipeline

1. Push do histórico local para o repositório GitHub novo.
2. Projeto Vercel conectado a esse repositório — cada push em `master`
   dispara build (`web/` via Vite, `server/api/index.ts` via
   `@vercel/node`) e deploy automático de produção.
3. Variáveis de ambiente cadastradas uma vez no painel/integração da
   Vercel, não versionadas no repositório.

## Não-metas (fora de escopo deste spec)

- Preview deployments por Pull Request — YAGNI por agora, revisitar se o
  fluxo de trabalho pedir.
- Domínio customizado (fica no domínio padrão `*.vercel.app` por
  enquanto) — trocar depois é só configuração no painel da Vercel, sem
  impacto de código.
- Dividir o Express em múltiplas Functions por rota — o app inteiro como
  uma função só é suficiente para o volume de uso esperado (equipe
  interna pequena).
- Migrar o Postgres para fora do Supabase, ou mudar de provedor de IA —
  nenhum dos dois muda.
- CI (testes automatizados rodando antes do deploy) — a Vercel só builda
  e publica; os testes continuam rodando manualmente/localmente como
  hoje. Pode virar um spec separado no futuro.

## Testes (cobertura esperada, detalhada no plano)

- `server/api/index.ts` precisa de pelo menos um teste de fumaça
  confirmando que o app exportado responde `GET /api/health` sem erro,
  usando as mesmas dependências injetáveis já usadas pelos testes de
  rota existentes (`createApp`) — não é um teste de infraestrutura da
  Vercel (isso não é testável localmente), só confirma que o novo
  arquivo de entrada monta o app corretamente.
- Nenhum teste existente muda — este spec não altera nenhuma rota,
  modelo, ou comportamento, só adiciona uma nova forma de expor o app já
  testado.
