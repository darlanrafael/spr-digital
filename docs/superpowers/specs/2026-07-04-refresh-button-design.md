# Botão "Atualizar dados" no Header

## Contexto

`contexts/AppContext.tsx` carrega `sales`, `costs`, `closings`, `cashflow`, `projects`
e `products` **uma única vez**, num `useEffect` com array de dependências vazio
(`AppContext.tsx:98-115`) — roda só quando o `AppProvider` monta (login ou F5 na
página). Navegação entre `/vendas`, `/fechamentos`, `/dre`, `/caixa`, `/analises`
é client-side (Next.js App Router) e não remonta o provider, então essas telas
continuam mostrando o snapshot carregado no início da sessão, por mais tempo que
o usuário fique navegando sem dar F5.

O Dashboard (`app/page.tsx`) é a exceção: busca vendas do período direto via
`/api/sales` toda vez que o filtro de período muda (`fetchPeriodSales`,
`app/page.tsx:242-268`), então sempre mostra dado atual.

**Problema real encontrado:** ao fazer um fechamento, a tela de Fechamentos
mostrou 92 vendas pro dia 01/07 enquanto o Dashboard mostrava 93 — a venda
faltante tinha sido criada via webhook depois que a sessão do navegador
carregou o snapshot inicial, e nunca mais foi atualizada. Como o Fechamento usa
esse snapshot pra calcular faturamento e repasse, isso é um risco real de
fechar com número errado.

## Objetivo

Dar ao usuário um jeito de forçar a atualização do snapshot de dentro do app,
sem precisar dar F5, e deixar visível há quanto tempo os dados foram
carregados pela última vez.

## Comportamento

- Botão "🔄 Atualizar dados" no `Header.tsx`, visível em todas as telas
  (o Header é compartilhado por todo o app).
- Ao lado do botão, texto "Atualizado às HH:MM" — horário real do último
  carregamento bem-sucedido (inicial ou manual), formato 24h, hora local do
  navegador.
- Clicar no botão chama `reloadData()` (já existe em `AppContext`, é a mesma
  função usada no carregamento inicial) — recarrega `sales`, `costs`,
  `closings`, `cashflow`, `projects` e `products` do zero para o projeto
  selecionado no momento.
- Durante o carregamento: o botão mostra um spinner, fica desabilitado (não
  permite clique duplo empilhando chamadas), e o texto do horário não muda até
  o carregamento terminar (evita mostrar um horário "no ar" enquanto a busca
  ainda está rodando).
- Ao terminar com sucesso, o texto do horário atualiza para o momento em que o
  carregamento terminou.
- Se o carregamento falhar (ex: Supabase fora do ar), o botão volta ao estado
  normal (não trava) e o horário **não muda** — continua mostrando o último
  carregamento que de fato funcionou. Sem toast/alerta de erro adicional (o
  app já loga erros no console via `reloadData`'s catch existente).
- O carregamento inicial da página (login/F5) também conta como uma
  atualização — o horário aparece assim que esse carregamento inicial
  terminar, não fica em branco até o primeiro clique manual.

## Fora de escopo

- Atualização automática (por foco de aba, intervalo, ou ao entrar em
  Fechamentos/DRE) — só o botão manual, por decisão explícita do usuário.
- Qualquer mudança no Dashboard (`app/page.tsx`) — ele já busca fresco sozinho,
  não depende do snapshot do `AppContext`.
- Indicador de "dados desatualizados há X minutos" com alerta visual — só o
  horário simples do último carregamento.

## Abordagem técnica

`AppContext` passa a expor `lastLoadedAt: Date | null` (novo estado, atualizado
dentro de `reloadData` logo após os `setX(...)` terminarem com sucesso — não é
setado no `catch`, preservando o horário do último sucesso). `Header.tsx`
consome `lastLoadedAt` e `reloadData` via `useApp()` (já é como o Header
consome o resto do contexto) e renderiza o botão + texto. Nenhuma mudança em
`lib/services.ts` ou nas rotas de API — é só expor um novo campo de estado e
consumir a função que já existe.
