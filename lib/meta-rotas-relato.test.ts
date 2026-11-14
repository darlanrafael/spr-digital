import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'
import { GET as custoTrafego } from '../app/api/meta/custo-trafego/route'
import { GET as insights } from '../app/api/meta/insights/route'
import { ERRO_TRAFEGO_INCOMPLETO, AVISO_DRE_META_INCOMPLETA } from './trafego-do-fechamento'

// As rotas da Meta usadas pelo Fechamento, DRE e inicio passam o relato de falha
// adiante (dono 10/11/2026, Task 6; revisao Codex t6). 5 contas simuladas, a C
// (R$ 8.000) falhando: era o caso que gravava R$ 22.000 como completo.

const fetchOriginal = globalThis.fetch
let contaQueFalha: string | null = null
const gasto: Record<string, string> = { A: '5000', B: '6000', C: '8000', D: '7000', E: '4000' }
const envAntes = { token: process.env.META_ACCESS_TOKEN, contas: process.env.META_AD_ACCOUNT_IDS }

beforeEach(() => {
  process.env.META_ACCESS_TOKEN = 'tok-de-teste'
  process.env.META_AD_ACCOUNT_IDS = 'A,B,C,D,E'
  contaQueFalha = null
  globalThis.fetch = (async (url: string) => {
    const conta = /act_(\w+)\//.exec(url)?.[1] ?? ''
    if (conta === contaQueFalha) return { ok: false, status: 500, text: async () => 'erro', json: async () => ({}) } as unknown as Response
    const json = { data: [{ name: `CSP - ${conta}`, insights: { data: [{ spend: gasto[conta] }] } }] }
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = fetchOriginal
  if (envAntes.token === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = envAntes.token
  if (envAntes.contas === undefined) delete process.env.META_AD_ACCOUNT_IDS; else process.env.META_AD_ACCOUNT_IDS = envAntes.contas
})

const pedido = (caminho: string) => new Request(`http://localhost${caminho}`, {
  headers: { [CABECALHOS_DA_IDENTIDADE.tipo]: 'dashboard:admin', [CABECALHOS_DA_IDENTIDADE.id]: 'u1' },
}) as unknown as NextRequest

const CUSTO = '/api/meta/custo-trafego?dateStart=2026-10-01&dateEnd=2026-10-31&termos=CSP'
const INSIGHTS = '/api/meta/insights?dateStart=2026-10-01&dateEnd=2026-10-31&projectId=proj_1'

test('custo-trafego: tudo ok devolve o total das 5 contas, sem incompleto', async () => {
  const j = await (await custoTrafego(pedido(CUSTO))).json()
  assert.equal(j.total, 30000)
  assert.equal(j.incompleto, undefined)
  assert.equal(j.erro, undefined)
})

test('custo-trafego: uma conta falhando devolve total 0, erro e incompleto (nada parcial)', async () => {
  contaQueFalha = 'C'
  const j = await (await custoTrafego(pedido(CUSTO))).json()
  assert.deepEqual(j, { total: 0, campanhas: [], erro: ERRO_TRAFEGO_INCOMPLETO, incompleto: true })
})

test('custo-trafego: sem token marca incompleto', async () => {
  delete process.env.META_ACCESS_TOKEN
  const j = await (await custoTrafego(pedido(CUSTO))).json()
  assert.equal(j.incompleto, true)
  assert.equal(j.total, 0)
})

test('insights: tudo ok sem incompleto e sem aviso', async () => {
  const j = await (await insights(pedido(INSIGHTS))).json()
  assert.equal(j.total, 30000)
  assert.deepEqual(j.campanhas.map((c: { accountId: string }) => c.accountId), ['A', 'B', 'C', 'D', 'E'])
  assert.equal(j.incompleto, undefined)
  assert.equal(j.aviso, undefined)
})

test('insights: uma conta falhando mantem o parcial e marca incompleto com o aviso do DRE', async () => {
  const ok = await (await insights(pedido(INSIGHTS))).json()
  contaQueFalha = 'C'
  const j = await (await insights(pedido(INSIGHTS))).json()
  assert.equal(j.incompleto, true)
  assert.equal(j.aviso, AVISO_DRE_META_INCOMPLETA)
  assert.equal(ok.total, 30000)
  assert.equal(j.total, 22000, 'o parcial das 4 contas que responderam continua visivel')
  assert.deepEqual(j.campanhas.map((c: { accountId: string }) => c.accountId), ['A', 'B', 'D', 'E'])
})

test('insights: sem token marca incompleto com o aviso', async () => {
  delete process.env.META_ACCESS_TOKEN
  const j = await (await insights(pedido(INSIGHTS))).json()
  assert.equal(j.incompleto, true)
  assert.equal(j.aviso, AVISO_DRE_META_INCOMPLETA)
})
