# Alerta de readequacao filtrado pelos produtos selecionados - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O aviso de readequacao ("venda mudou de produto") so aparece quando um dos dois produtos envolvidos (o da plataforma OU o do sistema) esta entre os produtos selecionados no filtro do periodo.

**Architecture:** Um parametro opcional `produtosSelecionados` em `readequacoesDoPeriodo` que, quando fornecido, filtra as readequacoes por produto (alem do filtro de data ja existente). A tela de fechamento passa `selectedProducts`. Sem mudanca de calculo.

**Tech Stack:** TypeScript, React (Next.js); testes `node:test` + `assert/strict` via `tsx --test lib/*.test.ts`.

## Global Constraints

- ZERO mudanca de calculo, faturamento, Caixa ou banco. So a condicao de EXIBICAO do aviso.
- `produtosSelecionados` opcional: quando `undefined`, comportamento ORIGINAL (so filtro de data) - os testes atuais continuam passando.
- Match por string exata (`includes`), igual ao `selectedProducts.includes(s.produto)` que o fechamento ja usa.
- Nao mexer na lista `READEQUACOES_PRODUTO` nem no conteudo/estilo do aviso.
- Textos PT sem travessao. `npx tsc --noEmit` limpo; `npm test` verde.

---

### Task 1: `readequacoesDoPeriodo` filtra por `produtosSelecionados` (+ testes)

**Files:**
- Modify: `lib/readequacoes-produto.ts` (funcao `readequacoesDoPeriodo`)
- Test: `lib/readequacoes-produto.test.ts` (adicionar casos)

**Interfaces:**
- Produces: `readequacoesDoPeriodo({ inicio, fim, produtosSelecionados?, readequacoes? })` - quando `produtosSelecionados` e um array, mantem so readequacoes cujo `produtoNaPlataforma` OU `produtoNoSistema` esta no array; quando `undefined`, nao filtra por produto. Consumido pela Task 2.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `lib/readequacoes-produto.test.ts` (o helper `r()` ja define `produtoNaPlataforma: 'A'`, `produtoNoSistema: 'B'`):

```ts
test('produto NO SISTEMA selecionado -> readequacao aparece', () => {
  const l = readequacoesDoPeriodo({ inicio: '2026-08-01', fim: '2026-08-31', produtosSelecionados: ['B'], readequacoes: [r()] })
  assert.equal(l.length, 1)
})

test('produto NA PLATAFORMA selecionado -> readequacao aparece', () => {
  const l = readequacoesDoPeriodo({ inicio: '2026-08-01', fim: '2026-08-31', produtosSelecionados: ['A'], readequacoes: [r()] })
  assert.equal(l.length, 1)
})

test('nenhum dos dois produtos selecionado -> readequacao nao aparece', () => {
  const l = readequacoesDoPeriodo({ inicio: '2026-08-01', fim: '2026-08-31', produtosSelecionados: ['X'], readequacoes: [r()] })
  assert.equal(l.length, 0)
})

test('produtosSelecionados vazio -> nada aparece (nenhum produto em apuracao)', () => {
  const l = readequacoesDoPeriodo({ inicio: '2026-08-01', fim: '2026-08-31', produtosSelecionados: [], readequacoes: [r()] })
  assert.equal(l.length, 0)
})

test('produtosSelecionados undefined -> comportamento original (so filtro de data)', () => {
  const l = readequacoesDoPeriodo({ inicio: '2026-08-01', fim: '2026-08-31', readequacoes: [r()] })
  assert.equal(l.length, 1)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test 2>&1 | grep -iE "produto (NO SISTEMA|NA PLATAFORMA|selecionado|undefined)"`
Expected: FAIL (o parametro ainda nao filtra; os casos que esperam `length 0` retornam 1).

- [ ] **Step 3: Implementar o filtro**

Em `lib/readequacoes-produto.ts`, na funcao `readequacoesDoPeriodo`, acrescentar o parametro e o filtro. A assinatura passa a ser:

```ts
export function readequacoesDoPeriodo({
  inicio,
  fim,
  produtosSelecionados,
  readequacoes = READEQUACOES_PRODUTO,
}: {
  inicio: string
  fim: string
  /**
   * Produtos selecionados no filtro do fechamento. Quando fornecido, a
   * readequacao so entra se um dos dois produtos envolvidos (o que a plataforma
   * mostra OU o que o sistema conta) estiver selecionado - os dois estao
   * envolvidos na mesma venda. Quando `undefined`, nao filtra por produto.
   */
  produtosSelecionados?: string[]
  readequacoes?: ReadequacaoProduto[]
}): ReadequacaoProduto[] {
  if (!inicio || !fim) return []
  return readequacoes
    .filter(r => r.data >= inicio && r.data <= fim)
    .filter(r =>
      produtosSelecionados === undefined
      || produtosSelecionados.includes(r.produtoNaPlataforma)
      || produtosSelecionados.includes(r.produtoNoSistema))
    .sort((a, b) => a.data.localeCompare(b.data))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test 2>&1 | tail -8`
Expected: PASS - os 5 novos + todos os antigos de `readequacoes-produto` (os antigos nao passam `produtosSelecionados`, entao caem no ramo `undefined` e ficam iguais).

- [ ] **Step 5: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/readequacoes-produto.ts lib/readequacoes-produto.test.ts
git commit -m "feat: readequacoesDoPeriodo filtra pelos produtos selecionados"
```

---

### Task 2: A tela passa `selectedProducts` para o filtro

**Files:**
- Modify: `app/fechamentos/page.tsx` (o `useMemo` de `readequacoes`, ~599)

**Interfaces:**
- Consumes: `readequacoesDoPeriodo` com `produtosSelecionados` (Task 1); `selectedProducts` (estado ja existente, usado no filtro de vendas do periodo).

- [ ] **Step 1: Passar `selectedProducts` e ajustar as dependencias**

Em `app/fechamentos/page.tsx`, trocar o `useMemo` de `readequacoes` (por volta da linha 599):

```tsx
  const readequacoes = useMemo(
    () => readequacoesDoPeriodo({ inicio: periodo.inicio, fim: periodo.fim }),
    [periodo.inicio, periodo.fim],
  )
```

por:

```tsx
  const readequacoes = useMemo(
    () => readequacoesDoPeriodo({ inicio: periodo.inicio, fim: periodo.fim, produtosSelecionados: selectedProducts }),
    [periodo.inicio, periodo.fim, selectedProducts],
  )
```

(`selectedProducts` ja esta em escopo - e usado no `matchProduct` do `periodSales`, definido antes desta linha.)

- [ ] **Step 2: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: npm test verde**

Run: `npm test 2>&1 | tail -6`
Expected: sem regressao (a mudanca e so na tela; nenhum teste de pagina no repo).

- [ ] **Step 4: Validacao rodando (controlador)**

O controlador valida na tela contra o espelho: na etapa Confirmar, com o produto "Diagnostico Guiado..." (ou "Mentoria Particular - Pedro Roncada") selecionado, o aviso de readequacao da Paula aparece; deselecionando os dois, o aviso some; o resto do fechamento nao muda. Descrever no report o comportamento esperado.

- [ ] **Step 5: Commit**

```bash
git add app/fechamentos/page.tsx
git commit -m "feat: aviso de readequacao respeita os produtos selecionados no fechamento"
```

---

## Notas de validacao
- Compatibilidade: os testes antigos de `readequacoes-produto` chamam sem `produtosSelecionados`, entao caem no ramo `=== undefined` e continuam iguais.
- A tela sempre passa `selectedProducts` (um array), entao em producao o filtro por produto sempre vale; o ramo `undefined` existe so para a compatibilidade dos testes.
