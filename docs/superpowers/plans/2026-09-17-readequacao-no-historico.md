# Readequacao no Historico do fechamento - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O card do Historico mostrar um bloco de readequacao ("venda atribuida de outro produto") quando o fechamento cair numa readequacao conhecida, derivado do periodo + produtos do fechamento (retroativo, sem persistir).

**Architecture:** No componente `ClosingCard`, computar `readequacoesDoPeriodo({ inicio: closing.periodo.inicio, fim: closing.periodo.fim, produtosSelecionados: closing.produtos_incluidos })` (a lib ja existe e ja e importada) e renderizar um bloco se houver. Display puro, zero mudanca de calculo/banco.

**Tech Stack:** TypeScript, React (Next.js).

## Global Constraints
- Zero mudanca de calculo, Caixa, banco, `handleConfirm` ou da lista `READEQUACOES_PRODUTO`.
- So adiciona um bloco de LEITURA no card do Historico; quando nao ha readequacao, nada muda.
- Textos PT sem travessao. `npx tsc --noEmit` limpo; `npm test` verde.

---

### Task 1: Bloco de readequacao no `ClosingCard`

**Files:**
- Modify: `app/fechamentos/page.tsx` (componente `ClosingCard`, ~2538)

**Interfaces:**
- Consumes: `readequacoesDoPeriodo` (ja importado, linha 17); `closing.periodo.{inicio,fim}`, `closing.produtos_incluidos` (Closing type); `formatDate`, `formatCurrency`.

- [ ] **Step 1: Computar as readequacoes do fechamento**

Em `ClosingCard`, perto do `useMemo` que ja usa `closing.periodo` (~2572), adicionar:

```tsx
  const readequacoesDoFechamento = useMemo(
    () => readequacoesDoPeriodo({
      inicio: closing.periodo.inicio,
      fim: closing.periodo.fim,
      produtosSelecionados: closing.produtos_incluidos ?? [],
    }),
    [closing.periodo, closing.produtos_incluidos],
  )
```

- [ ] **Step 2: Renderizar o bloco no corpo do card (sempre visivel)**

Dentro do `<div className="p-4">` do `ClosingCard`, LOGO APOS o fechamento do `<div className="flex items-start justify-between gap-4">` do header (o bloco que tem periodo/etiqueta/badges) e ANTES da linha "Confirmado em {confirmedAt}", inserir:

```tsx
            {readequacoesDoFechamento.length > 0 && (
              <div className="mt-1 mb-3 bg-sky-500/10 border border-sky-500/30 rounded-lg p-3">
                <p className="text-xs font-semibold text-sky-300">
                  Venda{readequacoesDoFechamento.length !== 1 ? 's' : ''} atribuida{readequacoesDoFechamento.length !== 1 ? 's' : ''} de outro produto ({readequacoesDoFechamento.length})
                </p>
                <ul className="mt-2 space-y-1.5 text-[11px] text-gray-300">
                  {readequacoesDoFechamento.map(r => (
                    <li key={r.saleId}>
                      {formatDate(r.data)} · {r.cliente} · {formatCurrency(r.valor)} - na plataforma consta{' '}
                      <span className="text-amber-400">{r.produtoNaPlataforma}</span>, no sistema conta como{' '}
                      <span className="text-emerald-400">{r.produtoNoSistema}</span>
                      <p className="text-gray-500 mt-0.5">{r.motivo}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
```

(Localizar a linha "Confirmado em" pelo texto `Confirmado em {confirmedAt}` para posicionar. Se o header e a linha "Confirmado em" estiverem em containers diferentes, inserir o bloco entre eles, ainda dentro do `<div className="p-4">` sempre visivel - nao dentro do `{expanded && (...)}`.)

- [ ] **Step 3: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros (todos os campos usados existem em `ReadequacaoProduto`: saleId, cliente, valor, data, produtoNaPlataforma, produtoNoSistema, motivo).

- [ ] **Step 4: npm test verde**

Run: `npm test 2>&1 | tail -6`
Expected: sem regressao (nenhum teste de pagina; a lib ja tem teste).

- [ ] **Step 5: Validacao rodando (controlador)**

O controlador abre o Historico contra o espelho/produção (leitura) e confirma: o fechamento de Mentoria (close_1789619715169) e o de Diagnostico (close_1789620365683) mostram o bloco da readequacao da Paula; um fechamento sem readequacao no periodo/produtos nao mostra nada.

- [ ] **Step 6: Commit**

```bash
git add app/fechamentos/page.tsx
git commit -m "feat: bloco de readequacao no Historico do fechamento (derivado, retroativo)"
```

---

## Notas de validacao
- Retroativo por construcao: le a lista fixa `READEQUACOES_PRODUTO` filtrada pelo periodo + produtos do fechamento, entao vale pra todos os fechamentos existentes sem editar dado.
- A mesma readequacao (Paula) aparece no fechamento de Mentoria (via produtoNaPlataforma) e no de Diagnostico (via produtoNoSistema), pela regra de produto ja existente em `readequacoesDoPeriodo`.
