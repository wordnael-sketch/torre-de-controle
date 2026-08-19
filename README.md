# Sistema de Acompanhamento de Jobs — Ilha Crossmídia

Ver spec completa em `docs/superpowers/specs/2026-08-18-sistema-acompanhamento-jobs-design.md`.

## Estrutura

- `server/` — API (Node.js + Express + TypeScript + PostgreSQL via Supabase). Deploy em
  plataforma always-on (Railway, Render, ou VPS) — **não** em serverless/Vercel, pois
  mantém conexão persistente com o WhatsApp (em planos futuros deste projeto).
- `web/` — Frontend (React + Vite + TypeScript). Deploy no Vercel.

## Pré-requisitos

- Node.js 18 ou superior.
- Um projeto no [Supabase](https://supabase.com/dashboard) (gratuito): crie a conta
  (pode entrar com Google), crie um projeto, e em **Project Settings → Database →
  Connection string** copie a *session pooler* connection string (porta 5432) — a
  conexão direta (`db.<ref>.supabase.co`) exige IPv6 e pode não funcionar em toda rede.
- Uma credencial OAuth do Google (Google Cloud Console → APIs & Services →
  Credentials → Create OAuth client ID → Web application), com as origens
  JavaScript autorizadas incluindo `http://localhost:5173` (dev) e, depois do
  deploy, o domínio do Vercel.

## Rodando localmente

Backend:

```bash
cd server
cp .env.example .env   # preencha DATABASE_URL, GOOGLE_CLIENT_ID e JWT_SECRET
npm install
npm run dev
```

Frontend (em outro terminal):

```bash
cd web
cp .env.example .env   # preencha VITE_GOOGLE_CLIENT_ID
npm install
npm run dev
```

Acesse `http://localhost:5173`.

## Deploy

- **Backend**: Railway ou Render, apontando para o diretório `server/`. Configure as
  variáveis de ambiente do `server/.env.example` (`DATABASE_URL` do Supabase, e o
  domínio real do frontend em `FRONTEND_URL`) e garanta que o plano escolhido não hiberna
  o processo por inatividade — o banco em si já é gerenciado pelo Supabase, então o
  backend não precisa de disco persistente próprio.
- **Frontend**: Vercel, apontando para o diretório `web/` (framework preset
  Vite). Configure `VITE_API_BASE_URL` com a URL pública do backend e
  `VITE_GOOGLE_CLIENT_ID`.
- Depois do primeiro deploy, volte ao Google Cloud Console e adicione o
  domínio de produção do Vercel às origens JavaScript autorizadas do OAuth
  client.

## Checklist de verificação manual

Depois de rodar (local ou em produção), confirme manualmente:

- [ ] `GET /api/health` no backend responde `{"status":"ok"}`.
- [ ] Login com uma conta Google `@ilhacrossmidia.com.br` funciona e leva ao
      dashboard.
- [ ] Login com uma conta Google de outro domínio é rejeitado (erro 403).
- [ ] Criar um job no dashboard faz ele aparecer na lista imediatamente.
- [ ] Recarregar a página mantém o usuário logado (cookie de sessão persiste).
- [ ] Logout limpa a sessão e volta para a tela de login.
