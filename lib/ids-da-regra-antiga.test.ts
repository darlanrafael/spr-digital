import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarIdsDaRegraAntiga, buscarVendasJaFechadas, addClosing } from './services'
import type { Closing } from '@/types'

// Lista das vendas da regra antiga (dono 13/11/2026): vem de TODOS os
// fechamentos, em ordem fixa, e falha alto (nunca vira lista vazia calada).
// Cliente falso: nada vai ao banco.

type Chamada = { metodo: string; args: unknown[] }

function clienteFalso(paginas: { data?: unknown[]; error?: { message: string } }[]) {
  const chamadas: Chamada[] = []
  let pagina = 0
  const consulta: Record<string, (...a: unknown[]) => unknown> = {}
  consulta.select = (...a) => { chamadas.push({ metodo: 'select', args: a }); return consulta }
  consulta.order = (...a) => { chamadas.push({ metodo: 'order', args: a }); return consulta }
  consulta.eq = (...a) => { chamadas.push({ metodo: 'eq', args: a }); return consulta }
  consulta.range = async (...a) => { chamadas.push({ metodo: 'range', args: a }); return paginas[pagina++] ?? { data: [] } }
  return { client: { from: (t: string) => { chamadas.push({ metodo: 'from', args: [t] }); return consulta } }, chamadas }
}

const linha = (i: number, marcado = false) => ({
  id: `close_${i}`,
  by_product: marcado ? [{ regraImposto: 'nova-2026-11' }] : [{}],
  compradores: [{ id: `venda_${i}` }],
})

test('le todas as paginas, em ordem por id, sem filtro de projeto, e tira os fechamentos marcados', async () => {
  const p1 = Array.from({ length: 1000 }, (_, i) => linha(i))
  const p2 = [linha(1000), linha(1001, true), { id: 'close_x', by_product: null, compradores: null }]
  const { client, chamadas } = clienteFalso([{ data: p1 }, { data: p2 }])
  const ids = await buscarIdsDaRegraAntiga(client as never)
  assert.equal(ids.size, 1001)
  assert.ok(ids.has('venda_0') && ids.has('venda_1000'))
  assert.ok(!ids.has('venda_1001'))
  assert.deepEqual(chamadas.find(c => c.metodo === 'from')?.args, ['closings'])
  assert.deepEqual(chamadas.find(c => c.metodo === 'select')?.args, ['id,by_product,compradores'])
  const ordem = chamadas.filter(c => c.metodo === 'order' || c.metodo === 'range').map(c => c.metodo)
  assert.deepEqual(ordem, ['order', 'range', 'order', 'range', 'order', 'range'])
  assert.deepEqual(chamadas.find(c => c.metodo === 'order')?.args, ['id', { ascending: true }])
  // continua ate vir pagina vazia (nao para so porque veio menos de 1000)
  assert.deepEqual(chamadas.filter(c => c.metodo === 'range').map(c => c.args), [[0, 999], [1000, 1999], [1003, 2002]])
  assert.ok(!chamadas.some(c => c.metodo === 'eq'))
})

test('sem cliente do banco: falha com a mensagem', async () => {
  await assert.rejects(() => buscarIdsDaRegraAntiga(null), { message: 'Banco indisponível para ler os fechamentos.' })
})

test('erro da consulta: falha', async () => {
  const { client } = clienteFalso([{ error: { message: 'boom' } }])
  await assert.rejects(() => buscarIdsDaRegraAntiga(client as never))
})

test('erro na segunda pagina: falha (nunca devolve so a primeira)', async () => {
  const p1 = Array.from({ length: 1000 }, (_, i) => linha(i))
  const { client } = clienteFalso([{ data: p1 }, { error: { message: 'caiu' } }])
  await assert.rejects(() => buscarIdsDaRegraAntiga(client as never), { message: 'caiu' })
})

test('addClosing: erro do banco ao gravar falha', async () => {
  const client = { from: () => ({ upsert: async () => ({ error: new Error('upsert falhou') }) }) }
  await assert.rejects(() => addClosing({ periodo: {} } as Closing, 'proj_1', client as never), { message: 'upsert falhou' })
})

test('addClosing grava by_product inteiro, com o carimbo e a aliquota efetiva', async () => {
  let payload: Record<string, unknown> | null = null
  const client = { from: () => ({ upsert: async (p: Record<string, unknown>) => { payload = p; return { error: null } } }) }
  const fechamento = {
    id: 'close_1', data: '2026-11-13', periodo: { inicio: '2026-11-01', fim: '2026-11-13' },
    faturamentoBruto: 0, impostos: 0, taxasPlataforma: 0, faturamentoLiquido: 0, custosTotais: 0, lucroBruto: 0,
    reservaCaixa: 0, lucroReal: 0, socios: [], compradores: [], alertas: [],
    byProduct: [
      { nome: 'X', plataforma: 'hubla', qtd: 1, bruto: 100, taxas: 0, aliquota: 10.78, imposto: 1, liquido: 99, regraImposto: 'nova-2026-11', aliquotaEfetiva: true },
      { nome: 'Y', plataforma: 'kiwify', qtd: 2, bruto: 50, taxas: 2, aliquota: 3.8, imposto: 1.9, liquido: 48, regraImposto: 'nova-2026-11' },
    ],
  } as unknown as Closing
  await addClosing(fechamento, 'proj_1', client as never)
  const bp = (payload as unknown as { by_product: unknown[] }).by_product
  assert.deepEqual(bp, (fechamento as unknown as { byProduct: unknown[] }).byProduct)
})

test('addClosing sem cliente do banco: falha com a mensagem (antes voltava calado)', async () => {
  await assert.rejects(() => addClosing({} as Closing, 'proj_1', null), { message: 'Banco indisponível para gravar o fechamento.' })
})

test('banco devolve menos de 1000 por pagina (limite menor): continua lendo ate vir vazio', async () => {
  const { client } = clienteFalso([{ data: [linha(1), linha(2)] }, { data: [linha(3)] }, { data: [] }])
  const ids = await buscarIdsDaRegraAntiga(client as never)
  assert.deepEqual([...ids].sort(), ['venda_1', 'venda_2', 'venda_3'])
})

test('nenhum fechamento no banco: falha (em producao vazio so pode ser erro)', async () => {
  const { client } = clienteFalso([{ data: [] }])
  await assert.rejects(() => buscarIdsDaRegraAntiga(client as never), { message: 'Nenhum fechamento encontrado no banco. Recarregue a página.' })
})

test('buscarVendasJaFechadas: separa as da regra antiga e devolve todas as ja fechadas (qualquer regra)', async () => {
  const { client } = clienteFalso([{ data: [linha(1), linha(2, true)] }, { data: [] }])
  const r = await buscarVendasJaFechadas(client as never)
  assert.deepEqual([...r.regraAntiga], ['venda_1'])
  assert.deepEqual([...r.todas].sort(), ['venda_1', 'venda_2'])
})
