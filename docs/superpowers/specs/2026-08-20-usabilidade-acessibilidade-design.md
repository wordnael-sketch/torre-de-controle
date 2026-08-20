# Usabilidade, Acessibilidade e Responsividade — Design Spec

**Data:** 2026-08-20
**Status:** aprovado, aguardando plano de implementação

## Contexto e motivação

O redesign visual anterior (Torre de Controle) entregou uma UI funcional e
no padrão visual da marca, mas com três lacunas apontadas pelo uso real:
(1) abrir um job troca de rota inteiramente, deixando a tela em branco à
esquerda em vez de manter a lista de jobs visível; (2) zero tratamento de
tela pequena — nenhuma `@media query` existe em nenhum dos cinco arquivos
CSS do projeto; (3) uma acessibilidade parcial (alguns `aria-*` já
existem, mas sem baseline consistente de contraste, tamanho de fonte,
foco visível ou tags semânticas).

Este spec cobre essas três lacunas mais dois pedidos adicionais de UX:
feedback claro (toasts de sucesso, modal de confirmação em ações menos
reversíveis) e ícones descritivos.

## Decisões confirmadas

- **Ícones**: adicionar `lucide-react` como dependência nova — pequena,
  sem opinião visual própria, compatível com o sistema de tokens já
  existente.
- **Visualização de jobs**: a tabela densa do Board (já aprovada) continua
  no desktop; abaixo do breakpoint mobile, cada linha vira um card
  empilhado. Não vira um Kanban de colunas por fase.
- **Modal de confirmação**: só em duas ações — revogar acesso de um
  usuário e marcar um job como concluído (chegar ao último item do
  checklist da última fase). Toda outra ação (trocar status, trocar
  bola, atribuir pessoa, colar texto) continua instantânea.

## 1. Board + JobDetail como overlay único

Hoje `/` e `/jobs/:id` são duas rotas que renderizam páginas totalmente
diferentes (`Board` vs `JobDetailPage`), então abrir um job faz a lista
sumir. As duas rotas passam a renderizar o mesmo `<Board />`. Dentro de
`Board.tsx`, `useParams<{ id?: string }>()` verifica se a URL tem um
`id`; se tiver, `JobDetailPage` (sem mudanças na sua própria lógica
interna, que já lê `useParams` sozinha) é renderizado por cima, como uma
gaveta:

- `position: fixed`, ocupando a largura já definida (`max-width: 560px`
  em telas largas, tela cheia em mobile — ver seção de responsividade),
  colada à direita.
- Um backdrop semi-transparente (`position: fixed`, cobrindo a tela
  inteira, atrás da gaveta) fecha a gaveta ao ser clicado
  (`navigate('/')`).
- Tecla Esc também fecha.
- Ao abrir, o foco do teclado move pro primeiro elemento focável da
  gaveta; ao fechar, volta pro link do job que abriu a gaveta.

A tabela de jobs do Board nunca é desmontada — continua rolável e
interativa por trás do backdrop (mas o backdrop bloqueia clique nela
enquanto a gaveta está aberta, padrão comum de modal).

## 2. Responsividade mobile-first

Três breakpoints, usados como `@media` em todos os arquivos CSS do
projeto (`tokens.css` ganha as variáveis de referência em comentário, já
que `@media` não aceita `var()` no seletor):

```
mobile:  até 639px
tablet:  640px – 1023px
desktop: a partir de 1024px
```

**Board**: a barra lateral de filtros (hoje sempre visível, 260px fixos)
vira, abaixo de 1024px, um botão "Filtros" no cabeçalho que abre/fecha um
painel (mesmo padrão de gaveta da seção 1, reaproveitando o mesmo
componente de overlay). Os 5 cards de estatística, que hoje são
`grid-template-columns: repeat(5, 1fr)`, viram 2 colunas no tablet e 1 no
mobile. A tabela de jobs, abaixo de 768px, deixa de ser `<table>`
tradicional — cada `<tr>` vira um cartão com pares rótulo/valor
empilhados (nome do job, fase atual, bola com, farol), mantendo a mesma
informação, só reorganizada verticalmente.

**JobDetail (gaveta)**: `max-width: 560px` só vale a partir do tablet; no
mobile a gaveta ocupa 100% da largura e altura da tela (comportamento de
"tela cheia" comum em apps mobile).

**Alvo de toque**: todo elemento clicável (botões, itens de checklist,
linhas de filtro, botões de fase) ganha `min-height: 48px` e
`min-width: 48px` quando aplicável, via padding ajustado — sem mudar o
texto/conteúdo visível.

## 3. Acessibilidade — baseline WCAG AA

- **Tipografia**: `body { font-size: 14px }` em `tokens.css` sobe para
  `16px`. Como quase todo espaçamento no projeto usa `rem`, isso escala
  proporcionalmente o resto da interface — o plano deve conferir
  visualmente que nada quebra (texto cortado, sobreposição) depois da
  mudança.
- **Contraste**: auditar cada cor de texto contra seu fundo nos tokens
  atuais (`--text-secondary` sobre `--bg-panel`, `--text-inverse` sobre
  cada `--fase-N`, etc.) contra a razão mínima 4.5:1 (texto normal) — a
  tarefa que fizer isso deve listar os pares testados e o resultado, e
  ajustar qualquer tom que não passe.
- **Foco visível**: `tokens.css` ganha uma regra `:focus-visible` global
  (contorno colorido usando um token novo, ex. `--focus-ring`), já que
  vários componentes hoje removem ou não garantem o contorno padrão do
  navegador em botões customizados.
- **HTML semântico**: `Board.tsx` troca a `<div>` da barra lateral por
  `<aside>`, a área principal por `<main>`, o cabeçalho por `<header>`
  (já existe em `App.tsx`, falta em `Board.tsx`); listas de filtro viram
  `<nav>` com `aria-label` descritivo.
- **Leitor de tela / teclado**: a gaveta (seção 1) ganha
  `role="dialog"`, `aria-modal="true"`, `aria-labelledby` apontando pro
  título do job. O botão de fechar dela e o "Filtros" mobile (seção 2)
  seguem o mesmo padrão de foco preso/retornado. Os `aria-checked`/
  `aria-pressed` já adicionados no redesign anterior continuam; a
  auditoria desta task cobre os elementos que ainda não têm (botão de
  fechar da gaveta, botão "Filtros", itens do modal de confirmação).

## 4. Feedback: toast e modal de confirmação

**`web/src/components/Toast.tsx`** (novo): um sistema simples de
notificação — uma função exportada (`showToast(message, type)`, tipo
`'success' | 'error'`) que empilha uma notificação num canto da tela,
some sozinha depois de alguns segundos (não instantaneamente — tempo
suficiente pra ler), com `role="status"` (sucesso) ou `role="alert"`
(erro) pra leitor de tela. Substitui gradualmente o padrão atual de
`<p role="alert">{error}</p>` inline em cada página — mas mantém
compatibilidade: páginas que já usam o padrão inline continuam
funcionando, o toast é usado nas ações novas (revogar, concluir) e pode
ser adotado nas existentes na mesma task, sem quebrar nada.

**`web/src/components/ConfirmDialog.tsx`** (novo): modal reaproveitável
(`role="alertdialog"`, foco preso, Esc cancela) com título, mensagem e
dois botões (confirmar/cancelar) configuráveis por prop. Duas telas
passam a usá-lo:
- `Users.tsx`: revogar o acesso de um usuário mostra "Revogar acesso de
  `<email>`? Essa pessoa perde acesso ao sistema até ser reativada." com
  botões "Revogar" / "Cancelar".
- `JobDetail.tsx`: clicar no último item do checklist da última fase
  (Encerramento) mostra "Marcar job como concluído? Isso completa o
  ciclo do job." com botões "Concluir" / "Cancelar" — só nesse caso
  específico (chegar à conclusão), não em qualquer clique de checklist.

## 5. Ícones (`lucide-react`)

Substituições pontuais, não uma repaginação visual completa: botão
"Criar novo job" ganha um ícone de "+", os pontos do farol continuam
como estão (já são um indicador de cor válido, ícone seria redundante),
o botão de fechar a gaveta usa o ícone `X` do lucide em vez do caractere
"×", o botão de bola-com pode ganhar um ícone simples indicando
direção/responsabilidade. Todo ícone que substitui texto (não acompanha
texto ao lado) leva `aria-label` explicando o que ele faz.

## 6. Textos de botão

Revisão pontual dos rótulos mais genéricos: "+ Novo job" → "+ Criar novo
job". A auditoria completa acontece durante a implementação; qualquer
outro rótulo pouco claro encontrado no processo é corrigido na mesma
task sem precisar de uma task separada.

## Fora de escopo (explícito)

- Substituir a tabela do Board por colunas Kanban.
- Migrar para uma biblioteca de componentes (Tailwind, shadcn/ui, etc.) —
  os tokens CSS já existentes continuam sendo a única fonte de estilo.
- Modo escuro / alternância de tema.
- Internacionalização (o sistema continua só em português).
- Testes automatizados de acessibilidade (axe-core, Lighthouse CI) — a
  auditoria desta spec é manual/visual, não introduz ferramenta nova de
  CI.

## Riscos e assunções

- Subir a fonte base de 14px para 16px é uma mudança visualmente grande
  (tudo que usa `rem` cresce ~14%) — a task responsável precisa navegar
  pelas páginas depois da mudança e corrigir qualquer quebra de layout
  visível, não só aplicar o número e seguir.
- `lucide-react` é a única dependência nova deste plano — todo o resto
  (toast, modal, gaveta) é construído com o que já existe (React + CSS),
  sem framework de UI novo.
- A conversão tabela→cards no mobile precisa manter as mesmas ações
  (clique no job abre a gaveta) — é só uma reorganização visual da mesma
  informação, não uma tela nova.
