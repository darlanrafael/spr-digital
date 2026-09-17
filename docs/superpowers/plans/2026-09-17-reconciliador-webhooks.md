# Reconciliador de webhooks perdidos + alerta - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nenhuma venda se perde por timeout transitorio de banco: um reconciliador reprocessa os `webhook_events` que falharam (auto-cura) e avisa por WhatsApp.

**Architecture:** Extrair a montagem "payload -> venda" dos webhooks em funcoes puras compartilhadas; um endpoint reconciliador (protegido, rodado por cron) reusa essas funcoes pra re-inserir vendas que faltam; um alerta best-effort avisa o que foi recuperado.

**Tech Stack:** TypeScript, Next.js route handlers, Supabase; testes `node:test` + `assert/strict` via `tsx --test lib/*.test.ts`.

## Global Constraints

- **O comportamento vivo dos webhooks NAO muda.** As Tasks 1 e 2 so EXTRAEM a montagem do `sale` pra uma funcao; a saida (o objeto gravado em `sales`) tem que ser IDENTICA a de hoje. Nada de dedup/insert muda.
- O reconciliador so INSERE venda que falta (dedup por `order_id`); nunca altera venda existente; idempotente.
- Nao editar fechamentos confirmados (fora de escopo).
- Alerta e best-effort: nunca derruba o reconciliador.
- Fixtures de teste sao SINTETICOS (sem PII real de cliente), fieis a estrutura do payload.
- Textos PT sem travessao. `npx tsc --noEmit` limpo; `npm test` verde.

---

### Task 1: `SaleInsert` + `parseHublaSale` (extrair) + refactor do webhook Hubla

**Files:**
- Create: `lib/hubla-sale.ts`, `lib/hubla-sale.test.ts`
- Modify: `app/api/webhooks/hubla/route.ts`

**Interfaces:**
- Produces: `type SaleInsert` (o shape gravado em `sales`); `parseHublaSale(event: Record<string, unknown>): { sale: SaleInsert; isOfferFormat: boolean } | null` - `null` quando o webhook hoje IGNORA sem inserir (fatura pai com filhos). Consumido pela Task 4.

- [ ] **Step 1: Criar o tipo e a funcao movendo a logica existente**

Em `lib/hubla-sale.ts`, definir `SaleInsert` (os campos do objeto `sale` de hoje: `id, project_id, plataforma, status, order_id, data_hora, nome, email, telefone, produto, oferta_nome, preco_base, valor_pago_cliente, valor_com_juros, valor_liquido, moeda, valores_originais, utm_source, utm_medium, utm_campaign, utm_content, utm_term`; tipar `valores_originais` como `Record<string, unknown> | null`). Mover para `parseHublaSale(event)` TODA a logica que hoje vive no handler `invoice.payment_succeeded` de `app/api/webhooks/hubla/route.ts` ENTRE o inicio do `try` e o fim do `const sale = { ... }`, inclusive: a checagem de fatura pai (`hasChildInvoices && !hasParentInvoice` -> `return null`), `payer/product/amount/receivers/paymentSession/utm`, `sellerReceiver/sellerTotalCents`, `moeda/valoresEmMoeda` (imports de `@/lib/moeda-da-venda`), `invoiceId`, `offers/offerItemId/ofertaNome/productId` (import de `@/lib/oferta-do-webhook`), `isOfferFormat/canonicalParentId/orderId`, e o objeto `sale`. A funcao devolve `{ sale, isOfferFormat }` (ou `null` no caso da fatura pai). NAO mover o dedup nem o insert - eles ficam no webhook. Copiar os comentarios explicativos junto (eles documentam decisoes de dinheiro).

- [ ] **Step 2: Refatorar o webhook pra usar a funcao**

Em `app/api/webhooks/hubla/route.ts`, no handler `invoice.payment_succeeded`, substituir todo o bloco movido por:

```ts
      const parsed = parseHublaSale(event)
      if (!parsed) {
        console.log('[Hubla Webhook] fatura pai ignorada — aguardando webhooks dos produtos filhos')
        await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'parent_invoice_ignored', payload: body })
        return NextResponse.json({ success: true, event: 'parent_invoice_ignored' })
      }
      const { sale, isOfferFormat } = parsed
      const orderId = sale.order_id
```

O resto (dedup por `orderId`, offer-priority update, insert, alertas de valor) fica igual, usando `sale`/`isOfferFormat`/`orderId`. Importar `parseHublaSale` de `@/lib/hubla-sale`. Remover imports que passaram a ser usados so dentro de `lib/hubla-sale.ts` (moeda-da-venda, oferta-do-webhook) SE nao forem mais usados no route.

- [ ] **Step 3: Teste de fixture (trava o shape)**

Em `lib/hubla-sale.test.ts`, com um payload SINTETICO fiel (estrutura de `event.invoice`/`event.product`/`event.products[0].offers`/`payer`/`amount`/`receivers`/`paymentSession.utm`), assertar que `parseHublaSale(event).sale` tem os campos esperados (produto, email, valor_pago_cliente = subtotalCents/100, valor_liquido = sellerTotalCents/100, order_id = `${canonicalParentId}-${productId}`), e um caso de fatura pai (`childInvoiceIds` cheio, sem `parentInvoiceId`) devolvendo `null`. NAO usar dados reais de cliente.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHublaSale } from './hubla-sale'

const eventBase = () => ({
  invoice: { id: 'fatura-1', saleDate: '2026-09-12T01:15:00Z',
    payer: { firstName: 'Fulano', lastName: 'Teste', email: 'f@x.local', phone: '' },
    amount: { subtotalCents: 29700, totalCents: 29700 },
    receivers: [{ role: 'seller', totalCents: 28514 }],
    paymentSession: { utm: { source: 'FB' } } },
  product: { id: 'PROD1', name: 'COMO SER PERDOADO' },
  products: [{ offers: [{ id: 'PROD1' }] }],
})

test('parseHublaSale monta a venda com os valores certos', () => {
  const { sale } = parseHublaSale(eventBase())!
  assert.equal(sale.produto, 'COMO SER PERDOADO')
  assert.equal(sale.email, 'f@x.local')
  assert.equal(sale.valor_pago_cliente, 297)
  assert.equal(sale.valor_liquido, 285.14)
  assert.equal(sale.order_id, 'fatura-1-PROD1')
  assert.equal(sale.plataforma, 'hubla')
  assert.equal(sale.status, 'aprovada')
})

test('parseHublaSale devolve null para fatura pai com filhos', () => {
  const ev: any = eventBase()
  ev.invoice.childInvoiceIds = ['a', 'b']
  assert.equal(parseHublaSale(ev), null)
})
```

- [ ] **Step 4: Rodar testes + tsc**

Run: `npm test 2>&1 | tail -6` e `npx tsc --noEmit`. Expected: verde, sem erros.

- [ ] **Step 5: Commit**

```bash
git add lib/hubla-sale.ts lib/hubla-sale.test.ts app/api/webhooks/hubla/route.ts
git commit -m "refactor: extrai parseHublaSale (comportamento identico) + teste de fixture"
```

---

### Task 2: `parseKiwifySale` (extrair) + refactor do webhook Kiwify

**Files:**
- Create: `lib/kiwify-sale.ts`, `lib/kiwify-sale.test.ts`
- Modify: `app/api/webhooks/kiwify/route.ts`

**Interfaces:**
- Consumes: `SaleInsert` de `@/lib/hubla-sale` (Task 1).
- Produces: `parseKiwifySale(order: Record<string, unknown>): SaleInsert`. Consumido pela Task 4.

- [ ] **Step 1: Criar a funcao movendo a logica**

Em `lib/kiwify-sale.ts`, importar `SaleInsert` de `@/lib/hubla-sale`, e mover para `parseKiwifySale(order)` a logica do handler `order_approved` que monta o `sale`: `product/customer/commissions`, `moeda` (import `moedaDaKiwify` de `@/lib/moeda-da-venda`), `tracking`, `orderId`, e o objeto `sale` inteiro (linhas ate `utm_term`). Devolve o `sale`. NAO mover o dedup/insert nem os alertas de moeda/liquido - ficam no webhook. Copiar os comentarios.

- [ ] **Step 2: Refatorar o webhook**

Em `app/api/webhooks/kiwify/route.ts`, no handler `order_approved`, substituir o bloco de montagem do `sale` por:

```ts
      const sale = parseKiwifySale(order)
      const orderId = sale.order_id
```

Importar `parseKiwifySale` de `@/lib/kiwify-sale`. O resto (dedup, insert, alertas) fica igual. Remover imports que so eram usados no bloco movido, se aplicavel.

- [ ] **Step 3: Teste de fixture**

Em `lib/kiwify-sale.test.ts`, payload SINTETICO (`Product`, `Customer`, `Commissions`, `TrackingParameters`, `order_id`, `approved_date`), assertar os campos do `sale` (produto, email, valor_pago_cliente = charge_amount/100, valor_liquido = my_commission/100, order_id). Sem PII real.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseKiwifySale } from './kiwify-sale'

test('parseKiwifySale monta a venda com os valores certos', () => {
  const order = {
    order_id: 'kw-1', approved_date: '2026-09-14T10:00:00Z',
    Product: { product_name: 'IImersão - A Reaproximação - Oficial', product_offer_name: 'X' },
    Customer: { full_name: 'Fulano', email: 'f@x.local', mobile: '' },
    Commissions: { charge_amount: 39900, my_commission: 35000, product_base_price: 39900, currency: 'BRL' },
    TrackingParameters: { utm_source: 'FB' },
  }
  const sale = parseKiwifySale(order as any)
  assert.equal(sale.plataforma, 'kiwify')
  assert.equal(sale.produto, 'IImersão - A Reaproximação - Oficial')
  assert.equal(sale.valor_pago_cliente, 399)
  assert.equal(sale.valor_liquido, 350)
  assert.equal(sale.order_id, 'kw-1')
})
```

- [ ] **Step 4: Rodar testes + tsc**; **Step 5: Commit** (`git add lib/kiwify-sale.* app/api/webhooks/kiwify/route.ts; git commit -m "refactor: extrai parseKiwifySale (comportamento identico) + teste"`)

---

### Task 3: Logica pura do reconciliador (+ teste)

**Files:**
- Create: `lib/reconciliador.ts`, `lib/reconciliador.test.ts`

**Interfaces:**
- Consumes: `SaleInsert`, `parseHublaSale`, `parseKiwifySale`.
- Produces: `type EventoFalho = { plataforma: 'hubla' | 'kiwify'; payload: Record<string, unknown> }`; `reconstruirVenda(ev: EventoFalho): SaleInsert | null`; `decidirReinsercoes(eventos: EventoFalho[], orderIdsExistentes: Set<string>): { inserir: SaleInsert[]; semOrderId: SaleInsert[] }`. Consumido pela Task 4.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirReinsercoes } from './reconciliador'

const evHubla = (fat: string, prod='PROD1') => ({ plataforma: 'hubla' as const, payload: { event: {
  invoice: { id: fat, saleDate: '2026-09-12T01:15:00Z', payer: { firstName: 'F', lastName: 'T', email: 'f@x.local' },
    amount: { subtotalCents: 29700, totalCents: 29700 }, receivers: [{ role: 'seller', totalCents: 28514 }], paymentSession: { utm: {} } },
  product: { id: prod, name: 'COMO SER PERDOADO' }, products: [{ offers: [{ id: prod }] }] } } })

test('insere so o que falta; pula o que ja existe', () => {
  const eventos = [evHubla('f1'), evHubla('f2')]
  const { inserir } = decidirReinsercoes(eventos, new Set(['f1-PROD1']))
  assert.equal(inserir.length, 1)
  assert.equal(inserir[0].order_id, 'f2-PROD1')
})
```

- [ ] **Step 2: Rodar e ver falhar** (`npm test` -> FAIL, funcao inexistente)

- [ ] **Step 3: Implementar**

```ts
import { parseHublaSale, type SaleInsert } from './hubla-sale'
import { parseKiwifySale } from './kiwify-sale'

export type EventoFalho = { plataforma: 'hubla' | 'kiwify'; payload: Record<string, unknown> }

/** Reconstroi a venda do payload de um webhook que falhou. `null` quando o evento
 *  nao gera venda (ex.: fatura pai da Hubla). */
export function reconstruirVenda(ev: EventoFalho): SaleInsert | null {
  if (ev.plataforma === 'hubla') {
    const event = (ev.payload?.event as Record<string, unknown>) ?? {}
    const parsed = parseHublaSale(event)
    return parsed ? parsed.sale : null
  }
  const order = (ev.payload?.order as Record<string, unknown>) ?? ev.payload
  return parseKiwifySale(order)
}

/** Decide quais vendas re-inserir: as que faltam (order_id nao esta em `orderIdsExistentes`).
 *  Vendas sem `order_id` vao para `semOrderId` (nao da pra dedup com seguranca; reportar). */
export function decidirReinsercoes(eventos: EventoFalho[], orderIdsExistentes: Set<string>): { inserir: SaleInsert[]; semOrderId: SaleInsert[] } {
  const inserir: SaleInsert[] = []
  const semOrderId: SaleInsert[] = []
  const vistos = new Set<string>()
  for (const ev of eventos) {
    const sale = reconstruirVenda(ev)
    if (!sale) continue
    if (!sale.order_id) { semOrderId.push(sale); continue }
    if (orderIdsExistentes.has(sale.order_id) || vistos.has(sale.order_id)) continue
    vistos.add(sale.order_id)
    inserir.push(sale)
  }
  return { inserir, semOrderId }
}
```

- [ ] **Step 4: Rodar e ver passar** (`npm test`); **Step 5: tsc**; **Step 6: Commit** (`git add lib/reconciliador.*; git commit -m "feat: logica pura do reconciliador de webhooks"`)

---

### Task 4: Endpoint do reconciliador + alerta + cron

**Files:**
- Create: `app/api/webhooks/reconciliar/route.ts`, `lib/alerta-reconciliacao.ts`
- Modify: `vercel.json` (adicionar `crons`)

**Interfaces:**
- Consumes: `decidirReinsercoes` (Task 3); `getSupabaseAdmin`, `verificarSecretCron` (`@/lib/whatsapp-pendentes`).

- [ ] **Step 1: Alerta best-effort**

`lib/alerta-reconciliacao.ts`:

```ts
export type ResumoReconciliacao = {
  recuperadas: { plataforma: string; cliente: string; produto: string; valor: number; order_id: string }[]
  naoRecuperadas: { plataforma: string; cliente: string; produto: string; motivo: string }[]
}

/** Avisa por WhatsApp (via n8n) o que a reconciliacao fez. Best-effort: nunca lanca. */
export async function alertarReconciliacao(resumo: ResumoReconciliacao): Promise<void> {
  const url = process.env.N8N_RECONCILIACAO_WEBHOOK_URL
  if (!url) return
  if (resumo.recuperadas.length === 0 && resumo.naoRecuperadas.length === 0) return
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resumo) })
  } catch (err) {
    console.error('[alerta-reconciliacao] falha ao avisar:', err)
  }
}
```

- [ ] **Step 2: Endpoint**

`app/api/webhooks/reconciliar/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron } from '@/lib/whatsapp-pendentes'
import { decidirReinsercoes, type EventoFalho } from '@/lib/reconciliador'
import { alertarReconciliacao, type ResumoReconciliacao } from '@/lib/alerta-reconciliacao'
import { logWebhookEvent } from '@/lib/webhook-log'

const EVENTOS_PAGAMENTO = ['invoice.payment_succeeded', 'order_approved']

export async function POST(req: NextRequest) {
  if (!verificarSecretCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const client = getSupabaseAdmin()

  const { data: falhas } = await client
    .from('webhook_events')
    .select('plataforma, tipo_evento, payload')
    .in('resultado', ['insert_error', 'exception'])
    .in('tipo_evento', EVENTOS_PAGAMENTO)
  const eventos: EventoFalho[] = (falhas ?? []).map(f => ({ plataforma: f.plataforma, payload: f.payload as Record<string, unknown> }))

  // order_ids que ja existem, pra nao re-inserir (dedup)
  const { data: existentes } = await client.from('sales').select('order_id').not('order_id', 'is', null)
  const orderIdsExistentes = new Set((existentes ?? []).map(r => r.order_id as string))

  const { inserir, semOrderId } = decidirReinsercoes(eventos, orderIdsExistentes)

  const recuperadas: ResumoReconciliacao['recuperadas'] = []
  const naoRecuperadas: ResumoReconciliacao['naoRecuperadas'] = []
  for (const sale of inserir) {
    const { error } = await client.from('sales').insert(sale)
    if (error) {
      naoRecuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, motivo: error.message })
      await logWebhookEvent({ plataforma: sale.plataforma as 'hubla' | 'kiwify', tipoEvento: 'reconciliacao', resultado: 'reconcile_insert_error', detalhe: `${sale.order_id}: ${error.message}`, payload: sale })
    } else {
      recuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, valor: sale.valor_pago_cliente, order_id: sale.order_id as string })
      await logWebhookEvent({ plataforma: sale.plataforma as 'hubla' | 'kiwify', tipoEvento: 'reconciliacao', resultado: 'reconcile_recovered', saleId: sale.id, detalhe: sale.order_id, payload: sale })
    }
  }
  for (const sale of semOrderId) naoRecuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, motivo: 'payload sem order_id' })

  await alertarReconciliacao({ recuperadas, naoRecuperadas })
  return NextResponse.json({ varridas: eventos.length, recuperadas: recuperadas.length, naoRecuperadas: naoRecuperadas.length })
}
```

(`sale.plataforma` existe no `SaleInsert`; ele e string literal 'hubla'/'kiwify'.)

- [ ] **Step 3: Cron no vercel.json**

Adicionar (ou criar o campo) `crons` em `vercel.json`:

```json
"crons": [{ "path": "/api/webhooks/reconciliar", "schedule": "*/15 * * * *" }]
```

Nota: o cron da Vercel chama via GET sem header custom. Se o plano da conta nao suportar cron ou header, documentar no report que o disparo sera por cron externo com o header `x-whatsapp-cron-secret`, e (se necessario) aceitar tambem GET no endpoint. Como `verificarSecretCron` exige o header, e o cron nativo da Vercel nao envia header custom, o caminho realista e **cron externo** (ex.: cron-job.org) batendo com o header; deixar isso explicito no report e NAO depender do cron nativo sem confirmar.

- [ ] **Step 4: tsc + testes**

Run: `npx tsc --noEmit` e `npm test`. Expected: sem erros, verde.

- [ ] **Step 5: Validacao rodando (controlador, contra o ESPELHO)**

O controlador: semeia um `webhook_events` com `resultado='insert_error'`, `tipo_evento='invoice.payment_succeeded'` e um payload cuja venda NAO existe em `sales`; bate no endpoint com o header do secret; confirma que a venda foi inserida UMA vez; bate de novo e confirma que NAO duplica. NUNCA rodar com escrita contra producao.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/reconciliar/route.ts lib/alerta-reconciliacao.ts vercel.json
git commit -m "feat: endpoint reconciliador de webhooks + alerta + cron"
```

---

## Notas de validacao
- As Tasks 1 e 2 sao refatoracoes de comportamento-preservado: o teste de fixture trava o shape, e o diff deve mostrar so MOVIMENTO de codigo (mesmas expressoes) + a chamada nova no route.
- O reconciliador e idempotente por construcao (dedup por order_id contra `sales` + dedup interno por `vistos`).
- A env `N8N_RECONCILIACAO_WEBHOOK_URL` e nova: sem ela, o alerta e no-op (o reconciliador continua recuperando). Registrar no report que ela precisa ser configurada na Vercel pra o alerta funcionar.
