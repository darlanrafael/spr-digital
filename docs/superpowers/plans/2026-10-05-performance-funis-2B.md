# Performance de Funis — Fase 2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a performance real de anúncios (Meta) por funil cadastrado: visão geral (lista) + detalhe (etapas do funil, criativos, cadência), até os checkouts.

**Architecture:** Funções puras de normalização/agregação em `lib/funis/meta-funil.ts` (recebem os anúncios já baixados e devolvem os agregados, testáveis); o fetch dos anúncios com insights fica em `lib/meta.ts` (casa do token/contas); uma rota `app/api/funis/performance` junta tudo (admin-only); telas em `app/performance-funis/dashboard`.

**Tech Stack:** Next.js 16 / React 19 / TS / Supabase / Graph API v19.0 / recharts / node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-05-performance-funis-2B-design.md`

## Global Constraints

- Testes: `npm test` (= `tsx --test lib/*.test.ts lib/**/*.test.ts`). Lógica testável em `lib/`.
- Isolamento: `lib/funis/*` importa só de si, `@/lib/supabase` e `@/lib/meta` (compartilhado). Rotas em `app/api/funis/*` (admin: `lerIdentidade` + `podeAdministrar`). Telas em `app/performance-funis/*`. Token da Meta só no servidor, nunca no cliente.
- **Fórmulas (verbatim, item 100.6):** CTR = `unique_clicks` / `reach` x 100; Hook Rate = `actions.video_view` / `impressions` x 100 (só anúncio de vídeo; senão null/"-").
- **Fim do funil:** Impressões → Cliques (`inline_link_clicks`) → Visitas (`actions.landing_page_view`) → Checkouts (`actions.initiate_checkout`). SEM compras/faturamento/ROAS (é 2C).
- Alcance do funil = soma de `reach` (aproximado; rotular). `reach`/`unique_clicks` são não-aditivos.
- Sem travessão em texto pra usuário (hífen). Nada de credencial em código.

## Review Focus

- **Anúncio sem vídeo** (imagem/carrossel): Hook Rate deve ser null/"-", não 0 nem erro. Coberto no Task 3.
- **Divisão por zero** (reach=0 no CTR; checkouts=0 no custo/checkout; impressions=0 no Hook Rate): devolve null/"-", não NaN/Infinity. Coberto no Task 3.
- **`actions[]` sem a ação procurada** (campanha sem landing_page_view/initiate_checkout): conta 0, não quebra. Coberto no Task 1.
- **Funil orgânico (sem termos):** nenhum anúncio casa -> agregados zerados, sem erro. Coberto no Task 2.
- **Conta/Meta falha ou sem token:** a rota degrada (números null + aviso), não derruba. Coberto no Task 6.

---

## Task 1: Normalização do anúncio (pura) + tipos

**Files:**
- Create: `lib/funis/meta-funil.ts`
- Test: `lib/funis/meta-funil.test.ts`

**Interfaces:**
- Produces:
  - `type AdInsight = { campanha: string; criativo: string; thumbnail: string | null; spend: number; impressions: number; reach: number; inlineLinkClicks: number; uniqueClicks: number; landingPageView: number; initiateCheckout: number; videoView: number; isVideo: boolean }`
  - `normalizarAd(raw: Record<string, unknown>): AdInsight`

- [ ] **Step 1: Teste que falha** (fixture com a forma REAL do ad)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarAd } from './meta-funil'

const RAW = {
  name: 'VID_Ago_03',
  campaign: { name: 'CSP_Vendas_Frio_Advantage_TesteConta' },
  creative: { name: 'Toque em Saiba Mais', thumbnail_url: 'http://x/t.jpg' },
  insights: { data: [{
    spend: '139.74', impressions: '2612', reach: '1976',
    inline_link_clicks: '40', unique_clicks: '42',
    actions: [
      { action_type: 'landing_page_view', value: '30' },
      { action_type: 'initiate_checkout', value: '8' },
      { action_type: 'video_view', value: '2565' },
      { action_type: 'purchase', value: '3' },
    ],
  }] },
}

test('normaliza os campos do ad de video', () => {
  const a = normalizarAd(RAW)
  assert.equal(a.campanha, 'CSP_Vendas_Frio_Advantage_TesteConta')
  assert.equal(a.criativo, 'Toque em Saiba Mais')
  assert.equal(a.thumbnail, 'http://x/t.jpg')
  assert.equal(a.spend, 139.74)
  assert.equal(a.impressions, 2612)
  assert.equal(a.reach, 1976)
  assert.equal(a.inlineLinkClicks, 40)
  assert.equal(a.uniqueClicks, 42)
  assert.equal(a.landingPageView, 30)
  assert.equal(a.initiateCheckout, 8)
  assert.equal(a.videoView, 2565)
  assert.equal(a.isVideo, true)
})

test('ad sem insights / sem actions -> zeros, isVideo false, sem quebrar', () => {
  const a = normalizarAd({ name: 'IMG_01', campaign: { name: 'C' }, creative: {} })
  assert.equal(a.spend, 0)
  assert.equal(a.impressions, 0)
  assert.equal(a.landingPageView, 0)
  assert.equal(a.initiateCheckout, 0)
  assert.equal(a.videoView, 0)
  assert.equal(a.isVideo, false)
  assert.equal(a.thumbnail, null)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test lib/funis/meta-funil.test.ts` (FAIL)

- [ ] **Step 3: Implementar**

```ts
export type AdInsight = {
  campanha: string; criativo: string; thumbnail: string | null
  spend: number; impressions: number; reach: number
  inlineLinkClicks: number; uniqueClicks: number
  landingPageView: number; initiateCheckout: number
  videoView: number; isVideo: boolean
}

function num(v: unknown): number { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

function acao(actions: unknown, tipo: string): number {
  const arr = (actions as { action_type?: string; value?: unknown }[]) ?? []
  return num(arr.find(a => a.action_type === tipo)?.value)
}

export function normalizarAd(raw: Record<string, unknown>): AdInsight {
  const ins = ((raw.insights as { data?: Record<string, unknown>[] })?.data?.[0]) ?? {}
  const campaign = raw.campaign as { name?: string } | undefined
  const creative = raw.creative as { name?: string; thumbnail_url?: string } | undefined
  const videoView = acao(ins.actions, 'video_view')
  return {
    campanha: campaign?.name ?? '',
    criativo: creative?.name ?? (raw.name as string) ?? '',
    thumbnail: creative?.thumbnail_url ?? null,
    spend: num(ins.spend),
    impressions: num(ins.impressions),
    reach: num(ins.reach),
    inlineLinkClicks: num(ins.inline_link_clicks),
    uniqueClicks: num(ins.unique_clicks),
    landingPageView: acao(ins.actions, 'landing_page_view'),
    initiateCheckout: acao(ins.actions, 'initiate_checkout'),
    videoView,
    isVideo: videoView > 0,
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx --test lib/funis/meta-funil.test.ts` (PASS)
- [ ] **Step 5: Commit** — `git commit -m "feat(funis): normalizacao pura do anuncio da Meta (2B)"`

---

## Task 2: Filtro de anúncios por funil (pura)

**Files:**
- Modify: `lib/funis/meta-funil.ts`
- Test: `lib/funis/meta-funil.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `AdInsight` (Task 1).
- Produces: `adsDoFunil(ads: AdInsight[], termos: string[]): AdInsight[]`

- [ ] **Step 1: Teste que falha**

```ts
import { adsDoFunil } from './meta-funil'

const mk = (campanha: string): any => ({ campanha, criativo: 'x', thumbnail: null, spend: 1, impressions: 1, reach: 1, inlineLinkClicks: 0, uniqueClicks: 0, landingPageView: 0, initiateCheckout: 0, videoView: 0, isVideo: false })

test('pega anuncios cuja campanha CONTEM o termo (case-insensitive)', () => {
  const ads = [mk('CSP_Vendas_Frio'), mk('IAR_Topo'), mk('Outra')]
  assert.equal(adsDoFunil(ads, ['csp']).length, 1)
  assert.equal(adsDoFunil(ads, ['CSP', 'IAR']).length, 2)
})

test('funil organico (sem termos) -> nenhum anuncio', () => {
  assert.equal(adsDoFunil([mk('CSP')], []).length, 0)
})
```

- [ ] **Step 2: Rodar e ver falhar** (FAIL)
- [ ] **Step 3: Implementar**

```ts
export function adsDoFunil(ads: AdInsight[], termos: string[]): AdInsight[] {
  const ts = (termos ?? []).map(t => t.trim().toLowerCase()).filter(Boolean)
  if (ts.length === 0) return []
  return ads.filter(a => { const c = a.campanha.toLowerCase(); return ts.some(t => c.includes(t)) })
}
```

- [ ] **Step 4: Rodar e ver passar** (PASS)
- [ ] **Step 5: Commit** — `git commit -m "feat(funis): filtro de anuncios por termo do funil (2B)"`

---

## Task 3: Agregação do funil + métricas do criativo (pura)

**Files:**
- Modify: `lib/funis/meta-funil.ts`
- Test: `lib/funis/meta-funil.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `AdInsight`.
- Produces:
  - `type FunilAgregado = { investido: number; impressoes: number; cliques: number; visitas: number; checkouts: number; ctr: number | null; hookRate: number | null; custoPorCheckout: number | null; alcanceAprox: number }`
  - `agregarFunil(ads: AdInsight[]): FunilAgregado`
  - `type CriativoMetricas = AdInsight & { ctr: number | null; hookRate: number | null }`
  - `metricasDoCriativo(ad: AdInsight): CriativoMetricas`

- [ ] **Step 1: Teste que falha**

```ts
import { agregarFunil, metricasDoCriativo } from './meta-funil'

const ad = (o: Partial<any> = {}): any => ({ campanha: 'C', criativo: 'x', thumbnail: null, spend: 0, impressions: 0, reach: 0, inlineLinkClicks: 0, uniqueClicks: 0, landingPageView: 0, initiateCheckout: 0, videoView: 0, isVideo: false, ...o })

test('agrega: soma aditivos; CTR = uniq/reach; Hook so sobre video; custo/checkout', () => {
  const ads = [
    ad({ spend: 100, impressions: 1000, reach: 800, inlineLinkClicks: 50, uniqueClicks: 40, landingPageView: 30, initiateCheckout: 10, videoView: 200, isVideo: true }),
    ad({ spend: 50, impressions: 500, reach: 400, inlineLinkClicks: 20, uniqueClicks: 20, landingPageView: 10, initiateCheckout: 5, videoView: 0, isVideo: false }),
  ]
  const r = agregarFunil(ads)
  assert.equal(r.investido, 150)
  assert.equal(r.impressoes, 1500)
  assert.equal(r.cliques, 70)
  assert.equal(r.visitas, 40)
  assert.equal(r.checkouts, 15)
  assert.equal(r.alcanceAprox, 1200)
  assert.equal(r.ctr, Math.round((60 / 1200 * 100) * 100) / 100) // uniq 60 / reach 1200
  assert.equal(r.hookRate, Math.round((200 / 1000 * 100) * 100) / 100) // video: 200 / impressions-de-video 1000
  assert.equal(r.custoPorCheckout, 10) // 150 / 15
})

test('divisao por zero -> null (nao NaN)', () => {
  const r = agregarFunil([ad()])
  assert.equal(r.ctr, null)
  assert.equal(r.hookRate, null)
  assert.equal(r.custoPorCheckout, null)
})

test('criativo de video tem hookRate; imagem tem null', () => {
  assert.equal(metricasDoCriativo(ad({ impressions: 1000, reach: 500, uniqueClicks: 25, videoView: 300, isVideo: true })).hookRate, 30)
  assert.equal(metricasDoCriativo(ad({ impressions: 1000, isVideo: false })).hookRate, null)
  assert.equal(metricasDoCriativo(ad({ reach: 500, uniqueClicks: 25 })).ctr, 5)
  assert.equal(metricasDoCriativo(ad({ reach: 0, uniqueClicks: 0 })).ctr, null)
})
```

- [ ] **Step 2: Rodar e ver falhar** (FAIL)
- [ ] **Step 3: Implementar**

```ts
function pct(num: number, den: number): number | null {
  if (!den) return null
  return Math.round((num / den * 100) * 100) / 100
}
function razao(num: number, den: number): number | null {
  if (!den) return null
  return Math.round((num / den) * 100) / 100
}

export type FunilAgregado = {
  investido: number; impressoes: number; cliques: number; visitas: number; checkouts: number
  ctr: number | null; hookRate: number | null; custoPorCheckout: number | null; alcanceAprox: number
}

export function agregarFunil(ads: AdInsight[]): FunilAgregado {
  const soma = (f: (a: AdInsight) => number) => ads.reduce((s, a) => s + f(a), 0)
  const investido = soma(a => a.spend)
  const impressoes = soma(a => a.impressions)
  const alcanceAprox = soma(a => a.reach)
  const uniq = soma(a => a.uniqueClicks)
  const checkouts = soma(a => a.initiateCheckout)
  const video = ads.filter(a => a.isVideo)
  const videoViews = video.reduce((s, a) => s + a.videoView, 0)
  const impressoesVideo = video.reduce((s, a) => s + a.impressions, 0)
  return {
    investido, impressoes, alcanceAprox,
    cliques: soma(a => a.inlineLinkClicks),
    visitas: soma(a => a.landingPageView),
    checkouts,
    ctr: pct(uniq, alcanceAprox),
    hookRate: pct(videoViews, impressoesVideo),
    custoPorCheckout: razao(investido, checkouts),
  }
}

export type CriativoMetricas = AdInsight & { ctr: number | null; hookRate: number | null }
export function metricasDoCriativo(ad: AdInsight): CriativoMetricas {
  return { ...ad, ctr: pct(ad.uniqueClicks, ad.reach), hookRate: ad.isVideo ? pct(ad.videoView, ad.impressions) : null }
}
```

- [ ] **Step 4: Rodar e ver passar** (PASS)
- [ ] **Step 5: Commit** — `git commit -m "feat(funis): agregacao do funil + metricas do criativo (CTR/Hook Rate) (2B)"`

---

## Task 4: Série diária da cadência (pura)

**Files:**
- Modify: `lib/funis/meta-funil.ts`
- Test: `lib/funis/meta-funil.test.ts` (acrescentar)

**Interfaces:**
- Produces:
  - `type PontoDia = { data: string; investido: number; cliques: number }`
  - `serieDiaria(adsPorDia: { date_start: string; spend: unknown; inline_link_clicks: unknown }[]): PontoDia[]`

Observação: a cadência vem de uma consulta com `time_increment=1` (um registro de insights por dia por ad). Esta função recebe esses registros (já achatados) e soma por dia.

- [ ] **Step 1: Teste que falha**

```ts
import { serieDiaria } from './meta-funil'

test('soma por dia e ordena por data', () => {
  const linhas = [
    { date_start: '2026-10-02', spend: '100', inline_link_clicks: '10' },
    { date_start: '2026-10-01', spend: '50', inline_link_clicks: '5' },
    { date_start: '2026-10-02', spend: '25', inline_link_clicks: '3' },
  ]
  const s = serieDiaria(linhas)
  assert.deepEqual(s, [
    { data: '2026-10-01', investido: 50, cliques: 5 },
    { data: '2026-10-02', investido: 125, cliques: 13 },
  ])
})
```

- [ ] **Step 2: Rodar e ver falhar** (FAIL)
- [ ] **Step 3: Implementar**

```ts
export type PontoDia = { data: string; investido: number; cliques: number }

export function serieDiaria(linhas: { date_start: string; spend: unknown; inline_link_clicks: unknown }[]): PontoDia[] {
  const porDia = new Map<string, PontoDia>()
  for (const l of linhas ?? []) {
    const p = porDia.get(l.date_start) ?? { data: l.date_start, investido: 0, cliques: 0 }
    p.investido += num(l.spend)
    p.cliques += num(l.inline_link_clicks)
    porDia.set(l.date_start, p)
  }
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data))
}
```

(reusa o `num` do Task 1; se precisar, exporte-o ou duplique a 1 linha.)

- [ ] **Step 4: Rodar e ver passar** (PASS)
- [ ] **Step 5: Commit** — `git commit -m "feat(funis): serie diaria da cadencia (2B)"`

---

## Task 5: Fetch dos anúncios com insights na Meta

**Files:**
- Modify: `lib/meta.ts`

**Interfaces:**
- Produces:
  - `getAdsComInsights(accountId: string, dateStart: string, dateEnd: string, datePreset?: string): Promise<Record<string, unknown>[]>` — devolve os ads crus (com `campaign{name}`, `creative{name,thumbnail_url}`, `insights.<periodo>{...}`) de uma conta, paginado.
  - `getAdsDiariosComInsights(accountId, dateStart, dateEnd, datePreset?)` — idem, mas com `time_increment=1` e campos mínimos (`campaign{name}`, `insights...{spend,inline_link_clicks}`) pra cadência.

- [ ] **Step 1: Implementar** (segue o padrão de `fetchAccountPages`/`getAdAccountCampaigns`)

Campos do fetch principal (verbatim):
`name,campaign{name},creative{name,thumbnail_url},insights.<dateParam>{spend,impressions,reach,inline_link_clicks,unique_clicks,actions,video_play_actions}`
onde `<dateParam>` é `date_preset(x)` ou `time_range(json)` exatamente como `getAdAccountCampaigns` monta (reusar a lógica de `dateParam`). Endpoint: `act_<id>/ads?fields=...&limit=500&access_token=...`, paginando por `paging.next`, com os mesmos try/catch e logs por conta de `fetchAccountPages` (uma conta que falha nao derruba as outras — devolve o que tem). Sem token -> `[]`.

Para `getAdsDiariosComInsights`: mesmo, com `insights.<dateParam>.time_increment(1){spend,inline_link_clicks}` e sem creative. A função deve achatar: devolver uma lista de `{ campaign_name, date_start, spend, inline_link_clicks }` (um por dia por ad) pra alimentar `serieDiaria` depois do filtro por funil.

- [ ] **Step 2: Provar rodando contra a Meta** (nao e teste unitario — rede)

Rodar um script de leitura (ou `npx tsx -e`) que chama `getAdsComInsights` numa conta real e imprime quantos ads vieram e 1 exemplo normalizado. Confirmar que `campaign.name`, `creative.thumbnail_url` e os campos de insights chegam.
Expected: ads > 0; exemplo com campanha/criativo/spend/impressions preenchidos. (O controlador ja provou o shape em 05/10; aqui so confirma a funcao.)

- [ ] **Step 3: Commit** — `git commit -m "feat(funis): fetch de ads com insights (funil + criativos + cadencia) na Meta (2B)"`

---

## Task 6: Rota de performance do funil

**Files:**
- Create: `app/api/funis/performance/route.ts`

**Interfaces:**
- Consumes: `getAdsComInsights`/`getAdsDiariosComInsights` (Task 5); `normalizarAd`, `adsDoFunil`, `agregarFunil`, `metricasDoCriativo`, `serieDiaria` (Tasks 1-4); funis do banco; `getAccountIds` de `lib/meta.ts`.
- Produces: `GET /api/funis/performance?datePreset=...` (ou `dateStart/dateEnd`) -> `{ funis: [{ id, nome, organico, ...FunilAgregado }] }`; com `&funilId=<id>` -> `{ funil: {...}, criativos: CriativoMetricas[], cadencia: PontoDia[] }`.

- [ ] **Step 1: Implementar**

Guard admin (`lerIdentidade` + `podeAdministrar`), igual `app/api/funis/route.ts`. Lê o período (datePreset ou dateStart/dateEnd). Busca os ads de TODAS as contas (`getAccountIds().map(getAdsComInsights)`, `Promise.all`, achata), normaliza todos uma vez (`normalizarAd`). Lê os funis do banco (`funis` + `funil_produtos` nao e preciso aqui — só `nome` + `termos_campanha`). Para cada funil: `adsDoFunil(todos, termos)` -> `agregarFunil`. Visão geral = lista. Com `funilId`: além do agregado, `criativos = ads.map(metricasDoCriativo)` (ordenado por investido desc) e `cadencia = serieDiaria(diariosDoFunil)` (buscando os diários só quando `funilId` vier, pra economizar). Sem token / conta falha -> números null + campo `aviso`. Nunca derruba.

- [ ] **Step 2: Verificar** — `npx tsc --noEmit` limpo; com dev + crachá admin, `GET /api/funis/performance?datePreset=last_30d` devolve os 4 funis com números; `&funilId=<id>` devolve criativos + cadência.

- [ ] **Step 3: Commit** — `git commit -m "feat(funis): rota de performance (visao geral + detalhe) (2B)"`

---

## Task 7: Tela — visão geral + seletor de período

**Files:**
- Create: `app/performance-funis/dashboard/page.tsx`
- Modify: `components/PerfFunisTabs.tsx` (acrescentar aba Dashboard como primeira)

**Interfaces:**
- Consumes: `GET /api/funis/performance` (Task 6).

- [ ] **Step 1: Implementar**

`'use client'` + `ProtectedRoute` + `Header`/`MobileNav` + `PerfFunisTabs`, no shell de `app/performance-funis/funis/page.tsx`. Seletor de período no topo (Hoje / 7 / 30 / personalizado) — reusar o padrão de `datePreset` do DRE/Vendas (ver `app/dre/page.tsx` e `lib/datas-da-plataforma.ts`). Lista os funis numa tabela: Nome · Investido · Impressões · Cliques · CTR · Visitas · Checkouts · Custo/checkout. Funil orgânico -> "sem investimento". Clicar na linha vai pra `/performance-funis/dashboard?funilId=<id>` (detalhe no Task 8). Formatar número/moeda como as outras telas (`lib/formatters`). CTR/custo null -> "-".

Em `PerfFunisTabs.tsx`: acrescentar `{ href: '/performance-funis/dashboard', label: 'Dashboard' }` como PRIMEIRA aba. O menu "Funis" (Header/MobileNav) passa a apontar pra `/performance-funis/dashboard`.

- [ ] **Step 2: Verificar** — `npx tsc --noEmit` limpo; `/performance-funis/dashboard` lista os funis com números reais (checkpoint visual com o dono).

- [ ] **Step 3: Commit** — `git commit -m "feat(funis): tela de visao geral de performance + aba Dashboard (2B)"`

---

## Task 8: Tela — detalhe do funil (etapas + criativos + cadência)

**Files:**
- Modify: `app/performance-funis/dashboard/page.tsx` (render do detalhe quando `funilId` presente)

**Interfaces:**
- Consumes: `GET /api/funis/performance?funilId=...` (Task 6).

- [ ] **Step 1: Implementar**

Quando houver `funilId` na URL, buscar o detalhe e mostrar o painel do funil (reusar o visual do protótipo `app/performance-funis/page.tsx`, adaptando pra dados reais):
- **Etapas:** Impressões → Cliques → Visitas → Checkouts, com a % de passagem entre cada etapa (ex.: Cliques/Impressões, Visitas/Cliques, Checkouts/Visitas).
- **Criativos:** tabela com thumbnail (img), nome do criativo, campanha, Investido, CTR, Hook Rate ("-" se não vídeo), Cliques. Ordenada por investido desc.
- **Cadência diária:** LineChart (recharts) de investido por dia (e cliques como 2a linha opcional) — seguir a skill de dataviz (série única sem legenda; emerald pra dinheiro; sem eixo duplo; hover). Reusar o padrão do gráfico de cadência do protótipo.
Botão/voltar pra visão geral. Alcance rotulado como "aprox." onde aparecer.

- [ ] **Step 2: Verificar** — `npx tsc --noEmit` limpo; abrir um funil e conferir etapas + criativos (com miniatura) + gráfico, com dados reais (checkpoint visual com o dono).

- [ ] **Step 3: Commit** — `git commit -m "feat(funis): detalhe do funil (etapas, criativos, cadencia) com dados reais (2B)"`

---

## Task 9: Documentar + suíte verde

**Files:**
- Modify: `spr-digital.md`

- [ ] **Step 1: Suíte** — `npm test` (verde, inclui `lib/funis/meta-funil.test.ts`).
- [ ] **Step 2: Documentar** — novo item (estilo 104): o que a 2B entrega (camada Meta por funil, visão geral + detalhe, criativos com CTR/Hook Rate, cadência), com os números reais provados e as pendências pra 2C/2D. Registrar a decisão do alcance aproximado.
- [ ] **Step 3: Commit** — `git commit -m "docs: registrar a Fase 2B (Performance de Funis - dados Meta)"`

(Deploy NÃO entra nesta fase: o dono decidiu publicar tudo junto só quando o conjunto estiver pronto e aprovado. Fica na branch.)

---

## Self-Review

- **Cobertura do spec:** camada de dados -> Tasks 1-6; visão geral -> Task 7; detalhe (etapas/criativos/cadência) -> Task 8; período -> Task 7; fórmulas CTR/Hook -> Task 3; alcance aproximado -> Tasks 3/8; fora de escopo (compras/faturamento) permanece fora.
- **Consistência de tipos:** `AdInsight` (T1) alimenta T2/T3/T4; `FunilAgregado`/`CriativoMetricas`/`PontoDia` (T3/T4) = o que a rota (T6) devolve = o que as telas (T7/T8) consomem. `getAdsComInsights` (T5) devolve o cru que `normalizarAd` (T1) espera.
- **Review Focus:** os 5 itens cobertos nos Tasks 1 (actions ausente), 2 (orgânico), 3 (sem vídeo; divisão por zero), 6 (Meta/token falha).
