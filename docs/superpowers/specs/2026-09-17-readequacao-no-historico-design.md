# Readequacao no Historico do fechamento - Desenho

**Data:** 17/09/2026. **Tela:** `app/fechamentos/page.tsx` (card do Historico, componente `ClosingCard`). **Lib:** `lib/readequacoes-produto.ts` (ja existe). **Sem migracao, sem mudanca de calculo, sem persistencia.**

## O problema (pedido do dono)

O aviso "venda atribuida de outro produto" (readequacao - ex.: o comercial Felipe fechou um Diagnostico Guiado numa oferta criada dentro da Mentoria Particular do Pedro; caso Paula Caroline) so existe na etapa Confirmar. O fechamento confirmado NAO mostra essa nota no Historico, entao nos fechamentos ja feitos (Mentoria e Diagnostico) o dono nao ve o alerta.

## A solucao (derivar, nao persistir)

`READEQUACOES_PRODUTO` e uma lista fixa no codigo, e cada fechamento ja guarda `periodo_inicio`, `periodo_fim` e `produtos_incluidos`. Entao da pra DERIVAR a readequacao no Historico, na hora, reusando `readequacoesDoPeriodo`:

`readequacoesDoPeriodo({ inicio: closing.periodo_inicio, fim: closing.periodo_fim, produtosSelecionados: closing.produtos_incluidos })`

Isso ja aplica o filtro por produto (item 93): a readequacao entra se o produto DA PLATAFORMA ou o DO SISTEMA estiver entre os `produtos_incluidos` do fechamento. Resultado: a mesma readequacao (Paula) aparece TANTO no fechamento de Mentoria (produtoNaPlataforma = "Mentoria Particular - Pedro Roncada") QUANTO no de Diagnostico (produtoNoSistema = "Diagnostico Guiado..."), e em qualquer fechamento existente que caiba - **retroativo de graca, sem editar dado nenhum**.

## Mudanca

No componente do card do Historico (`ClosingCard` em `app/fechamentos/page.tsx`), computar as readequacoes do fechamento (via a chamada acima) e, quando houver, renderizar um bloco novo (mesmo estilo do aviso da etapa Confirmar, `~2278`), com: quantidade, e por linha: data, cliente, valor, "na plataforma consta X / no sistema conta como Y", e o motivo.

Onde aparecer: dentro do card do Historico, junto do detalhamento (pode ser no bloco expandido "Ver detalhes" ou no corpo do card - a decidir no plano, seguindo o layout existente).

## Nao-objetivos
- Nao persistir readequacao no fechamento (nao precisa - deriva da lista fixa + periodo + produtos).
- Nao mexer no `handleConfirm`, no calculo, no Caixa nem no banco.
- Nao mexer na lista `READEQUACOES_PRODUTO`.

## Testes e validacao
- `readequacoesDoPeriodo` ja tem teste. Esta mudanca e render puro derivado de dados existentes.
- `npx tsc --noEmit` limpo; `npm test` verde.
- Validacao rodando (controlador, contra o espelho ou os dados reais em leitura): abrir o Historico dos fechamentos de Mentoria (close_1789619715169) e de Diagnostico (close_1789620365683) e confirmar que o bloco da readequacao da Paula aparece nos dois; e que um fechamento sem readequacao no periodo/produtos nao mostra nada.
