# Diagnóstico Guiado - Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o comercial agende, numa única ação, um pacote do Diagnóstico Guiado cujas sessões se dividem entre Pedro e Denise.

**Architecture:** Um módulo puro (`lib/diagnostico-guiado.ts`) traduz uma venda em um pacote de sessões com terapeuta, data e comissão por sessão. A rota de agendamento passa a aceitar esse pacote pronto em vez de assumir um terapeuta único, e a checagem de conflito passa a validar cada data contra a agenda do terapeuta daquela sessão. As telas ganham a etiqueta.

**Tech Stack:** Next.js 16, TypeScript, Supabase (PostgREST), testes com o runner nativo do Node via `tsx` (`npm test`).

## Global Constraints

- Nunca usar travessão longo em texto de produto, documento ou commit. Usar hífen simples.
- Módulo de terapeutas documenta em `spr-digital.md`. Nunca em `clickup.md`.
- Toda leitura de `sales` que some dinheiro exclui `id like 'manual_%'`.
- Nenhum valor real de credencial entra em código, documento ou commit.
- Formato identificado pela OFERTA (sufixo do `order_id`), nunca por preço ou nome.
- Oferta desconhecida deste produto nunca vira palpite: devolve `null`.
- Testes usam o runner nativo do Node, sem dependência nova.

---

### Task 1: Módulo puro do produto

**Files:**
- Create: `lib/diagnostico-guiado.ts`
- Test: `lib/diagnostico-guiado.test.ts`

**Interfaces:**
- Consumes: `Sale` de `@/types`
- Produces:
  - `type FormatoDiagnostico = { formato: 1 | 2 | 3; totalSessoes: number; sessoesPedro: number }`
  - `formatoDaVenda(sale: Pick<Sale, 'id' | 'order_id'>): FormatoDiagnostico | null`
  - `OFERTAS_DIAGNOSTICO: Record<string, 1 | 2 | 3>`
  - `PAGAMENTO_DENISE_POR_SESSAO = 95`

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatoDaVenda } from './diagnostico-guiado'

const venda = (order_id: string | undefined, id = 'v1') => ({ id, order_id }) as never

test('oferta do Formato 1 devolve 9 sessoes, 2 do Pedro', () => {
  const f = formatoDaVenda(venda('06547c74-56d5-4cd6-9046-289d8f3ab9bd-WXwmPZfJxGqeXerA6dkO'))
  assert.deepEqual(f, { formato: 1, totalSessoes: 9, sessoesPedro: 2 })
})

test('oferta do Formato 3 devolve 2 sessoes, 1 do Pedro', () => {
  const f = formatoDaVenda(venda('347281e4-f007-44ac-9264-e41da730b2e4-qVvads7GKaI7lN1Kctrr'))
  assert.deepEqual(f, { formato: 3, totalSessoes: 2, sessoesPedro: 1 })
})

test('oferta desconhecida devolve null em vez de adivinhar', () => {
  assert.equal(formatoDaVenda(venda('11111111-2222-3333-4444-555555555555-OFERTANOVA')), null)
})

test('oferta Padrao de R$ 10,00 do mesmo produto nao vira pacote', () => {
  assert.equal(formatoDaVenda(venda('11111111-2222-3333-4444-555555555555-wd6AwMQIJGAekPCGCRsb')), null)
})

test('oferta do Formato 2 devolve 4 sessoes, 1 do Pedro', () => {
  const f = formatoDaVenda(venda('11111111-2222-3333-4444-555555555555-H8DA8U21x7Lmv3NreVMs'))
  assert.deepEqual(f, { formato: 2, totalSessoes: 4, sessoesPedro: 1 })
})

test('lancamento manual nao tem order_id e devolve null', () => {
  assert.equal(formatoDaVenda(venda(undefined, 'manual_1788034875487_zrpmrz')), null)
})

test('venda da Juliane (real, Formato 3)', () => {
  const f = formatoDaVenda(venda('347281e4-f007-44ac-9264-e41da730b2e4-qVvads7GKaI7lN1Kctrr'))
  assert.equal(f?.formato, 3)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/diagnostico-guiado.test.ts`
Expected: FAIL com "Cannot find module './diagnostico-guiado'"

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Sale } from '@/types'

// O formato vem da OFERTA da Hubla, nunca do preco nem do nome.
//
// Nome: identico nos tres formatos.
// Preco: valor_pago_cliente varia com parcelamento e juros (Francisco pagou
// R$ 6.201,72 e Bruno R$ 4.997,00 no mesmo formato), e preco_base quebra com
// cupom ou promocao.
// Oferta: estavel. Na Hubla o order_id e "{idDaFatura}-{idDaOferta}".
//
// Aceita varios IDs por formato de proposito: uma oferta nova (promocao, outra
// turma) nasce com ID diferente e precisa caber sem trocar codigo.
export const OFERTAS_DIAGNOSTICO: Record<string, 1 | 2 | 3> = {
  WXwmPZfJxGqeXerA6dkO: 1,
  H8DA8U21x7Lmv3NreVMs: 2,
  qVvads7GKaI7lN1Kctrr: 3,
}

// A oferta "Padrao" (wd6AwMQIJGAekPCGCRsb, R$ 10,00) existe no mesmo produto e
// NAO e mapeada de proposito: nao corresponde a formato nenhum. Compra por ela
// cai no aviso de oferta desconhecida em vez de montar um pacote errado.

/** Regra do PRODUTO, nao da terapeuta: nos demais produtos a Denise segue com os 30%. */
export const PAGAMENTO_DENISE_POR_SESSAO = 95

const SESSOES_POR_FORMATO: Record<1 | 2 | 3, { totalSessoes: number; sessoesPedro: number }> = {
  1: { totalSessoes: 9, sessoesPedro: 2 },
  2: { totalSessoes: 4, sessoesPedro: 1 },
  3: { totalSessoes: 2, sessoesPedro: 1 },
}

export type FormatoDiagnostico = { formato: 1 | 2 | 3; totalSessoes: number; sessoesPedro: number }

/** order_id da Hubla e "{uuidDaFatura}-{idDaOferta}". Devolve so a oferta. */
export function ofertaDoOrderId(orderId?: string | null): string | null {
  if (!orderId) return null
  const partes = String(orderId).split('-')
  return partes.length > 5 ? partes.slice(5).join('-') : null
}

export function formatoDaVenda(sale: Pick<Sale, 'id' | 'order_id'>): FormatoDiagnostico | null {
  const oferta = ofertaDoOrderId(sale.order_id)
  if (!oferta) return null
  const formato = OFERTAS_DIAGNOSTICO[oferta]
  if (!formato) return null
  return { formato, ...SESSOES_POR_FORMATO[formato] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/diagnostico-guiado.test.ts`
Expected: PASS, 7 testes

- [ ] **Step 5: Commit**

```bash
git add lib/diagnostico-guiado.ts lib/diagnostico-guiado.test.ts
git commit -m "feat: reconhece o formato do Diagnostico Guiado pela oferta da Hubla"
```

---

### Task 2: Montagem do pacote

**Files:**
- Modify: `lib/diagnostico-guiado.ts`
- Test: `lib/diagnostico-guiado.test.ts`

**Interfaces:**
- Consumes: `FormatoDiagnostico` da Task 1
- Produces:
  - `type SessaoDoPacote = { numero_sessao: number; terapeuta_id: string; data_agendada: string; comissao_valor: number }`
  - `montarPacote(params: { formato: FormatoDiagnostico; primeiraDataISO: string; pedroId: string; deniseId: string }): SessaoDoPacote[]`

- [ ] **Step 1: Write the failing test**

```typescript
import { montarPacote, PAGAMENTO_DENISE_POR_SESSAO } from './diagnostico-guiado'

const F1 = { formato: 1 as const, totalSessoes: 9, sessoesPedro: 2 }
const F3 = { formato: 3 as const, totalSessoes: 2, sessoesPedro: 1 }
const ARGS = { primeiraDataISO: '2026-09-08T14:00:00.000Z', pedroId: 'PEDRO', deniseId: 'DENISE' }

test('Formato 1: 9 sessoes, as duas primeiras do Pedro', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  assert.equal(p.length, 9)
  assert.deepEqual(p.map(s => s.terapeuta_id), ['PEDRO','PEDRO','DENISE','DENISE','DENISE','DENISE','DENISE','DENISE','DENISE'])
})

test('Formato 3: uma sessao para cada, Pedro primeiro', () => {
  const p = montarPacote({ formato: F3, ...ARGS })
  assert.deepEqual(p.map(s => s.terapeuta_id), ['PEDRO','DENISE'])
})

test('7 dias entre todas, inclusive na virada de terapeuta', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  const SETE = 7 * 24 * 60 * 60 * 1000
  for (let i = 1; i < p.length; i++) {
    const dif = new Date(p[i].data_agendada).getTime() - new Date(p[i-1].data_agendada).getTime()
    assert.equal(dif, SETE, `intervalo errado entre a sessao ${i} e a ${i+1}`)
  }
})

test('a Denise recebe R$ 95 por sessao dela e o Pedro zero', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  assert.deepEqual(p.filter(s => s.terapeuta_id === 'PEDRO').map(s => s.comissao_valor), [0, 0])
  assert.equal(p.filter(s => s.terapeuta_id === 'DENISE').every(s => s.comissao_valor === PAGAMENTO_DENISE_POR_SESSAO), true)
  assert.equal(p.reduce((a, s) => a + s.comissao_valor, 0), 7 * 95)
})

test('numero_sessao vai de 1 a N, em ordem', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  assert.deepEqual(p.map(s => s.numero_sessao), [1,2,3,4,5,6,7,8,9])
})

test('a primeira sessao cai exatamente na data pedida', () => {
  const p = montarPacote({ formato: F3, ...ARGS })
  assert.equal(p[0].data_agendada, '2026-09-08T14:00:00.000Z')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/diagnostico-guiado.test.ts`
Expected: FAIL com "montarPacote is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
export type SessaoDoPacote = {
  numero_sessao: number
  terapeuta_id: string
  data_agendada: string
  comissao_valor: number
}

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Monta o pacote inteiro a partir de UMA data. O Pedro sempre comeca; a Denise
 * pega o restante. Os 7 dias valem entre todas as sessoes, inclusive na virada
 * de um terapeuta para o outro.
 */
export function montarPacote(params: {
  formato: FormatoDiagnostico
  primeiraDataISO: string
  pedroId: string
  deniseId: string
}): SessaoDoPacote[] {
  const { formato, primeiraDataISO, pedroId, deniseId } = params
  const inicio = new Date(primeiraDataISO).getTime()

  return Array.from({ length: formato.totalSessoes }, (_, i) => {
    const doPedro = i < formato.sessoesPedro
    return {
      numero_sessao: i + 1,
      terapeuta_id: doPedro ? pedroId : deniseId,
      data_agendada: new Date(inicio + i * SETE_DIAS_MS).toISOString(),
      comissao_valor: doPedro ? 0 : PAGAMENTO_DENISE_POR_SESSAO,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, todos os testes do projeto

- [ ] **Step 5: Commit**

```bash
git add lib/diagnostico-guiado.ts lib/diagnostico-guiado.test.ts
git commit -m "feat: monta o pacote do Diagnostico dividido entre Pedro e Denise"
```

---

### Task 3: Conflito por sessão, em duas agendas

**Files:**
- Modify: `lib/agenda-conflitos.ts`
- Test: `lib/agenda-conflitos.test.ts` (criar)

**Interfaces:**
- Consumes: `Conflito` já existente em `lib/agenda-conflitos.ts`
- Produces: `buscarConflitosMultiTerapeuta(params: { itens: { terapeuta_id: string; dataISO: string }[]; ignorarSaleId?: string }): Promise<Conflito[]>`

A função existente `buscarConflitosAgenda({ terapeuta_id, datasISO, ignorarSaleId, ignorarSessaoId })` continua igual e não é tocada. A nova agrupa os itens por terapeuta e chama a existente uma vez por terapeuta.

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorTerapeuta } from './agenda-conflitos'

test('agrupa as datas por terapeuta preservando a ordem', () => {
  const g = agruparPorTerapeuta([
    { terapeuta_id: 'PEDRO',  dataISO: '2026-09-08T14:00:00.000Z' },
    { terapeuta_id: 'PEDRO',  dataISO: '2026-09-15T14:00:00.000Z' },
    { terapeuta_id: 'DENISE', dataISO: '2026-09-22T14:00:00.000Z' },
  ])
  assert.deepEqual(g, {
    PEDRO:  ['2026-09-08T14:00:00.000Z', '2026-09-15T14:00:00.000Z'],
    DENISE: ['2026-09-22T14:00:00.000Z'],
  })
})

test('lista vazia devolve objeto vazio', () => {
  assert.deepEqual(agruparPorTerapeuta([]), {})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/agenda-conflitos.test.ts`
Expected: FAIL com "agruparPorTerapeuta is not exported"

- [ ] **Step 3: Write minimal implementation**

Adicionar ao final de `lib/agenda-conflitos.ts`:

```typescript
/**
 * Agrupa as datas pedidas por terapeuta. Exportada para teste: e a unica parte
 * pura de buscarConflitosMultiTerapeuta.
 */
export function agruparPorTerapeuta(
  itens: { terapeuta_id: string; dataISO: string }[],
): Record<string, string[]> {
  const g: Record<string, string[]> = {}
  for (const i of itens) {
    if (!g[i.terapeuta_id]) g[i.terapeuta_id] = []
    g[i.terapeuta_id].push(i.dataISO)
  }
  return g
}

/**
 * Conflito de um pacote cujas sessoes sao de terapeutas diferentes. Cada data e
 * validada contra a agenda do terapeuta DAQUELA sessao, nao contra um terapeuta
 * unico. Existe por causa do Diagnostico Guiado, primeiro produto assim.
 */
export async function buscarConflitosMultiTerapeuta(params: {
  itens: { terapeuta_id: string; dataISO: string }[]
  ignorarSaleId?: string
}): Promise<Conflito[]> {
  const grupos = agruparPorTerapeuta(params.itens)
  const todos: Conflito[] = []
  for (const [terapeuta_id, datasISO] of Object.entries(grupos)) {
    const c = await buscarConflitosAgenda({ terapeuta_id, datasISO, ignorarSaleId: params.ignorarSaleId })
    todos.push(...c)
  }
  return todos.sort((a, b) => a.dataISO.localeCompare(b.dataISO))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agenda-conflitos.ts lib/agenda-conflitos.test.ts
git commit -m "feat: checagem de conflito para pacote com dois terapeutas"
```

---

### Task 4: Rota de agendamento aceita o pacote

**Files:**
- Modify: `app/api/terapeutas/sessoes/agendar/route.ts`

**Interfaces:**
- Consumes: `formatoDaVenda`, `montarPacote` (Tasks 1 e 2), `buscarConflitosMultiTerapeuta` (Task 3)
- Produces: a rota passa a aceitar `sale_id` do Diagnóstico sem `terapeuta_id` fixo por sessão

Regra: se `formatoDaVenda(sale)` devolver um formato, a rota monta o pacote pelo módulo e ignora `numero_sessoes`. Caso contrário, o comportamento atual segue intacto.

- [ ] **Step 1: Adicionar os imports**

```typescript
import { formatoDaVenda, montarPacote } from '@/lib/diagnostico-guiado'
import { buscarConflitosMultiTerapeuta } from '@/lib/agenda-conflitos'
```

- [ ] **Step 2: Buscar os ids do Pedro e da Denise**

Depois da busca do `sale` (linha ~39), adicionar:

```typescript
  // Diagnostico Guiado: pacote com dois terapeutas. Detectado pela oferta.
  const diagnostico = formatoDaVenda(sale as { id: string; order_id?: string })
  let pedroId: string | null = null
  let deniseId: string | null = null
  if (diagnostico) {
    const { data: ativos } = await client
      .from('terapeutas').select('id,nome').eq('ativo', true)
    for (const t of (ativos ?? []) as { id: string; nome: string }[]) {
      const n = t.nome.toLowerCase()
      if (n.includes('pedro')) pedroId = t.id
      if (n.includes('denise')) deniseId = t.id
    }
    if (!pedroId || !deniseId) {
      return NextResponse.json(
        { error: 'Diagnostico Guiado precisa do Pedro e da Denise ativos como terapeutas.' },
        { status: 409 },
      )
    }
  }
```

- [ ] **Step 3: Montar o pacote e checar conflito nas duas agendas**

Substituir o bloco de `datasPedidas` e `buscarConflitosAgenda` (linhas ~73-83) por:

```typescript
  const pacote = diagnostico
    ? montarPacote({ formato: diagnostico, primeiraDataISO: data_primeira_sessao, pedroId: pedroId!, deniseId: deniseId! })
    : null

  const conflitos = pacote
    ? await buscarConflitosMultiTerapeuta({
        itens: pacote.map(s => ({ terapeuta_id: s.terapeuta_id, dataISO: s.data_agendada })),
        ignorarSaleId: sale_id,
      })
    : await buscarConflitosAgenda({
        terapeuta_id,
        datasISO: Array.from({ length: numSessoes }, (_, i) =>
          datasExplicitas ? datasExplicitas[i] : new Date(primeiraDataMs + i * SETE_DIAS_MS).toISOString()),
        ignorarSaleId: sale_id,
      })
  if (conflitos.length > 0) {
    return NextResponse.json({ error: mensagemConflito(conflitos), conflitos }, { status: 409 })
  }
```

- [ ] **Step 4: Usar o pacote na criação das sessões**

Substituir a montagem do array `sessoes` (linhas ~88-105) por:

```typescript
  const base = {
    sale_id,
    status: 'agendada',
    status_consulta: 'aguardando',
    link_meet: null,
    comissao_paga: false,
    paciente_nome: sale.nome as string,
    paciente_email: sale.email as string,
    agendado_por: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
    vendedor_nome: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
    vendedor_email: usuario_email,
  }

  const sessoes = pacote
    ? pacote.map(s => ({
        ...base,
        terapeuta_id: s.terapeuta_id,
        numero_sessao: s.numero_sessao,
        total_sessoes: pacote.length,
        data_agendada: s.data_agendada,
        comissao_valor: s.comissao_valor,
      }))
    : Array.from({ length: numSessoes }, (_, i) => ({
        ...base,
        terapeuta_id,
        numero_sessao: i + 1,
        total_sessoes: numSessoes,
        data_agendada: datasExplicitas ? datasExplicitas[i] : new Date(primeiraDataMs + i * SETE_DIAS_MS).toISOString(),
        comissao_valor: comissao_por_sessao,
      }))
```

- [ ] **Step 5: Verificar que compila e os testes passam**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: TSC sem erro, todos os testes passando, build compilando

- [ ] **Step 6: Commit**

```bash
git add app/api/terapeutas/sessoes/agendar/route.ts
git commit -m "feat: agendar monta o pacote do Diagnostico nas duas agendas"
```

---

### Task 5: Pendentes de Agendamento enxerga o Diagnóstico

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx:648-678`

**Interfaces:**
- Consumes: `formatoDaVenda` (Task 1)

Hoje a lista encontra as vendas por `ilike('produto', '%PrimeiroNome%')`. O Diagnóstico não tem nome de terapeuta, então nunca apareceria. Passa a incluir também as vendas cuja oferta é do Diagnóstico, **apenas na tela do Pedro**, que sempre começa.

- [ ] **Step 1: Adicionar o import**

```typescript
import { formatoDaVenda } from '@/lib/diagnostico-guiado'
```

- [ ] **Step 2: Buscar as vendas do Diagnóstico junto**

Depois do bloco de `candidatasQuery` (linha ~668), adicionar:

```typescript
      // O Diagnostico Guiado nao tem nome de terapeuta no produto, entao a busca
      // por nome nunca o encontra. Ele aparece so na tela do Pedro, que sempre
      // comeca o pacote; agendar dali cria as sessoes dos dois.
      if (primeiroNome.toLowerCase() === 'pedro') {
        const { data: diag } = await client
          .from('sales')
          .select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status,order_id')
          .eq('status', 'aprovada')
          .not('id', 'like', 'manual_%')
        for (const v of (diag ?? []) as (SaleInfo & { order_id?: string })[]) {
          if (!formatoDaVenda(v)) continue
          if (saleIds.includes(v.id)) continue
          if (pendentes.some(p => p.id === v.id)) continue
          pendentes.push(v)
        }
      }
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erro

- [ ] **Step 4: Conferir contra os dados reais**

Run:
```bash
set -a && source .env.local && set +a
python3 -c "
import os,json,urllib.request
URL=os.environ['NEXT_PUBLIC_SUPABASE_URL']; K=os.environ['SUPABASE_SERVICE_ROLE_KEY']
r=urllib.request.Request(f'{URL}/rest/v1/sales?select=nome,order_id&produto=ilike.*Diagn*',headers={'apikey':K,'Authorization':f'Bearer {K}'})
print(len(json.load(urllib.request.urlopen(r))), 'vendas do Diagnostico devem aparecer em Pendentes do Pedro')"
```
Expected: 4

- [ ] **Step 5: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: Diagnostico aparece em Pendentes de Agendamento do Pedro"
```

---

### Task 6: Etiqueta nas cinco telas

**Files:**
- Create: `lib/etiqueta-diagnostico.ts`
- Test: `lib/etiqueta-diagnostico.test.ts`
- Modify: `app/terapeutas/[id]/page.tsx`, `app/terapeutas/agenda/page.tsx`, `app/terapeutas/lista/page.tsx`, `lib/whatsapp-pendentes.ts`

**Interfaces:**
- Consumes: `formatoDaVenda` (Task 1)
- Produces: `rotuloDiagnostico(params: { formato: 1 | 2 | 3; numeroSessao: number; totalSessoes: number }): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDiagnostico } from './etiqueta-diagnostico'

test('rotulo mostra formato e posicao', () => {
  assert.equal(
    rotuloDiagnostico({ formato: 1, numeroSessao: 3, totalSessoes: 9 }),
    'Diagnóstico Guiado · Formato 1 · sessão 3 de 9',
  )
})

test('Formato 3 com duas sessoes', () => {
  assert.equal(
    rotuloDiagnostico({ formato: 3, numeroSessao: 1, totalSessoes: 2 }),
    'Diagnóstico Guiado · Formato 3 · sessão 1 de 2',
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/etiqueta-diagnostico.test.ts`
Expected: FAIL com "Cannot find module './etiqueta-diagnostico'"

- [ ] **Step 3: Write minimal implementation**

```typescript
/** Texto unico da etiqueta, usado nas cinco telas e no WhatsApp. */
export function rotuloDiagnostico(params: {
  formato: 1 | 2 | 3
  numeroSessao: number
  totalSessoes: number
}): string {
  return `Diagnóstico Guiado · Formato ${params.formato} · sessão ${params.numeroSessao} de ${params.totalSessoes}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Usar o rótulo nas telas**

Em cada uma das quatro telas, onde a sessão já é renderizada, adicionar o badge quando `formatoDaVenda(venda)` não for `null`, usando a classe visual existente de etiqueta do projeto (`bg-violet-500/20 text-violet-300 border-violet-500/40`).

Em `lib/whatsapp-pendentes.ts`, acrescentar o rótulo ao texto do lembrete, antes do horário.

- [ ] **Step 6: Verificar que compila e o build passa**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: sem erro

- [ ] **Step 7: Commit**

```bash
git add lib/etiqueta-diagnostico.ts lib/etiqueta-diagnostico.test.ts app/terapeutas lib/whatsapp-pendentes.ts
git commit -m "feat: etiqueta do Diagnostico na agenda, prontuario, lista e WhatsApp"
```

---

### Task 7: Remarcação avisa sobre o intervalo

**Files:**
- Modify: `app/api/terapeutas/sessoes/remarcar/route.ts`
- Test: `lib/diagnostico-guiado.test.ts`

**Interfaces:**
- Produces: `quebraIntervalo(params: { novaDataISO: string; anteriorISO?: string; seguinteISO?: string }): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
import { quebraIntervalo } from './diagnostico-guiado'

test('mover para menos de 7 dias da anterior quebra o intervalo', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-10T14:00:00.000Z',
    anteriorISO: '2026-09-08T14:00:00.000Z',
  }), true)
})

test('exatamente 7 dias nao quebra', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-15T14:00:00.000Z',
    anteriorISO: '2026-09-08T14:00:00.000Z',
  }), false)
})

test('mais de 7 dias nao quebra', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-20T14:00:00.000Z',
    anteriorISO: '2026-09-08T14:00:00.000Z',
  }), false)
})

test('sem vizinhos nao ha o que quebrar', () => {
  assert.equal(quebraIntervalo({ novaDataISO: '2026-09-10T14:00:00.000Z' }), false)
})

test('encostar na seguinte tambem quebra', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-20T14:00:00.000Z',
    seguinteISO: '2026-09-22T14:00:00.000Z',
  }), true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/diagnostico-guiado.test.ts`
Expected: FAIL com "quebraIntervalo is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Diz se mover uma sessao para `novaDataISO` deixa menos de 7 dias entre ela e
 * a sessao anterior ou a seguinte do mesmo pacote. Nao decide nada: quem decide
 * e o comercial, na tela.
 */
export function quebraIntervalo(params: {
  novaDataISO: string
  anteriorISO?: string
  seguinteISO?: string
}): boolean {
  const nova = new Date(params.novaDataISO).getTime()
  if (params.anteriorISO) {
    if (nova - new Date(params.anteriorISO).getTime() < SETE_DIAS_MS) return true
  }
  if (params.seguinteISO) {
    if (new Date(params.seguinteISO).getTime() - nova < SETE_DIAS_MS) return true
  }
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Devolver o aviso na rota de remarcar**

Na rota, depois de validar a nova data e antes de gravar, buscar a sessão anterior e a seguinte do mesmo `sale_id` e devolver no JSON de resposta:

```typescript
      avisoIntervalo: quebraIntervalo({ novaDataISO: nova_data, anteriorISO, seguinteISO })
        ? 'Esta data deixa menos de 7 dias entre as sessões. Você pode manter assim ou empurrar as seguintes.'
        : null,
```

- [ ] **Step 6: Verificar que compila e o build passa**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: sem erro

- [ ] **Step 7: Commit**

```bash
git add lib/diagnostico-guiado.ts lib/diagnostico-guiado.test.ts app/api/terapeutas/sessoes/remarcar/route.ts
git commit -m "feat: remarcar avisa quando o intervalo de 7 dias quebra"
```

---

### Task 9: Empurrar as sessões seguintes

**Files:**
- Create: `app/api/terapeutas/sessoes/empurrar-seguintes/route.ts`
- Modify: `lib/diagnostico-guiado.ts`
- Test: `lib/diagnostico-guiado.test.ts`

**Interfaces:**
- Consumes: `buscarConflitosMultiTerapeuta` (Task 3), `mensagemConflito` de `lib/agenda-conflitos.ts`
- Produces: `novasDatasSeguintes(params: { baseISO: string; quantidade: number }): string[]`

Quando o comercial escolhe empurrar, as sessões seguintes à remarcada recebem novas
datas a partir da data nova dela, mantendo os 7 dias. A rota é separada da de
remarcar de propósito: a remarcação da sessão do meio já aconteceu e foi salva; esta
é a segunda decisão, tomada depois de ver o aviso.

Vale para qualquer produto cujo pacote siga a régua, não só o Diagnóstico.

- [ ] **Step 1: Write the failing test**

```typescript
import { novasDatasSeguintes } from './diagnostico-guiado'

test('gera as datas seguintes de 7 em 7 dias a partir da base', () => {
  const d = novasDatasSeguintes({ baseISO: '2026-09-08T14:00:00.000Z', quantidade: 3 })
  assert.deepEqual(d, [
    '2026-09-15T14:00:00.000Z',
    '2026-09-22T14:00:00.000Z',
    '2026-09-29T14:00:00.000Z',
  ])
})

test('quantidade zero devolve lista vazia', () => {
  assert.deepEqual(novasDatasSeguintes({ baseISO: '2026-09-08T14:00:00.000Z', quantidade: 0 }), [])
})

test('a base nunca aparece na lista, ela ja esta marcada', () => {
  const d = novasDatasSeguintes({ baseISO: '2026-09-08T14:00:00.000Z', quantidade: 2 })
  assert.equal(d.includes('2026-09-08T14:00:00.000Z'), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/diagnostico-guiado.test.ts`
Expected: FAIL com "novasDatasSeguintes is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Datas das sessoes seguintes quando o comercial escolhe empurrar a cadeia.
 * A base e a data NOVA da sessao remarcada, que ja foi salva: por isso ela
 * nunca aparece no resultado.
 */
export function novasDatasSeguintes(params: { baseISO: string; quantidade: number }): string[] {
  const base = new Date(params.baseISO).getTime()
  return Array.from({ length: Math.max(0, params.quantidade) }, (_, i) =>
    new Date(base + (i + 1) * SETE_DIAS_MS).toISOString())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Criar a rota**

`app/api/terapeutas/sessoes/empurrar-seguintes/route.ts`, seguindo o mesmo padrao de
autenticacao e resposta da rota de remarcar. Recebe `{ sessao_id, usuario_email, senha, token }`.

Passos da rota, nesta ordem:

1. Autenticar com `verificarAcesso`, mesmo tratamento de erro da rota de remarcar.
2. Buscar a sessao pelo `sessao_id`. Se nao existir, 404.
3. Buscar as sessoes do mesmo `sale_id` com `numero_sessao` maior que o da sessao
   base, que nao estejam `entregue` nem `cancelada`, ordenadas por `numero_sessao`.
   Se nao houver nenhuma, devolver `{ success: true, movidas: 0 }`.
4. Calcular as datas novas com `novasDatasSeguintes({ baseISO: sessao.data_agendada,
   quantidade: seguintes.length })`.
5. Checar conflito com `buscarConflitosMultiTerapeuta`, passando um item por sessao
   com o `terapeuta_id` DAQUELA sessao e a data nova correspondente, e
   `ignorarSaleId: sessao.sale_id` para as proprias sessoes do pacote nao
   conflitarem entre si. Se houver conflito, devolver 409 com `mensagemConflito`.
   Nada e alterado: tudo ou nada, igual ao agendar.
6. Atualizar cada sessao seguinte com a data nova.
7. Registrar em `atividades_log` via `registrarAtividade`, descrevendo quantas
   sessoes foram movidas e do paciente de quem.
8. Devolver `{ success: true, movidas: <numero> }`.

O link do Google Meet das sessoes movidas fica desatualizado, igual acontece hoje
quando uma sessao e remarcada sem passar por essa rota. Tratar isso esta fora do
escopo desta task e fica registrado como pendencia no MD.

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: sem erro

Rodar tambem o grep de travessao longo: `git diff <base>..HEAD | grep -n "travessao longo"` deve voltar vazio.

- [ ] **Step 7: Commit**

```bash
git add lib/diagnostico-guiado.ts lib/diagnostico-guiado.test.ts app/api/terapeutas/sessoes/empurrar-seguintes/route.ts
git commit -m "feat: rota que empurra as sessoes seguintes mantendo os 7 dias"
```

---

### Task 10: A escolha do comercial na tela

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Consumes: o campo `avisoIntervalo` que a rota de remarcar ja devolve (Task 7), e a rota
  `POST /api/terapeutas/sessoes/empurrar-seguintes` (Task 9)

Hoje a tela chama a rota de remarcar e le apenas `res.ok` e `json.error`. O campo
`avisoIntervalo` chega e e descartado. Esta task fecha o ciclo: mostra o aviso e
oferece as duas saidas que a spec pede.

- [ ] **Step 1: Guardar o aviso ao remarcar**

Nos dois pontos que chamam a rota de remarcar (por volta das linhas 1112 e 1161),
depois de confirmar `res.ok`, ler `json.avisoIntervalo`. Quando vier preenchido,
guardar num state novo junto do `sessao_id` e do nome do paciente:

```typescript
const [avisoRemarcacao, setAvisoRemarcacao] = useState<{
  sessaoId: string
  paciente: string
  mensagem: string
} | null>(null)
```

- [ ] **Step 2: Mostrar o aviso com as duas opcoes**

Um modal, no mesmo padrao visual dos outros modais do arquivo, com:

- Titulo: "Intervalo entre sessoes"
- A mensagem que veio da API
- Botao "Manter as demais como estao" que so fecha o modal
- Botao "Empurrar as seguintes" que chama a rota nova

O texto precisa deixar claro o que cada opcao faz, porque as duas tem custo real:

> Manter deixa a proxima sessao a menos de 7 dias desta. Empurrar remarca todas as
> sessoes seguintes deste pacote, mantendo 7 dias entre elas, e o paciente precisa
> ser avisado.

- [ ] **Step 3: Chamar a rota ao escolher empurrar**

```typescript
const res = await fetch('/api/terapeutas/sessoes/empurrar-seguintes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessao_id: avisoRemarcacao.sessaoId, usuario_email: emailSessao, token }),
})
const json = await res.json()
if (!res.ok) { alert(json.error ?? 'Nao foi possivel empurrar as seguintes.'); return }
alert(`${json.movidas} sessao(oes) remarcada(s).`)
setAvisoRemarcacao(null)
await loadData()
```

Em caso de conflito a rota devolve 409 com a mensagem pronta, entao o `alert` ja
mostra qual data bateu em qual paciente. Nada foi alterado nesse caso, e o comercial
pode escolher manter.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: sem erro

Grep de travessao longo deve voltar vazio.

- [ ] **Step 5: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: comercial escolhe entre manter ou empurrar as sessoes seguintes"
```

---

### Task 8: Documentar e publicar

**Files:**
- Modify: `spr-digital.md`

- [ ] **Step 1: Escrever o item no histórico**

Acrescentar um item numerado no fim do histórico de investigação, antes da seção "## 14. Lógica de Negócio", cobrindo: o produto e os três formatos, a decisão de identificar pela oferta e por que preço e nome foram recusados, os R$ 95 como regra do produto, a mudança em Pendentes de Agendamento (que antes achava a venda pelo nome do terapeuta no produto), a checagem de conflito nas duas agendas, e a exclusão do lançamento manual da Rafaela.

Atualizar também a seção 0 com o que passou a estar em produção.

- [ ] **Step 2: Rodar a verificação final**

Run: `npx tsc --noEmit && npm test && npm run build && npx eslint app/ lib/`
Expected: sem erro novo

- [ ] **Step 3: Commit e publicar**

```bash
git add spr-digital.md
git commit -m "docs: registra o Diagnostico Guiado no spr-digital.md"
git push
```

- [ ] **Step 4: Conferir em produção**

Abrir a tela do Pedro e confirmar que os 4 pacotes aparecem em Pendentes de Agendamento, com a etiqueta. Agendar o da Juliane (Formato 3, o mais simples: duas sessões, uma para cada) e conferir que a sessão 1 caiu na agenda do Pedro e a 2 na da Denise, 7 dias depois.
