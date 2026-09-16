# Correções na tela de Fechamento - Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans para implementar tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** aplicar três correções na tela de Fechamento (busca por período, mover reembolsos para a etapa Repasse, e a regra 65/35 do reembolso de mentoria do Pedro), sem margem de falha no dinheiro.

**Architecture:** a regra que decide dinheiro (65/35) vive em `lib/rateio-das-deducoes.ts` (pura, testável) e é só consumida pela tela; as duas mudanças de UI ficam em `app/fechamentos/page.tsx`. A regra 65/35 entra como um degrau novo na prioridade já existente, sem apagar o comportamento por origem.

**Tech Stack:** Next.js/React/TypeScript, testes com `tsx --test` (Node), Supabase.

## Global Constraints

- O fechamento não pode ter margem de falha. A regra 65/35 decide dinheiro e tem teste dedicado ANTES de qualquer fiação na tela.
- Nomes de sócios são fixos e exatos: `'SPR DIGITAL LTDA'` e `'Pedro Roncada'` (constante `SOCIO_NAMES` em `app/fechamentos/page.tsx:34`). SPR absorve 35%, Pedro 65% na mentoria do Pedro.
- A lista de produtos 65/35 é EXPLÍCITA (ancorada no dado histórico), não padrão de nome: exatamente `'Mentoria Particular - Pedro Roncada'` e `'Mentoria - Individual Pedro Roncada'`.
- Comparação de nome de produto sempre NORMALIZADA (minúsculas, sem acento, trim) via `normalizar` de `lib/busca-de-produto.ts`.
- Nunca usar travessão em texto/comentário; hífen simples.
- Não tocar em nenhuma guarda de autenticação nem em cálculo fora do escopo.

---

### Task 1: regra 65/35 do reembolso de mentoria do Pedro (lib pura, TDD)

**Files:**
- Modify: `lib/rateio-das-deducoes.ts` (acrescenta constante + função + novo degrau em `divisaoQueVale`, `154-164`)
- Test: `lib/rateio-das-deducoes.test.ts` (casos novos)

**Interfaces:**
- Consumes: `DivisaoSocios` (já existe, `rateio-das-deducoes.ts:41`), `normalizar` de `lib/busca-de-produto.ts`.
- Produces:
  - `PRODUTOS_MENTORIA_PEDRO_65_35: string[]`
  - `divisaoDeMentoriaPedro(produto: string): DivisaoSocios | null`
  - `divisaoQueVale(params: { origem, escolhaManual?, mentoriaPedro?: DivisaoSocios | null, divisaoDoFechamento }): { divisao; fonte: 'manual' | 'origem' | 'mentoria' | 'fechamento' }` (assinatura estendida com `mentoriaPedro`)

- [ ] **Step 1: escrever os testes que falham** (em `lib/rateio-das-deducoes.test.ts`)

```ts
import { divisaoDeMentoriaPedro, divisaoQueVale } from './rateio-das-deducoes'

// classificacao por produto (lista explicita, ancorada no dado)
test('mentoria particular/individual do Pedro -> 35/65', () => {
  assert.deepEqual(divisaoDeMentoriaPedro('Mentoria Particular - Pedro Roncada'),
    { 'SPR DIGITAL LTDA': 35, 'Pedro Roncada': 65 })
  assert.deepEqual(divisaoDeMentoriaPedro('Mentoria - Individual Pedro Roncada'),
    { 'SPR DIGITAL LTDA': 35, 'Pedro Roncada': 65 })
})
test('acento/caixa nao quebram a classificacao', () => {
  assert.deepEqual(divisaoDeMentoriaPedro('  mentoria particular - pedro roncada '),
    { 'SPR DIGITAL LTDA': 35, 'Pedro Roncada': 65 })
})
test('grupo do Pedro e mentoria da Denise NAO sao 65/35', () => {
  assert.equal(divisaoDeMentoriaPedro('MENTORIA EM GRUPO - PEDRO RONCADA'), null)
  assert.equal(divisaoDeMentoriaPedro('Mentoria em grupo- Pedro Roncada'), null)
  assert.equal(divisaoDeMentoriaPedro('Mentoria Individual - Denise'), null)
  assert.equal(divisaoDeMentoriaPedro('Mentoria Particular - Pedro | Denise'), null)
})

// o degrau novo na prioridade: manual > origem > mentoriaPedro > fechamento
const F = { 'SPR DIGITAL LTDA': 50, 'Pedro Roncada': 50 } // fechamento atual (IAR 50/50)
const MP = { 'SPR DIGITAL LTDA': 35, 'Pedro Roncada': 65 }
test('sem origem, mentoria do Pedro usa 65/35 (o caso Miguel)', () => {
  const r = divisaoQueVale({ origem: null, mentoriaPedro: MP, divisaoDoFechamento: F })
  assert.deepEqual(r, { divisao: MP, fonte: 'mentoria' })
})
test('sem origem e sem ser mentoria do Pedro, cai no fechamento (50/50)', () => {
  const r = divisaoQueVale({ origem: null, mentoriaPedro: null, divisaoDoFechamento: F })
  assert.deepEqual(r, { divisao: F, fonte: 'fechamento' })
})
test('com origem, a origem manda (mentoriaPedro nao interfere)', () => {
  const origem = { divisao: F, closingId: 'c1' }
  const r = divisaoQueVale({ origem, mentoriaPedro: MP, divisaoDoFechamento: F })
  assert.equal(r.fonte, 'origem')
})
test('escolha manual sobrepoe tudo, inclusive mentoriaPedro', () => {
  const manual = { 'SPR DIGITAL LTDA': 20, 'Pedro Roncada': 80 }
  const r = divisaoQueVale({ origem: null, escolhaManual: manual, mentoriaPedro: MP, divisaoDoFechamento: F })
  assert.deepEqual(r, { divisao: manual, fonte: 'manual' })
})
```

- [ ] **Step 2: rodar e ver falhar**

Run: `npx tsx --test lib/rateio-das-deducoes.test.ts`
Expected: FAIL (`divisaoDeMentoriaPedro is not a function`; `divisaoQueVale` sem `mentoriaPedro`).

- [ ] **Step 3: implementar em `lib/rateio-das-deducoes.ts`**

No topo, acrescentar o import:
```ts
import { normalizar } from './busca-de-produto'
```

Antes de `divisaoQueVale`, acrescentar:
```ts
// Os DOIS produtos que, historicamente, sempre foram rateados 35/65 (SPR/Pedro).
// Lista explicita, ancorada no dado: os dois fechamentos "MENTORIAS - PEDRO"
// (SPR 35 / Pedro 65) continham EXATAMENTE estes dois produtos, e mais nenhum -
// nem o de grupo do Pedro, nem os da Denise. Conferido no banco em 16/09/2026.
// Nao e padrao de nome ("mentoria + pedro" pegaria o grupo por engano); e uma
// lista curta, so para o caso SEM fechamento de origem (o unico que erra hoje).
export const PRODUTOS_MENTORIA_PEDRO_65_35 = [
  'Mentoria Particular - Pedro Roncada',
  'Mentoria - Individual Pedro Roncada',
]

const NOMES_65_35 = new Set(PRODUTOS_MENTORIA_PEDRO_65_35.map(normalizar))

/** A divisao 35/65 quando o produto e uma das mentorias individuais do Pedro; senao null. */
export function divisaoDeMentoriaPedro(produto: string): DivisaoSocios | null {
  if (!produto) return null
  return NOMES_65_35.has(normalizar(produto))
    ? { 'SPR DIGITAL LTDA': 35, 'Pedro Roncada': 65 }
    : null
}
```

Trocar `divisaoQueVale` (`154-164`) por:
```ts
export function divisaoQueVale(params: {
  origem: OrigemDaDivisao | null
  escolhaManual?: DivisaoSocios | null
  /** 35/65 quando e mentoria individual do Pedro E nao ha origem; senao null. */
  mentoriaPedro?: DivisaoSocios | null
  divisaoDoFechamento: DivisaoSocios
}): { divisao: DivisaoSocios; fonte: 'manual' | 'origem' | 'mentoria' | 'fechamento' } {
  if (params.escolhaManual && Object.keys(params.escolhaManual).length > 0) {
    return { divisao: params.escolhaManual, fonte: 'manual' }
  }
  if (params.origem) return { divisao: params.origem.divisao, fonte: 'origem' }
  if (params.mentoriaPedro) return { divisao: params.mentoriaPedro, fonte: 'mentoria' }
  return { divisao: params.divisaoDoFechamento, fonte: 'fechamento' }
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `npx tsx --test lib/rateio-das-deducoes.test.ts`
Expected: PASS (todos, inclusive os pre-existentes do Miguel/O RESGATE).

- [ ] **Step 5: suite inteira + tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc limpo; todos os testes passam.

- [ ] **Step 6: commit**

```bash
git add lib/rateio-das-deducoes.ts lib/rateio-das-deducoes.test.ts
git commit -m "feat: reembolso de mentoria individual do Pedro sem origem vira 65/35 (caso Miguel)"
```

---

### Task 2: consumir a regra 65/35 na tela de Fechamento

**Files:**
- Modify: `app/fechamentos/page.tsx:604-616` (o `useMemo` `deducoesDetalhadas`)

**Interfaces:**
- Consumes: `divisaoDeMentoriaPedro`, `divisaoQueVale` (Task 1). O alerta `a` tem `a.produto` (`ClosingAlert.produto`, types:155) e `a.saleId`.

- [ ] **Step 1: importar a nova função**

Na linha de import de `@/lib/rateio-das-deducoes` (já existe), acrescentar `divisaoDeMentoriaPedro`.

- [ ] **Step 2: passar `mentoriaPedro` para `divisaoQueVale`**

Em `deducoesDetalhadas` (`604-616`), dentro do `.map(a => {...})`, logo antes de chamar `divisaoQueVale`:
```ts
const mentoriaPedro = origem ? null : divisaoDeMentoriaPedro(a.produto)
const { divisao, fonte } = divisaoQueVale({ origem, escolhaManual, mentoriaPedro, divisaoDoFechamento })
```
(`origem` e `escolhaManual` já existem no escopo do map.)

- [ ] **Step 3: verificar tsc e suite**

Run: `npx tsc --noEmit && npm test`
Expected: limpo, verde.

- [ ] **Step 4: prova na tela (espelho, dev local)** - subir o dev com o env do espelho, abrir o fechamento onde o reembolso do Miguel aparece, marcar "abater", e conferir que a divisão dele fica SPR 35 / Pedro 65 (não 50/50), e que um reembolso de grupo/Denise sem origem fica 50/50. Derrubar o dev ao fim (`pkill -f "next dev"`).

- [ ] **Step 5: commit**

```bash
git add app/fechamentos/page.tsx
git commit -m "feat: tela de fechamento aplica 65/35 da mentoria do Pedro sem origem"
```

---

### Task 3: mover a seção de reembolsos/chargebacks da etapa 4 (Confirmar) para a etapa 3 (Repasse)

**Files:**
- Modify: `app/fechamentos/page.tsx` (mover o bloco `1891-2001` de dentro de `activeStep === 4` para dentro de `activeStep === 3`, antes do card "Divisão entre Sócios" em `1641`)

**Interfaces:**
- Consumes: todos os estados/derivados que a seção já usa (`alertas`, `alertasAceitos`, `toggleAlerta`, `deducaoDoSocio`, `empresaAbsorve`, etc.) - já vivem no componente, valem em qualquer etapa. Nada muda de cálculo.

- [ ] **Step 1: mover o JSX** - recortar o bloco "Reembolsos e chargebacks identificados" (`1891-2001`) da renderização de `activeStep === 4` e colá-lo na renderização de `activeStep === 3`, IMEDIATAMENTE ANTES do card "Divisão entre Sócios" (`1641`). Manter o mesmo JSX e os mesmos handlers.

- [ ] **Step 2: conferir o que sobra na etapa 4** - garantir que a etapa 4 (Confirmar) não fique quebrada nem duplicada: se algum resumo da etapa 4 dependia de estar logo abaixo da seção, ajustar a ordem; o botão "Confirmar fechamento" e o `handleConfirm` continuam na etapa 4, intactos.

- [ ] **Step 3: tsc e suite**

Run: `npx tsc --noEmit && npm test`
Expected: limpo, verde (é UI; os testes não cobrem layout, mas não podem quebrar).

- [ ] **Step 4: prova na tela (espelho)** - subir o dev, ir até a etapa Repasse: a seção de reembolsos aparece ANTES da divisão de sócios; marcar "abater" reflete na hora na divisão (lucro ou prejuízo); a opção "A empresa absorve" está presente e zera o desconto dos sócios; a etapa 4 (Confirmar) não mostra a seção duplicada. Derrubar o dev ao fim.

- [ ] **Step 5: commit**

```bash
git add app/fechamentos/page.tsx
git commit -m "feat: reembolsos/chargebacks passam para a etapa Repasse, antes da divisao de socios"
```

---

### Task 4: busca por nome no bloco "Produtos deste período"

**Files:**
- Modify: `app/fechamentos/page.tsx` (o bloco "Períodos adicionais por produto", `1266-1327`; a lista em `1303-1322`)

**Interfaces:**
- Consumes: `filtrarProdutos` de `lib/busca-de-produto.ts` (já importado na página), `availableProducts` (`{ id, nome }[]`), `periodosGrupos` (`PeriodoGrupo[]`, `81`).

- [ ] **Step 1: estado de busca por período** - acrescentar um estado que guarda o termo de busca por grupo/período, ex: `const [buscaPorPeriodo, setBuscaPorPeriodo] = useState<Record<string, string>>({})` (chave = `g.id`). (Colocar perto de `periodosGrupos`, `81`.)

- [ ] **Step 2: campo de busca em cada período** - dentro do `.map` que renderiza cada período (perto de "Produtos deste período", `1302`), acrescentar um `input` de busca igual ao do bloco de cima (mesmo estilo/lupa `Search`), ligado a `buscaPorPeriodo[g.id]` via `setBuscaPorPeriodo(prev => ({ ...prev, [g.id]: e.target.value }))`.

- [ ] **Step 3: filtrar a lista daquele período** - trocar a lista renderizada de `availableProducts.map(...)` (`1304`) por `filtrarProdutos(availableProducts, buscaPorPeriodo[g.id] ?? '').map(...)`, mantendo os mesmos botões/handlers (`toggleProdutoNoGrupo`, `atribuidoEmOutro`).

- [ ] **Step 4: tsc e suite**

Run: `npx tsc --noEmit && npm test`
Expected: limpo, verde.

- [ ] **Step 5: prova na tela (espelho)** - subir o dev, abrir "Períodos adicionais por produto", criar um período, digitar no novo campo de busca daquele período (ex: "mentoria pedro") e confirmar que a lista filtra por nome (com acento funcionando), e que a busca de um período não afeta a de outro. Derrubar o dev ao fim.

- [ ] **Step 6: commit**

```bash
git add app/fechamentos/page.tsx
git commit -m "feat: busca por nome no bloco Produtos deste periodo (um campo por periodo)"
```

---

## Ordem e observações

- Ordem: Task 1 (dinheiro, TDD, isolada) -> Task 2 (fiação da regra na tela) -> Task 3 (mover seção) -> Task 4 (busca). A de dinheiro primeiro, sozinha, porque é a de risco.
- Câmbio (tópico 2): SEM tarefa - já funciona. Documentado na spec como confirmado.
- "Empresa absorve" por linha: fora do escopo (fica global).
- Ao fim das 4 tarefas: `npx tsc --noEmit`, `npm test`, `npm run preflight` (0 grave), e uma passada final na tela de fechamento no espelho antes de qualquer deploy.

---

# Adendo (16/09) - ajustes vistos na prova de tela

Três itens novos, na mesma tela/branch. O da reserva mexe em dinheiro (TDD + prova no espelho).

### Task 5: toggle da Reserva de Caixa (lib pura, TDD)

**Files:** Modify `lib/base-da-reserva-de-caixa.ts` (funcao `divisaoDoLucro`, 54-96); Test `lib/base-da-reserva-de-caixa.test.ts`.

**Interfaces:** `divisaoDoLucro` ganha o parametro opcional `reservarCaixa?: boolean` (default true - callers e testes antigos seguem iguais). Quando `false`, NAO reserva os 30% mesmo com lucro positivo: `reservaCaixa = 0` e os 100% do `lucroBrutoComReserva` positivo vao pro `lucroReal` (socios). Caso negativo (prejuizo) NAO muda (ja e reserva 0).

- [ ] **Step 1: testes que falham** (em `lib/base-da-reserva-de-caixa.test.ts`)

```ts
import { divisaoDoLucro } from './base-da-reserva-de-caixa'
const linhas = [{ nome: 'CSP - Curso', liquidoPosImpostos: 20_000 }] // sofre reserva
test('reservarCaixa true (padrao): reserva 30% do lucro positivo', () => {
  const r = divisaoDoLucro({ linhas, faturamentoLiquido: 20_000, totalCustos: 10_000, repasseTerapeutasTotal: 0 })
  assert.equal(r.reservaCaixa, 3_000)   // 30% de 10.000
  assert.equal(r.lucroReal, 7_000)      // 70%
})
test('reservarCaixa false: NAO reserva, 100% vai pros socios', () => {
  const r = divisaoDoLucro({ linhas, faturamentoLiquido: 20_000, totalCustos: 10_000, repasseTerapeutasTotal: 0, reservarCaixa: false })
  assert.equal(r.reservaCaixa, 0)
  assert.equal(r.lucroReal, 10_000)     // 100%
})
test('prejuizo: reserva 0 independe do toggle', () => {
  const r1 = divisaoDoLucro({ linhas, faturamentoLiquido: 5_000, totalCustos: 10_000, repasseTerapeutasTotal: 0, reservarCaixa: true })
  const r2 = divisaoDoLucro({ linhas, faturamentoLiquido: 5_000, totalCustos: 10_000, repasseTerapeutasTotal: 0, reservarCaixa: false })
  assert.equal(r1.reservaCaixa, 0)
  assert.equal(r2.reservaCaixa, 0)
  assert.equal(r1.lucroReal, r2.lucroReal) // prejuizo identico nos dois
})
```

- [ ] **Step 2: rodar e ver falhar** - `npx tsx --test lib/base-da-reserva-de-caixa.test.ts` (FAIL: `reservarCaixa` ignorado).
- [ ] **Step 3: implementar** - em `divisaoDoLucro`, acrescentar `reservarCaixa?: boolean` ao params e trocar o calculo:

```ts
const aplicaReserva = (params.reservarCaixa ?? true) && lucroBrutoComReserva > 0
const reservaCaixa = aplicaReserva ? lucroBrutoComReserva * PERCENTUAL_DA_RESERVA : 0
const lucroDaParteComReserva = lucroBrutoComReserva > 0
  ? lucroBrutoComReserva * (aplicaReserva ? (1 - PERCENTUAL_DA_RESERVA) : 1)
  : lucroBrutoComReserva
```

- [ ] **Step 4: rodar e ver passar** - o arquivo de teste + `npm test` (suite inteira verde, testes antigos de reserva intactos).
- [ ] **Step 5: commit** - `git commit -m "feat: divisaoDoLucro aceita reservarCaixa opcional (default true)"`

### Task 6: ligar o toggle da Reserva na tela

**Files:** Modify `app/fechamentos/page.tsx` (estado + chamada de `divisaoDoLucro` ~510 + card ~1630-1632 + handleConfirm ~814-862).

- [ ] **Step 1:** estado `const [reservarCaixa, setReservarCaixa] = useState(true)` perto dos outros estados do fechamento.
- [ ] **Step 2:** passar `reservarCaixa` na chamada de `divisaoDoLucro` (~510).
- [ ] **Step 3:** no card "Reserva de Caixa (30%)" (~1630-1632), acrescentar um toggle (checkbox/switch) ligado a `reservarCaixa`/`setReservarCaixa`, com texto claro: ligado = "reservados pro caixa"; desligado = "NAO reservar; os 30% entram na divisao dos socios". Quando desligado, o valor mostrado ja sera R$ 0,00 (vem do calculo).
- [ ] **Step 4:** no `handleConfirm`, o lancamento da reserva no Caixa (~814-822) e a mensagem (~862) so acontecem se `reservaCaixa > 0` (quando desligado, reservaCaixa=0, nao lanca entrada de caixa nem promete reserva).
- [ ] **Step 5:** `npx tsc --noEmit` e `npm test` verdes.
- [ ] **Step 6:** prova na tela (espelho, controlador): com lucro positivo, ligado reserva 30% / desligado 0 e os 30% vao pros socios.
- [ ] **Step 7:** commit.

### Task 7: "A empresa absorve" sempre visivel

**Files:** Modify `app/fechamentos/page.tsx:1782`.

- [ ] **Step 1:** na condicao `{alertas.length > 0 && alertasSelecionados.length > 0 && podeVerRepasse && (...)}` remover o `alertasSelecionados.length > 0`, ficando `{alertas.length > 0 && podeVerRepasse && (...)}` - o bloco passa a aparecer sempre que houver reembolsos na lista, mesmo sem nenhum marcado.
- [ ] **Step 2:** `npx tsc --noEmit` e `npm test` verdes.
- [ ] **Step 3:** commit.

### Task 8: etiqueta "mentoria do Pedro (65/35)"

**Files:** Modify `app/fechamentos/page.tsx` (label da coluna "Quem absorve", ~1741-1745).

- [ ] **Step 1:** na cadeia de label, acrescentar um caso para `det?.fonte === 'mentoria'` que mostre "mentoria do Pedro (65/35)" (ou texto equivalente claro), ANTES do fallback `'sem origem — confira'`. Ordem: empresa paga > manual ('voce definiu') > mentoria ('mentoria do Pedro 65/35') > origem (etiqueta) > 'sem origem — confira'.
- [ ] **Step 2:** `npx tsc --noEmit` e `npm test` verdes.
- [ ] **Step 3:** commit.

Ordem: Task 5 (dinheiro, TDD) -> 6 (fiacao do toggle) -> 7 (empresa absorve) -> 8 (etiqueta). Ao fim, prova na tela no espelho e revisao final.
