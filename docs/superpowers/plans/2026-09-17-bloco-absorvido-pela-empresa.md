# Bloco consolidado "O que a empresa absorveu" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, na etapa Revisar e no Histórico, um bloco unico com TUDO que a empresa absorveu (reembolsos + prejuizo do periodo) com o total correto, e corrigir a etiqueta do topo do Historico para o total.

**Architecture:** Um helper puro para o total (testavel) e um componente React compartilhado `BlocoAbsorvidoPelaEmpresa` usado nos dois lugares, alimentado por dados ao vivo (Revisar) e pelos dados salvos do `closing` (Historico). Sem mudanca de calculo, Caixa ou banco - o dinheiro ja esta correto; isto e so relatorio, e retroativo.

**Tech Stack:** TypeScript, React (Next.js); testes `node:test` + `assert/strict` via `tsx --test lib/*.test.ts`.

## Global Constraints

- ZERO mudanca de calculo, de Caixa (`handleConfirm`) ou de banco. Apenas leitura de dados existentes e render.
- O bloco e a etiqueta aparecem SO quando ha algo absorvido pela empresa (total > 0); senao nada muda na tela.
- Nao tocar na divisao 65/35 nem no guardrail de venda nao carregada.
- O caso "reembolsos abatidos DOS SOCIOS" (quando a empresa NAO absorve) continua igual - so o caso "absorvido pela empresa" migra para o bloco.
- Textos PT sem travessao (hifen simples). `npx tsc --noEmit` limpo; `npm test` verde.

---

### Task 1: Helper puro `totalAbsorvidoPelaEmpresa` (+ teste)

**Files:**
- Modify: `lib/rateio-das-deducoes.ts` (adicionar funcao exportada ao final)
- Test: `lib/rateio-das-deducoes.test.ts` (adicionar casos)

**Interfaces:**
- Produces: `totalAbsorvidoPelaEmpresa(params: { reembolsos: { valor: number }[]; prejuizoPeriodo: number }): number` - soma dos valores dos reembolsos absorvidos + o prejuizo do periodo absorvido (tratado como >= 0). Consumido pela Task 2.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `lib/rateio-das-deducoes.test.ts` (segue o estilo do arquivo; conferir os imports no topo e acrescentar `totalAbsorvidoPelaEmpresa` na linha de import de `./rateio-das-deducoes`):

```ts
test('totalAbsorvidoPelaEmpresa: soma reembolsos + prejuizo do periodo', () => {
  const t = totalAbsorvidoPelaEmpresa({
    reembolsos: [{ valor: 1560 }, { valor: 2588.70 }],
    prejuizoPeriodo: 1798.85,
  })
  assert.equal(Math.round(t * 100) / 100, 5947.55)
})

test('totalAbsorvidoPelaEmpresa: so reembolsos (sem prejuizo)', () => {
  assert.equal(totalAbsorvidoPelaEmpresa({ reembolsos: [{ valor: 100 }, { valor: 50 }], prejuizoPeriodo: 0 }), 150)
})

test('totalAbsorvidoPelaEmpresa: so prejuizo (sem reembolsos)', () => {
  assert.equal(totalAbsorvidoPelaEmpresa({ reembolsos: [], prejuizoPeriodo: 1798.85 }), 1798.85)
})

test('totalAbsorvidoPelaEmpresa: nada absorvido = 0', () => {
  assert.equal(totalAbsorvidoPelaEmpresa({ reembolsos: [], prejuizoPeriodo: 0 }), 0)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test 2>&1 | grep -A2 totalAbsorvidoPelaEmpresa`
Expected: FAIL (funcao nao existe / nao importada).

- [ ] **Step 3: Implementar o helper**

Adicionar ao final de `lib/rateio-das-deducoes.ts`:

```ts
/**
 * Total que a EMPRESA absorveu num fechamento: a soma dos reembolsos que ela
 * pagou (em vez de descontar dos socios) MAIS o prejuizo do periodo que ela
 * absorveu. Os dois sao toggles independentes na tela; aqui so somam para o
 * relatorio. `prejuizoPeriodo` entra como >= 0 (e um valor absoluto de prejuizo).
 */
export function totalAbsorvidoPelaEmpresa(params: {
  reembolsos: { valor: number }[]
  prejuizoPeriodo: number
}): number {
  const totalReembolsos = params.reembolsos.reduce((t, r) => t + r.valor, 0)
  return totalReembolsos + Math.max(0, params.prejuizoPeriodo)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test 2>&1 | tail -8`
Expected: PASS (os 4 novos + todos os antigos de `rateio-das-deducoes`).

- [ ] **Step 5: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/rateio-das-deducoes.ts lib/rateio-das-deducoes.test.ts
git commit -m "feat: helper totalAbsorvidoPelaEmpresa (reembolsos + prejuizo do periodo)"
```

---

### Task 2: Componente `BlocoAbsorvidoPelaEmpresa` + fiacao (Revisar, Historico, etiqueta, limpeza)

**Files:**
- Modify: `app/fechamentos/page.tsx`

**Interfaces:**
- Consumes: `totalAbsorvidoPelaEmpresa` (Task 1); `formatCurrency`, `formatDate` (ja importados de `@/lib/formatters` na linha 12); estados ao vivo `alertasSelecionados`, `empresaAbsorve`, `prejuizoAbsorvidoPeloPeriodo`, `lucroReal`; e no Historico o objeto `closing` (com `alertas[]`, `socios[]`, `lucroReal`).

- [ ] **Step 1: Definir `tipoLegivel` e o componente `BlocoAbsorvidoPelaEmpresa` (nivel de modulo)**

Em `app/fechamentos/page.tsx`, ANTES de `function FechamentosContent()` (linha 56), adicionar duas funcoes de nivel de modulo (usam `formatCurrency`/`formatDate` ja importados):

```tsx
function tipoLegivel(tipo: string): string {
  return tipo === 'chargeback' ? 'Chargeback' : tipo === 'reembolso_parcial' ? 'Reembolso parcial' : 'Reembolso'
}

type ItemAbsorvido = { data: string; nome: string; produto: string; valor: number; tipo: string }

function BlocoAbsorvidoPelaEmpresa({ reembolsos, prejuizoPeriodo }: { reembolsos: ItemAbsorvido[]; prejuizoPeriodo: number }) {
  const total = totalAbsorvidoPelaEmpresa({ reembolsos, prejuizoPeriodo })
  if (total <= 0) return null
  return (
    <div className="mt-3 rounded-lg bg-purple-500/[0.07] border border-purple-500/30 p-3">
      <p className="text-xs font-semibold text-purple-300">O que a empresa absorveu (nao saiu do repasse dos socios)</p>
      <ul className="mt-2 space-y-1 text-[11px] text-gray-300">
        {reembolsos.map((r, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="text-gray-400">{r.data} · {r.nome} · {r.produto} <span className="text-gray-600">({tipoLegivel(r.tipo)})</span></span>
            <span className="text-purple-300 whitespace-nowrap">{formatCurrency(r.valor)}</span>
          </li>
        ))}
        {prejuizoPeriodo > 0 && (
          <li className="flex justify-between gap-3">
            <span className="text-gray-400">Prejuizo do periodo absorvido</span>
            <span className="text-purple-300 whitespace-nowrap">{formatCurrency(prejuizoPeriodo)}</span>
          </li>
        )}
      </ul>
      <div className="mt-2 pt-2 border-t border-purple-500/20 flex justify-between text-xs font-semibold">
        <span className="text-purple-200">Total absorvido pela empresa</span>
        <span className="text-purple-200">{formatCurrency(total)}</span>
      </div>
    </div>
  )
}
```

Importe `totalAbsorvidoPelaEmpresa` de `@/lib/rateio-das-deducoes` no topo (a linha que ja importa `divisaoQueVale`/`divisaoDeMentoriaPedro` desse modulo - adicionar o nome nela).

- [ ] **Step 2: Wire no Revisar (etapa 4) e remover as notas redundantes**

No trecho do Revisar (por volta de `app/fechamentos/page.tsx:2176-2196`), fazer DUAS coisas:

(a) REMOVER a nota solta do prejuizo (o `<p>` que diz "Prejuízo do período: {formatCurrency(Math.abs(lucroReal))}, absorvido pela empresa - os sócios não ratearão nada dele.") - ela passa para o bloco.

(b) TROCAR o `<p>` que hoje mostra `empresaAbsorve ? 'Reembolsos absorvidos pela empresa...' : '(-) Reembolsos abatidos dos sócios...'` para mostrar SO o caso dos socios (quando NAO ha absorcao):

```tsx
                          {alertasSelecionados.length > 0 && !empresaAbsorve && (
                            <p className="text-[11px] text-gray-500 -mt-1">
                              (-) Reembolsos abatidos dos sócios: {formatCurrency(deducaoDosSocios)}
                            </p>
                          )}
```

(c) Logo APOS o fechamento do bloco de resumo do funil (o `</div>` que fecha o container dessas linhas, antes do `{/* Bloco 2 — Repasse entre sócios */}`), inserir o bloco novo:

```tsx
                    <BlocoAbsorvidoPelaEmpresa
                      reembolsos={empresaAbsorve ? alertasSelecionados.map(a => ({ data: formatDate(a.data), nome: a.nome, produto: a.produto, valor: a.valor, tipo: a.tipo })) : []}
                      prejuizoPeriodo={prejuizoAbsorvidoPeloPeriodo ? Math.abs(lucroReal) : 0}
                    />
```

- [ ] **Step 3: Corrigir a etiqueta do topo do Historico para o TOTAL**

No trecho `app/fechamentos/page.tsx:2642-2662`, dentro do IIFE que calcula `daEmpresa`/`dosSocios`, acrescentar o prejuizo absorvido e trocar a condicao/valor da etiqueta roxa:

```tsx
                const daEmpresa = closing.alertas.filter(a => a.absorvidoPelaEmpresa)
                const dosSocios = closing.alertas.filter(a => !a.absorvidoPelaEmpresa)
                const prejuizoAbsorvido = closing.socios?.some(s => s.empresaAbsorveuPrejuizoDoPeriodo) ? Math.abs(closing.lucroReal) : 0
                const totalAbsorvido = totalAbsorvidoPelaEmpresa({ reembolsos: daEmpresa.map(a => ({ valor: a.valor })), prejuizoPeriodo: prejuizoAbsorvido })
```

E a etiqueta roxa (o `{daEmpresa.length > 0 && (...)}`) passa a ser `{totalAbsorvido > 0 && (...)}` com o texto `{formatCurrency(totalAbsorvido)} absorvido pela empresa`.

- [ ] **Step 4: Wire o bloco no corpo do Historico e remover a linha solta do prejuizo**

No corpo do card do Historico: (a) REMOVER o `<p>` solto "A empresa absorveu o prejuízo do período: {formatCurrency(Math.abs(closing.lucroReal))}" (`app/fechamentos/page.tsx:2776-2779`, dentro do `{closing.socios?.some(...) && (...)}`) - vai para o bloco. (b) No lugar dele (ou logo apos as linhas de resumo do closing), inserir:

```tsx
            <BlocoAbsorvidoPelaEmpresa
              reembolsos={closing.alertas.filter(a => a.absorvidoPelaEmpresa).map(a => ({ data: formatDate(a.data), nome: a.nome, produto: a.produto, valor: a.valor, tipo: a.tipo }))}
              prejuizoPeriodo={closing.socios?.some(s => s.empresaAbsorveuPrejuizoDoPeriodo) ? Math.abs(closing.lucroReal) : 0}
            />
```

- [ ] **Step 5: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros. (`ClosingAlert.data`, `.nome`, `.produto`, `.valor`, `.tipo` existem no tipo; `closing.lucroReal` e `socios[].empresaAbsorveuPrejuizoDoPeriodo` tambem.)

- [ ] **Step 6: `npm test` verde**

Run: `npm test 2>&1 | tail -6`
Expected: 797/797 (os 4 novos da Task 1 + os 793 atuais), 0 fail.

- [ ] **Step 7: Validacao rodando (controlador faz na revisao)**

Nao precisa rodar puppeteer aqui - o controlador valida na tela contra o espelho: um fechamento com empresa absorvendo reembolsos + prejuizo do periodo deve mostrar o bloco (itens + prejuizo + total) no Revisar E no Historico, e a etiqueta do topo do Historico deve bater com o total. Descreva no report o comportamento esperado.

- [ ] **Step 8: Commit**

```bash
git add app/fechamentos/page.tsx
git commit -m "feat: bloco consolidado 'o que a empresa absorveu' no Revisar e Historico + etiqueta com total"
```

---

## Notas de validacao
- O caminho normal (nada absorvido pela empresa) nao muda: `total <= 0` -> o componente devolve `null`, a etiqueta nova so aparece com `totalAbsorvido > 0`, e a nota dos socios (`!empresaAbsorve`) continua igual.
- Retroatividade: o bloco e a etiqueta leem `closing.alertas`/`closing.socios`/`closing.lucroReal`, que ja existem nos fechamentos confirmados - o fechamento `close_1789618364181` passa a mostrar o total certo (R$ 5.947,55) sem migracao.
