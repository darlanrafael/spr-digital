# Alerta de readequacao filtrado pelos produtos selecionados - Desenho

**Data:** 17/09/2026. **Tela:** `app/fechamentos/page.tsx` (etapa 4, Confirmar/Revisar). **Lib:** `lib/readequacoes-produto.ts`. **Sem mudanca de calculo/Caixa/banco** - so decide QUANDO o aviso aparece.

## O problema (achado pelo dono num fechamento real)

O aviso "Conferencia com a plataforma: N venda(s) mudou de produto" (readequacoes) aparece sempre que a data da venda cai na janela do fechamento, INDEPENDENTE dos produtos selecionados no filtro. `readequacoesDoPeriodo({ inicio, fim })` (`lib/readequacoes-produto.ts`) filtra so por data. Resultado: fechando produtos que nao tem nada a ver com a readequacao, o aviso da Paula (Diagnostico Guiado) aparece como ruido.

Cada readequacao envolve DOIS produtos:
- `produtoNaPlataforma` - o que a plataforma (Hubla) ainda mostra (ex: "Mentoria Particular - Pedro Roncada").
- `produtoNoSistema` - o que o sistema passou a contar (ex: "Diagnostico Guiado: Programa de acompanhamento Individual").

## A regra (decisao do dono)

Os DOIS produtos estao envolvidos na venda. O aviso deve aparecer quando **qualquer um dos dois** estiver entre os produtos selecionados no filtro do periodo. Se **nenhum** dos dois estiver selecionado, o aviso nao aparece.

Formalmente, uma readequacao `r` so entra se:
`produtosSelecionados.includes(r.produtoNaPlataforma) || produtosSelecionados.includes(r.produtoNoSistema)`

(alem do filtro de data que ja existe).

## Mudanca

`lib/readequacoes-produto.ts`, funcao `readequacoesDoPeriodo`: acrescentar um parametro opcional `produtosSelecionados?: string[]`. Quando fornecido, filtrar tambem por produto (a regra acima). Quando `undefined` (compatibilidade com os testes atuais que so passam `inicio`/`fim`), nao aplica filtro de produto - comportamento original.

`app/fechamentos/page.tsx`, o `useMemo` de `readequacoes` (`~599`): passar `produtosSelecionados: selectedProducts` na chamada, e incluir `selectedProducts` nas dependencias do `useMemo`.

O match e por string exata (`includes`), igual ao que o fechamento ja usa para `selectedProducts.includes(s.produto)` no filtro de vendas do periodo. Os nomes em `READEQUACOES_PRODUTO` sao escritos a mao para casar com os nomes reais dos produtos, entao o `includes` exato basta.

## Nao-objetivos
- Nenhuma mudanca de calculo, faturamento, Caixa ou banco. So a condicao de exibicao do aviso.
- Nao mexer no conteudo/estilo do aviso, so em quando ele aparece.
- Nao mexer na lista `READEQUACOES_PRODUTO` (dado auditado, escrito a mao).

## Testes e validacao
- `lib/readequacoes-produto.test.ts`: casos novos - (a) `produtosSelecionados` contendo o produto NO SISTEMA -> readequacao aparece; (b) contendo o produto NA PLATAFORMA -> aparece; (c) contendo nenhum dos dois -> nao aparece; (d) `produtosSelecionados` undefined -> comportamento original (so filtro de data). Os testes existentes continuam passando.
- `npx tsc --noEmit` limpo; `npm test` verde.
- Validacao na tela (controlador, contra o espelho): com o Diagnostico (ou a Mentoria) selecionado, o aviso aparece; deselecionando os dois, some.
