# Performance de Funis — Fase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao sistema uma identidade confiável de produto por venda e permitir ao dono montar/salvar "funis" (grupos de produtos + termos de campanha), sem ainda calcular nenhum número de performance.

**Architecture:** Uma extração pura do código do produto a partir do payload dos webhooks (domínio de vendas, reusada por parsers e pelo seeding); um catálogo de produtos (`produtos_catalogo`) semeado dos payloads logados; a coluna `sales.produto_id` capturada nas vendas novas e preenchida no histórico possível; uma resolução por nome para o histórico antigo; e um módulo `funis` isolado (`lib/funis`, `app/api/funis`, telas em `app/performance-funis`) com CRUD de funil.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Supabase (Postgres) / node:test via tsx. Migrações SQL em `supabase/migrations/`.

**Spec:** `docs/superpowers/specs/2026-10-05-performance-funis-2A-design.md`

## Global Constraints

- Testes rodam com `npm test` (= `tsx --test lib/*.test.ts`). Só arquivos `lib/*.test.ts` entram na varredura. Toda lógica testável mora em `lib/`.
- Isolamento de módulo (CLAUDE.md): `lib/funis/*` importa só de si e de `@/lib/supabase`; nada fora de `lib/funis`/`app/api/funis`/`app/performance-funis` importa de dentro deles. A extração de produto do payload é domínio de VENDAS e mora em `lib/produto-do-evento.ts` (fora de `lib/funis`), usada pelos parsers e pelos scripts.
- `produto_id` do funil/catálogo = **id do produto-base** (Hubla `event.product.id`; Kiwify `order.Product.product_id`), NUNCA o id da oferta nem a variável `productId` do `parseHublaSale` (que é `offerItemId ?? product.id`, usada só pra montar `order_id`).
- Chave de produto = par `(plataforma, produto_id)`. Plataformas: `'hubla'` | `'kiwify'`.
- Rotas novas exigem admin do dashboard: `lerIdentidade(req)` + `podeAdministrar(quem)` (padrão de `app/api/dashboard-usuarios/route.ts`).
- Sem travessão em texto pra usuário. Nada de credencial em código/commit.
- Nenhum número de performance (Meta/vendas somadas) nesta fase — só configuração e identidade.

## Review Focus

- **Nome com espaço/caixa diferente** (ex.: "ACESSO VITALÍCIO - CSP " com espaço final): a resolução por nome tem que casar mesmo assim. Coberto no Task 5.
- **Payload sem código de produto** (produto antigo / evento fora do formato): extração devolve `null`, venda grava `produto_id = null`, nada quebra. Coberto nos Tasks 2 e 3.
- **Mesmo `produto_id` com vários nomes** ao longo do tempo: o seeding acumula em `nomes` sem duplicar e não perde grafias. Coberto no Task 4.
- **Venda cujo nome não bate em nenhum catálogo:** resolução devolve `null` (venda "não classificada"), não explode nem chuta um produto. Coberto no Task 5.
- **Funil sem termos de campanha (orgânico) e funil sem nome:** validação aceita termos vazios, rejeita nome vazio. Coberto no Task 8.

---

## Task 1: Migração do schema (catálogo, coluna em sales, funis)

**Files:**
- Create: `supabase/migrations/20261005000000_performance_funis_2a.sql`

**Interfaces:**
- Produces: tabelas `produtos_catalogo`, `funis`, `funil_produtos`; coluna `sales.produto_id text null`.

- [ ] **Step 1: Escrever a migração**

```sql
-- Fase 2A - Performance de Funis: identidade de produto + cadastro de funil.

-- Catálogo de produtos (uma linha por produto-base por plataforma).
create table if not exists produtos_catalogo (
  id            uuid primary key default gen_random_uuid(),
  plataforma    text not null,
  produto_id    text not null,
  nome_exibicao text not null default '',
  nomes         text[] not null default '{}',
  project_id    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (plataforma, produto_id)
);

-- Código do produto na venda (null = não capturado; resolve-se pelo nome).
alter table sales add column if not exists produto_id text;
create index if not exists idx_sales_produto_id on sales (plataforma, produto_id);

-- Funil: grupo nomeado de produtos + termos de campanha (vazio = orgânico).
create table if not exists funis (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  project_id      text,
  termos_campanha text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Produtos dentro de cada funil (por par plataforma+produto_id).
create table if not exists funil_produtos (
  funil_id   uuid not null references funis(id) on delete cascade,
  plataforma text not null,
  produto_id text not null,
  primary key (funil_id, plataforma, produto_id)
);
```

- [ ] **Step 2: Aplicar a migração no banco e verificar**

Aplicar via o fluxo de migração do projeto (Supabase). Verificar rodando um SELECT de sanidade:
Run: consulta `select to_regclass('public.produtos_catalogo'), to_regclass('public.funis'), to_regclass('public.funil_produtos');` e `select column_name from information_schema.columns where table_name='sales' and column_name='produto_id';`
Expected: as três tabelas não-nulas e a coluna `produto_id` presente.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261005000000_performance_funis_2a.sql
git commit -m "feat(funis): schema 2A - produtos_catalogo, funis, funil_produtos, sales.produto_id"
```

---

## Task 2: Extração pura do produto do payload

**Files:**
- Create: `lib/produto-do-evento.ts`
- Test: `lib/produto-do-evento.test.ts`

**Interfaces:**
- Produces:
  - `type ProdutoDoEvento = { plataforma: 'hubla' | 'kiwify'; produto_id: string; nome: string }`
  - `produtoDoEventoHubla(event: Record<string, unknown>): ProdutoDoEvento | null`
  - `produtoDoEventoKiwify(order: Record<string, unknown>): ProdutoDoEvento | null`

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { produtoDoEventoHubla, produtoDoEventoKiwify } from './produto-do-evento'

test('Hubla: pega o produto-base (product.id) e o nome', () => {
  const event = { product: { id: 'HYscfyfSoG2CrsS6JpSe', name: 'ACESSO VITALÍCIO - CSP ' } }
  assert.deepEqual(produtoDoEventoHubla(event), {
    plataforma: 'hubla', produto_id: 'HYscfyfSoG2CrsS6JpSe', nome: 'ACESSO VITALÍCIO - CSP ',
  })
})

test('Hubla: sem product.id -> null', () => {
  assert.equal(produtoDoEventoHubla({ product: { name: 'X' } }), null)
  assert.equal(produtoDoEventoHubla({}), null)
})

test('Kiwify: pega Product.product_id e product_name', () => {
  const order = { Product: { product_id: 'f34a2630-d9e0', product_name: 'Curso X' } }
  assert.deepEqual(produtoDoEventoKiwify(order), {
    plataforma: 'kiwify', produto_id: 'f34a2630-d9e0', nome: 'Curso X',
  })
})

test('Kiwify: sem product_id -> null', () => {
  assert.equal(produtoDoEventoKiwify({ Product: { product_name: 'X' } }), null)
  assert.equal(produtoDoEventoKiwify({}), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test lib/produto-do-evento.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
export type ProdutoDoEvento = { plataforma: 'hubla' | 'kiwify'; produto_id: string; nome: string }

/** O produto-base da venda Hubla. `event.product.id` é o catálogo (NÃO o offers[].id). */
export function produtoDoEventoHubla(event: Record<string, unknown>): ProdutoDoEvento | null {
  const product = event?.product as Record<string, unknown> | undefined
  const id = product?.id as string | undefined
  if (!id) return null
  return { plataforma: 'hubla', produto_id: id, nome: (product?.name as string) ?? '' }
}

/** O produto-base da venda Kiwify (`order.Product.product_id`). */
export function produtoDoEventoKiwify(order: Record<string, unknown>): ProdutoDoEvento | null {
  const product = order?.Product as Record<string, unknown> | undefined
  const id = product?.product_id as string | undefined
  if (!id) return null
  return { plataforma: 'kiwify', produto_id: id, nome: (product?.product_name as string) ?? '' }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test lib/produto-do-evento.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/produto-do-evento.ts lib/produto-do-evento.test.ts
git commit -m "feat(funis): extração pura do produto-base do payload (Hubla/Kiwify)"
```

---

## Task 3: Capturar `produto_id` nas vendas novas

**Files:**
- Modify: `lib/hubla-sale.ts` (type `SaleInsert` + `parseHublaSale`)
- Modify: `lib/kiwify-sale.ts` (`parseKiwifySale`)
- Test: `lib/hubla-sale.test.ts`, `lib/kiwify-sale.test.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `produtoDoEventoHubla`, `produtoDoEventoKiwify` (Task 2).
- Produces: `SaleInsert` ganha `produto_id: string | null`.

- [ ] **Step 1: Teste que falha (Hubla e Kiwify gravam produto_id)**

Acrescentar em `lib/hubla-sale.test.ts`:

```ts
test('parseHublaSale grava produto_id do produto-base (não o offer id)', () => {
  const event = {
    product: { id: 'BASE123', name: 'Produto X' },
    products: [{ offers: [{ id: 'OFFER999' }] }],
    invoice: { id: 'inv1', payer: {}, amount: {}, receivers: [], paymentSession: { utm: {} }, saleDate: '2026-10-01T00:00:00Z' },
  }
  const r = parseHublaSale(event)
  assert.equal(r?.sale.produto_id, 'BASE123')
})
```

Acrescentar em `lib/kiwify-sale.test.ts`:

```ts
test('parseKiwifySale grava produto_id', () => {
  const order = { Product: { product_id: 'KW1', product_name: 'P' }, Customer: {}, Commissions: {}, TrackingParameters: {}, order_id: 'o1' }
  assert.equal(parseKiwifySale(order).produto_id, 'KW1')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test lib/hubla-sale.test.ts lib/kiwify-sale.test.ts`
Expected: FAIL (`produto_id` não existe no tipo / undefined).

- [ ] **Step 3: Implementar**

Em `lib/hubla-sale.ts`: no tipo `SaleInsert`, acrescentar `produto_id: string | null`. No topo importar `import { produtoDoEventoHubla } from '@/lib/produto-do-evento'`. No objeto `sale`, acrescentar:

```ts
produto_id: produtoDoEventoHubla(event)?.produto_id ?? null,
```

Em `lib/kiwify-sale.ts`: importar `import { produtoDoEventoKiwify } from '@/lib/produto-do-evento'` e no objeto `sale` acrescentar:

```ts
produto_id: produtoDoEventoKiwify(order)?.produto_id ?? null,
```

- [ ] **Step 4: Rodar e ver passar (suíte inteira, pra pegar regressão no insert)**

Run: `npm test`
Expected: PASS (inclui hubla-sale e kiwify-sale). Conferir que os webhooks inserem o objeto `sale` inteiro (`.insert(sale)` em `app/api/webhooks/hubla/route.ts` e `.../kiwify/route.ts`) — como gravam o objeto todo, `produto_id` entra sozinho; se algum insert listar colunas à mão, acrescentar `produto_id`.

- [ ] **Step 5: Commit**

```bash
git add lib/hubla-sale.ts lib/kiwify-sale.ts lib/hubla-sale.test.ts lib/kiwify-sale.test.ts
git commit -m "feat(funis): capturar produto_id (produto-base) nas vendas novas Hubla/Kiwify"
```

---

## Task 4: Montagem do catálogo a partir dos eventos (pura) + script de seeding

**Files:**
- Create: `lib/funis/catalogo-dos-eventos.ts`
- Test: `lib/funis/catalogo-dos-eventos.test.ts`  (NOTA: `npm test` só varre `lib/*.test.ts`; adicionar este caminho ao script de teste — ver Step 6)
- Create: `scripts/semear-catalogo-produtos.ts`

**Interfaces:**
- Consumes: `produtoDoEventoHubla`, `produtoDoEventoKiwify` (Task 2).
- Produces:
  - `type LinhaCatalogo = { plataforma: string; produto_id: string; nome_exibicao: string; nomes: string[] }`
  - `montarCatalogo(eventos: { plataforma: string; payload: Record<string, unknown> }[]): LinhaCatalogo[]`

- [ ] **Step 1: Teste que falha**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarCatalogo } from './catalogo-dos-eventos'

test('agrupa por (plataforma, produto_id) e acumula nomes sem duplicar', () => {
  const eventos = [
    { plataforma: 'hubla', payload: { product: { id: 'A', name: 'Nome X' } } },
    { plataforma: 'hubla', payload: { product: { id: 'A', name: 'Nome X ' } } }, // espaço a mais = grafia nova
    { plataforma: 'hubla', payload: { product: { id: 'A', name: 'Nome X' } } }, // repetida, não duplica
  ]
  const cat = montarCatalogo(eventos)
  assert.equal(cat.length, 1)
  assert.equal(cat[0].produto_id, 'A')
  assert.deepEqual(cat[0].nomes.sort(), ['Nome X', 'Nome X '].sort())
  assert.equal(cat[0].nome_exibicao, 'Nome X') // mais frequente
})

test('evento sem produto_id é ignorado', () => {
  assert.deepEqual(montarCatalogo([{ plataforma: 'hubla', payload: {} }]), [])
})

test('Kiwify também entra', () => {
  const cat = montarCatalogo([{ plataforma: 'kiwify', payload: { Product: { product_id: 'K', product_name: 'KP' } } }])
  assert.equal(cat[0].produto_id, 'K')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test lib/funis/catalogo-dos-eventos.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
import { produtoDoEventoHubla, produtoDoEventoKiwify, type ProdutoDoEvento } from '@/lib/produto-do-evento'

export type LinhaCatalogo = { plataforma: string; produto_id: string; nome_exibicao: string; nomes: string[] }

function extrair(plataforma: string, payload: Record<string, unknown>): ProdutoDoEvento | null {
  if (plataforma === 'hubla') return produtoDoEventoHubla(payload)
  if (plataforma === 'kiwify') return produtoDoEventoKiwify(payload)
  return null
}

export function montarCatalogo(
  eventos: { plataforma: string; payload: Record<string, unknown> }[],
): LinhaCatalogo[] {
  // chave -> { nomes em ordem de 1ª aparição, contagem por nome }
  const mapa = new Map<string, { plataforma: string; produto_id: string; nomes: string[]; freq: Map<string, number> }>()
  for (const ev of eventos) {
    const p = extrair(ev.plataforma, ev.payload)
    if (!p) continue
    const chave = `${p.plataforma}|${p.produto_id}`
    let linha = mapa.get(chave)
    if (!linha) { linha = { plataforma: p.plataforma, produto_id: p.produto_id, nomes: [], freq: new Map() }; mapa.set(chave, linha) }
    if (!linha.nomes.includes(p.nome)) linha.nomes.push(p.nome)
    linha.freq.set(p.nome, (linha.freq.get(p.nome) ?? 0) + 1)
  }
  return [...mapa.values()].map(l => ({
    plataforma: l.plataforma,
    produto_id: l.produto_id,
    nomes: l.nomes,
    nome_exibicao: [...l.freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? l.nomes[0] ?? '',
  }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test lib/funis/catalogo-dos-eventos.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever o script de seeding**

`scripts/semear-catalogo-produtos.ts`: lê `webhook_events` (paginado), monta `{plataforma, payload}` de cada evento (campo `payload`), chama `montarCatalogo`, e faz upsert em `produtos_catalogo` por `(plataforma, produto_id)` — acrescentando nomes novos a `nomes` sem apagar `nome_exibicao` já editado pelo dono (merge: se a linha já existe, une `nomes`; só define `nome_exibicao` quando estava vazio). Usa `getSupabaseAdmin()`.

```ts
import { getSupabaseAdmin } from '@/lib/supabase'
import { montarCatalogo } from '@/lib/funis/catalogo-dos-eventos'

async function main() {
  const sb = getSupabaseAdmin()
  const eventos: { plataforma: string; payload: Record<string, unknown> }[] = []
  const BATCH = 1000
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await sb.from('webhook_events')
      .select('plataforma,payload').range(from, from + BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    for (const e of data) if (e.payload) eventos.push({ plataforma: e.plataforma, payload: e.payload })
    if (data.length < BATCH) break
  }
  const linhas = montarCatalogo(eventos)
  console.log('produtos no catálogo:', linhas.length)
  for (const l of linhas) {
    const { data: existente } = await sb.from('produtos_catalogo')
      .select('id,nome_exibicao,nomes').eq('plataforma', l.plataforma).eq('produto_id', l.produto_id).maybeSingle()
    if (existente) {
      const nomes = [...new Set([...(existente.nomes ?? []), ...l.nomes])]
      await sb.from('produtos_catalogo').update({
        nomes, nome_exibicao: existente.nome_exibicao || l.nome_exibicao, updated_at: new Date().toISOString(),
      }).eq('id', existente.id)
    } else {
      await sb.from('produtos_catalogo').insert({
        plataforma: l.plataforma, produto_id: l.produto_id, nome_exibicao: l.nome_exibicao, nomes: l.nomes,
      })
    }
  }
  console.log('seeding concluído')
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 6: Rodar o seeding e verificar**

Garantir que `lib/funis/*.test.ts` entra na suíte: ajustar o script `test` do `package.json` de `tsx --test lib/*.test.ts` para `tsx --test lib/*.test.ts lib/**/*.test.ts` (commitar junto).
Run (seeding, contra o banco de produção, leitura + upsert idempotente): `npx tsx scripts/semear-catalogo-produtos.ts`
Expected: imprime "produtos no catálogo: N" (N > 0) e "seeding concluído"; `select count(*) from produtos_catalogo` > 0.

- [ ] **Step 7: Commit**

```bash
git add lib/funis/catalogo-dos-eventos.ts lib/funis/catalogo-dos-eventos.test.ts scripts/semear-catalogo-produtos.ts package.json
git commit -m "feat(funis): catálogo de produtos a partir dos eventos + script de seeding"
```

---

## Task 5: Resolução do produto por código ou nome (pura)

**Files:**
- Create: `lib/funis/resolver-produto.ts`
- Test: `lib/funis/resolver-produto.test.ts`

**Interfaces:**
- Produces:
  - `type ProdutoCatalogo = { plataforma: string; produto_id: string; nomes: string[] }`
  - `type VendaParaResolver = { plataforma: string; produto_id: string | null; produto: string }`
  - `resolverProdutoId(venda: VendaParaResolver, catalogo: ProdutoCatalogo[]): { plataforma: string; produto_id: string } | null`
  - `normalizarNome(s: string): string`

- [ ] **Step 1: Teste que falha**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolverProdutoId, normalizarNome } from './resolver-produto'

const CAT = [
  { plataforma: 'hubla', produto_id: 'A', nomes: ['ACESSO VITALÍCIO - CSP', 'ACESSO VITALÍCIO - CSP '] },
  { plataforma: 'kiwify', produto_id: 'K', nomes: ['Curso X'] },
]

test('usa o produto_id quando a venda já tem', () => {
  assert.deepEqual(resolverProdutoId({ plataforma: 'hubla', produto_id: 'A', produto: 'qualquer' }, CAT), { plataforma: 'hubla', produto_id: 'A' })
})

test('resolve pelo nome normalizado (trim/caixa) quando não tem produto_id', () => {
  assert.deepEqual(resolverProdutoId({ plataforma: 'hubla', produto_id: null, produto: '  acesso vitalício - csp ' }, CAT), { plataforma: 'hubla', produto_id: 'A' })
})

test('plataforma diferente não casa pelo nome', () => {
  assert.equal(resolverProdutoId({ plataforma: 'kiwify', produto_id: null, produto: 'ACESSO VITALÍCIO - CSP' }, CAT), null)
})

test('nome desconhecido -> null (não classificada)', () => {
  assert.equal(resolverProdutoId({ plataforma: 'hubla', produto_id: null, produto: 'Inexistente' }, CAT), null)
})

test('normalizarNome tira espaços das pontas e baixa a caixa', () => {
  assert.equal(normalizarNome('  AçÃo  '), 'ação')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test lib/funis/resolver-produto.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
export type ProdutoCatalogo = { plataforma: string; produto_id: string; nomes: string[] }
export type VendaParaResolver = { plataforma: string; produto_id: string | null; produto: string }

export function normalizarNome(s: string): string {
  return (s ?? '').trim().toLowerCase()
}

export function resolverProdutoId(
  venda: VendaParaResolver,
  catalogo: ProdutoCatalogo[],
): { plataforma: string; produto_id: string } | null {
  if (venda.produto_id) return { plataforma: venda.plataforma, produto_id: venda.produto_id }
  const alvo = normalizarNome(venda.produto)
  if (!alvo) return null
  const achado = catalogo.find(c =>
    c.plataforma === venda.plataforma && c.nomes.some(n => normalizarNome(n) === alvo),
  )
  return achado ? { plataforma: achado.plataforma, produto_id: achado.produto_id } : null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test lib/funis/resolver-produto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funis/resolver-produto.ts lib/funis/resolver-produto.test.ts
git commit -m "feat(funis): resolução de produto por código ou nome normalizado"
```

---

## Task 6: Backfill do `produto_id` no histórico

**Files:**
- Create: `scripts/backfill-produto-id-vendas.ts`

**Interfaces:**
- Consumes: `produtoDoEventoHubla`/`produtoDoEventoKiwify` (Task 2); tabela `webhook_events`; coluna `sales.produto_id` (Task 1).

- [ ] **Step 1: Escrever o script**

Para cada evento em `webhook_events` com payload, extrair `(plataforma, produto_id)` e o `order_id` do payload; atualizar `sales.produto_id` onde `sales.order_id` casar e `produto_id` estiver nulo. Idempotente (só preenche nulos). Imprime quantas vendas foram preenchidas.

```ts
import { getSupabaseAdmin } from '@/lib/supabase'
import { produtoDoEventoHubla, produtoDoEventoKiwify } from '@/lib/produto-do-evento'

function orderIdDoPayload(plataforma: string, p: Record<string, unknown>): string | null {
  if (plataforma === 'kiwify') return (p?.order_id as string) ?? null
  // Hubla: o order_id da venda é derivado (canonicalParentId-productId) no parser;
  // casar por invoice.id base não é confiável aqui. Em vez disso, casar por
  // (email + produto) via o próprio nome e deixar o match por produto_id nulo
  // para o caminho de nome. Para Hubla, preferir atualizar por order_id só quando
  // o payload trouxer invoice.id sem sufixo -offer; senão, pular (o nome resolve).
  const invoice = p?.invoice as Record<string, unknown> | undefined
  const invId = (invoice?.id as string) ?? null
  return invId ? invId.replace(/-offer-\d+$/, '') : null
}

async function main() {
  const sb = getSupabaseAdmin()
  let preenchidas = 0
  const BATCH = 1000
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await sb.from('webhook_events').select('plataforma,payload').range(from, from + BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    for (const e of data) {
      const p = e.payload as Record<string, unknown>
      if (!p) continue
      const prod = e.plataforma === 'hubla' ? produtoDoEventoHubla(p) : produtoDoEventoKiwify(p)
      if (!prod) continue
      const base = orderIdDoPayload(e.plataforma, p)
      if (!base) continue
      // Casa por order_id "começa com" o base (Hubla deriva "-produtoId"); só nulos.
      const { data: alvo } = await sb.from('sales').select('id,order_id,produto_id')
        .eq('plataforma', e.plataforma).is('produto_id', null).like('order_id', `${base}%`)
      for (const v of alvo ?? []) {
        await sb.from('sales').update({ produto_id: prod.produto_id }).eq('id', v.id)
        preenchidas++
      }
    }
    if (data.length < BATCH) break
  }
  console.log('vendas preenchidas com produto_id:', preenchidas)
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Rodar o backfill e verificar**

Run: `npx tsx scripts/backfill-produto-id-vendas.ts`
Expected: imprime "vendas preenchidas com produto_id: N" (N > 0). Conferir: `select count(*) from sales where produto_id is not null` subiu, e `select count(*) from sales where produto_id is null and data_hora >= '2026-08-04'` é baixo (idealmente perto de 0; o resto vai pelo nome).

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-produto-id-vendas.ts
git commit -m "feat(funis): backfill de produto_id nas vendas a partir dos eventos logados"
```

---

## Task 7: API do catálogo (listar + editar nome)

**Files:**
- Create: `app/api/funis/produtos/route.ts`

**Interfaces:**
- Produces: `GET /api/funis/produtos` (lista o catálogo); `PATCH /api/funis/produtos` (edita `nome_exibicao` de uma linha por `id`).

- [ ] **Step 1: Implementar a rota**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeAdministrar(quem)) return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
  const { data, error } = await getSupabaseAdmin()
    .from('produtos_catalogo').select('id,plataforma,produto_id,nome_exibicao,nomes').order('nome_exibicao')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeAdministrar(quem)) return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
  let body: { id?: string; nome_exibicao?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (!body.id || typeof body.nome_exibicao !== 'string') return NextResponse.json({ error: 'id e nome_exibicao obrigatórios' }, { status: 400 })
  const { data, error } = await getSupabaseAdmin().from('produtos_catalogo')
    .update({ nome_exibicao: body.nome_exibicao, updated_at: new Date().toISOString() }).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 2: Verificar build/type + rota responde**

Run: `npx tsc --noEmit` (sem erro nos arquivos tocados) e `npm run dev` com uma chamada GET autenticada (crachá admin) devolvendo a lista.
Expected: tsc limpo; GET retorna o catálogo.

- [ ] **Step 3: Commit**

```bash
git add app/api/funis/produtos/route.ts
git commit -m "feat(funis): API do catálogo de produtos (listar + editar nome)"
```

---

## Task 8: Validação de funil (pura)

**Files:**
- Create: `lib/funis/validar-funil.ts`
- Test: `lib/funis/validar-funil.test.ts`

**Interfaces:**
- Produces:
  - `type FunilEntrada = { nome: string; termos_campanha: string[]; produtos: { plataforma: string; produto_id: string }[] }`
  - `validarFunil(e: FunilEntrada): { ok: true; funil: FunilEntrada } | { ok: false; erro: string }`

- [ ] **Step 1: Teste que falha**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarFunil } from './validar-funil'

test('nome vazio -> erro', () => {
  const r = validarFunil({ nome: '  ', termos_campanha: [], produtos: [] })
  assert.equal(r.ok, false)
})

test('funil orgânico (sem termos, sem produtos) é válido', () => {
  const r = validarFunil({ nome: 'Orgânico', termos_campanha: [], produtos: [] })
  assert.equal(r.ok, true)
})

test('limpa termos vazios e apara espaços do nome', () => {
  const r = validarFunil({ nome: '  Funil CSP ', termos_campanha: ['CSP', '', '  '], produtos: [{ plataforma: 'hubla', produto_id: 'A' }] })
  assert.equal(r.ok, true)
  if (r.ok) { assert.equal(r.funil.nome, 'Funil CSP'); assert.deepEqual(r.funil.termos_campanha, ['CSP']) }
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test lib/funis/validar-funil.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
export type FunilEntrada = { nome: string; termos_campanha: string[]; produtos: { plataforma: string; produto_id: string }[] }

export function validarFunil(e: FunilEntrada): { ok: true; funil: FunilEntrada } | { ok: false; erro: string } {
  const nome = (e.nome ?? '').trim()
  if (!nome) return { ok: false, erro: 'O funil precisa de um nome.' }
  const termos = (e.termos_campanha ?? []).map(t => t.trim()).filter(Boolean)
  const produtos = (e.produtos ?? []).filter(p => p.plataforma && p.produto_id)
  return { ok: true, funil: { nome, termos_campanha: termos, produtos } }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test lib/funis/validar-funil.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funis/validar-funil.ts lib/funis/validar-funil.test.ts
git commit -m "feat(funis): validação pura de funil (nome obrigatório, orgânico ok)"
```

---

## Task 9: API de funis (CRUD)

**Files:**
- Create: `app/api/funis/route.ts` (GET lista, POST cria)
- Create: `app/api/funis/[id]/route.ts` (GET um, PATCH edita, DELETE exclui)

**Interfaces:**
- Consumes: `validarFunil` (Task 8); tabelas `funis`, `funil_produtos` (Task 1).
- Produces: as rotas REST acima.

- [ ] **Step 1: Implementar `app/api/funis/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'
import { validarFunil } from '@/lib/funis/validar-funil'

export const dynamic = 'force-dynamic'

function guard(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return { status: 401 as const, error: 'Você precisa entrar no sistema.' }
  if (!podeAdministrar(quem)) return { status: 403 as const, error: 'Só um administrador pode fazer isso.' }
  return null
}

export async function GET(req: NextRequest) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  const sb = getSupabaseAdmin()
  const { data: funis, error } = await sb.from('funis').select('*').order('nome')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: vinculos } = await sb.from('funil_produtos').select('funil_id,plataforma,produto_id')
  const porFunil = new Map<string, { plataforma: string; produto_id: string }[]>()
  for (const v of vinculos ?? []) {
    const arr = porFunil.get(v.funil_id) ?? []; arr.push({ plataforma: v.plataforma, produto_id: v.produto_id }); porFunil.set(v.funil_id, arr)
  }
  return NextResponse.json((funis ?? []).map(f => ({ ...f, produtos: porFunil.get(f.id) ?? [] })))
}

export async function POST(req: NextRequest) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const v = validarFunil(body as never)
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })
  const sb = getSupabaseAdmin()
  const { data: funil, error } = await sb.from('funis')
    .insert({ nome: v.funil.nome, termos_campanha: v.funil.termos_campanha }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (v.funil.produtos.length) {
    const linhas = v.funil.produtos.map(p => ({ funil_id: funil.id, plataforma: p.plataforma, produto_id: p.produto_id }))
    const { error: e2 } = await sb.from('funil_produtos').insert(linhas)
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  }
  return NextResponse.json({ ...funil, produtos: v.funil.produtos }, { status: 201 })
}
```

- [ ] **Step 2: Implementar `app/api/funis/[id]/route.ts`**

GET (um funil + produtos), PATCH (revalida com `validarFunil`, atualiza `funis`, substitui `funil_produtos`: apaga os do funil e reinsere), DELETE (apaga o funil; `funil_produtos` cai por cascade). Mesmo `guard`. Exemplo do PATCH no corpo:

```ts
// ... guard, lê body, v = validarFunil(body)
const sb = getSupabaseAdmin()
await sb.from('funis').update({ nome: v.funil.nome, termos_campanha: v.funil.termos_campanha, updated_at: new Date().toISOString() }).eq('id', params.id)
await sb.from('funil_produtos').delete().eq('funil_id', params.id)
if (v.funil.produtos.length) await sb.from('funil_produtos').insert(v.funil.produtos.map(p => ({ funil_id: params.id, ...p })))
```

- [ ] **Step 3: Verificar build/type + fluxo CRUD**

Run: `npx tsc --noEmit` e, com `npm run dev` e crachá admin: POST cria um funil, GET lista, PATCH edita, DELETE remove.
Expected: tsc limpo; os quatro verbos respondem certo; DELETE some com os vínculos.

- [ ] **Step 4: Commit**

```bash
git add app/api/funis/route.ts "app/api/funis/[id]/route.ts"
git commit -m "feat(funis): API CRUD de funis + vínculo com produtos"
```

---

## Task 10: Tela "Produtos" (catálogo visível)

**Files:**
- Create: `app/performance-funis/produtos/page.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/funis/produtos` (Task 7).

- [ ] **Step 1: Implementar a tela**

`'use client'` + `export const dynamic = 'force-dynamic'`. Carrega o catálogo via fetch autenticado (mesmo padrão de chamadas do módulo), lista cada produto com `nome_exibicao` (editável inline, salva via PATCH), plataforma, código e os `nomes` (lista visível, só leitura). Reusa `Header`/estilo das telas existentes do módulo. Protegida por `ProtectedRoute` (padrão das páginas do painel).

- [ ] **Step 2: Verificar na tela**

Run: `npm run dev`, abrir `/performance-funis/produtos` como admin.
Expected: lista os produtos semeados, mostra os nomes, e editar `nome_exibicao` persiste (recarregar mantém).

- [ ] **Step 3: Commit**

```bash
git add app/performance-funis/produtos/page.tsx
git commit -m "feat(funis): tela de catálogo de produtos (nomes visíveis, editar nome)"
```

---

## Task 11: Tela "Funis" (CRUD) + navegação

**Files:**
- Create: `app/performance-funis/funis/page.tsx`
- Modify: `components/Header.tsx`, `components/MobileNav.tsx` (links do módulo)

**Interfaces:**
- Consumes: `/api/funis` e `/api/funis/[id]` (Task 9); `/api/funis/produtos` (Task 7) para a multiseleção.

- [ ] **Step 1: Implementar a tela**

`'use client'` + `export const dynamic = 'force-dynamic'`. Lista os funis (nome, nº de produtos, "orgânico" quando sem termos). Botão "Novo funil" abre formulário: campo Nome; multiseleção de produtos vinda do catálogo (`/api/funis/produtos`, mostra `nome_exibicao`); campo de termos de campanha (lista editável de termos; vazio = orgânico). Salva via POST/PATCH; excluir via DELETE com confirmação. Protegida por `ProtectedRoute`.

- [ ] **Step 2: Ligar a navegação**

Em `components/Header.tsx` e `components/MobileNav.tsx`, acrescentar os links do submódulo Performance de Funis (Dashboard do funil / Funis / Produtos), seguindo o padrão de `NAV_LINKS`. (As entradas "Performance de Funis" já existiam no protótipo não commitado; consolidar aqui.)

- [ ] **Step 3: Verificar na tela**

Run: `npm run dev`, abrir `/performance-funis/funis` como admin.
Expected: criar um funil escolhendo produtos + termos, ver na lista, editar, excluir; navegação leva às telas.

- [ ] **Step 4: Commit**

```bash
git add app/performance-funis/funis/page.tsx components/Header.tsx components/MobileNav.tsx
git commit -m "feat(funis): tela de cadastro de funil (CRUD) + navegação do módulo"
```

---

## Task 12: Documentar + suíte verde + deploy

**Files:**
- Modify: `spr-digital.md` (novo item documentando a 2A entregue)

- [ ] **Step 1: Suíte inteira verde**

Run: `npm test`
Expected: PASS, incluindo `lib/funis/*.test.ts` (confirmar que o script `test` já varre `lib/**/*.test.ts` — Task 4 Step 6).

- [ ] **Step 2: Documentar no spr-digital.md**

Novo item (seguindo o estilo dos itens 100.x): o que a 2A entregou (catálogo, `sales.produto_id` capturado + backfill, resolução por nome, tabelas `funis`/`funil_produtos`, telas Produtos e Funis), com os números do seeding/backfill reais (quantos produtos no catálogo, quantas vendas preenchidas) e as pendências pra 2B.

- [ ] **Step 3: Commit + deploy**

```bash
git add spr-digital.md
git commit -m "docs(funis): registrar a Fase 2A entregue (identidade de produto + cadastro de funil)"
```

Deploy em produção via `git push origin main` (dispara a Vercel) — aplicar a migração do Task 1 no banco de produção antes/junto. Confirmar deploy `success` (status do commit) e a migração aplicada.

---

## Notas de verificação (self-review)

- **Cobertura do spec:** Passo 1 → Tasks 1–7; Passo 2 → Tasks 1, 8–11; telas Produtos/Funis → Tasks 10/11; resolução por nome → Task 5; nomes visíveis → Task 10; orgânico (termos vazios) → Task 8; isolamento → Global Constraints. Fora de escopo (números reais) permanece fora.
- **Consistência de tipos:** `SaleInsert.produto_id: string | null` (Task 3) alimenta o backfill/resolução; `ProdutoCatalogo.nomes` (Task 5) = coluna `nomes` (Task 1) = saída de `montarCatalogo` (Task 4); `FunilEntrada` (Task 8) = corpo aceito pela API (Task 9) = o que a tela envia (Task 11).
- **Review Focus:** os cinco itens estão cobertos nos Tasks 2/3 (payload sem código), 4 (mesmo id, vários nomes), 5 (espaço/caixa; nome desconhecido), 8 (orgânico; nome vazio).
