# Paginação nas tabelas de Vendas (Aprovadas e Reembolsos)

## Contexto

A tela `/vendas` (`app/vendas/page.tsx`) tem duas abas — Aprovadas e Reembolsos — cada
uma renderizando a lista inteira de vendas filtradas em uma tabela sem limite de linhas,
o que cria um scroll infinito na página. As listas já são ordenadas da venda mais
recente para a mais antiga (`filtered` usa `.sort((a, b) => b.data_hora.localeCompare(a.data_hora))`),
então essa parte já está correta e não muda.

## Objetivo

Trocar o scroll infinito por paginação em ambas as tabelas, mantendo a venda/reembolso
mais recente sempre no topo da primeira página.

## Comportamento

- 12 linhas por página, em ambas as tabelas (Aprovadas e Reembolsos).
- Controles de navegação abaixo de cada tabela: botão "← Anterior", texto
  "Página X de Y", botão "Próxima →".
- Botões desabilitados (visualmente e funcionalmente) quando não há página anterior
  ou próxima.
- Trocar de aba (Aprovadas ↔ Reembolsos), digitar na busca, ou mudar o filtro de
  produto/data reseta a página atual da aba afetada para 1 — evita ficar numa página
  que não existe mais depois que a lista muda de tamanho.
- Cada aba mantém sua própria página independentemente: navegar até a página 3 em
  Aprovadas e trocar para Reembolsos não afeta a página de Aprovadas; ao voltar,
  Aprovadas continua na página 3.
- Se a lista filtrada tiver 12 itens ou menos (1 página só), os controles de
  paginação continuam visíveis mas os dois botões ficam desabilitados (sem "pular"
  a UI quando a lista cresce/encolhe).

## Abordagem técnica

Os dados de vendas (`sales`) já são carregados por completo no `AppContext` (não é
uma API paginada — ver seção 11 de `spr-digital.md`). A paginação é implementada
inteiramente no componente `VendasContent`, fatiando (`.slice()`) o array `filtered`
já ordenado. Não há mudança em `lib/services.ts`, em nenhuma rota de API, nem no
schema do Supabase.

Estado necessário: um número de página por aba (`pageAprovadas`, `pageReembolsos`,
ou um único state resetado ao trocar de aba — a decidir na implementação, sem
impacto no comportamento observável descrito acima).

## Fora de escopo

- Paginação server-side / API paginada — não necessário no volume atual de dados.
- Mudança no tamanho de página (12) ser configurável pelo usuário.
- Mudança em qualquer outra tela além de `/vendas`.
