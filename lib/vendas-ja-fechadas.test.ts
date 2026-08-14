import { test } from 'node:test'
import assert from 'node:assert/strict'
import { separarJaFechadas } from './vendas-ja-fechadas'
import type { Closing, Sale } from '@/types'

// Fechamento real: confirmado 06/07 às 21:36 BRT (00:36 UTC do dia 07).
// Imersão fechou numa janela própria (12/05-22/06); O RESGATE no principal.
const ANTERIOR = {
  id: 'close_1', data: '2026-07-07',
  data_confirmacao: '2026-07-07T00:36:23.964+00:00',
  periodo: { inicio: '2026-06-01', fim: '2026-07-06' },
  produtos_incluidos: ['O RESGATE', 'Imersão - A reaproximação'],
  produtos_periodos: [{ inicio: '2026-05-12', fim: '2026-06-22', produtos: ['Imersão - A reaproximação'] }],
  alertas: [],
} as unknown as Closing

const venda = (o: Partial<Sale>): Sale => ({
  id: 'v', nome: 'x', email: '', telefone: '', produto: 'O RESGATE', plataforma: 'hubla',
  preco_base: 697, valor_pago_cliente: 697, valor_liquido: 671, data_hora: '2026-07-06T12:00:00',
  utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
  status: 'aprovada', projetoId: 'proj_1', ...o,
} as Sale)

test('venda já contada num fechamento confirmado é separada', () => {
  // Antônio Belone: 06/07 às 18:16 BRT, antes da confirmação das 21:36.
  const r = separarJaFechadas([venda({ id: 'belone', data_hora: '2026-07-06T21:16:44' })], [ANTERIOR])
  assert.equal(r.jaFechadas.length, 1)
  assert.equal(r.novas.length, 0)
  assert.equal(r.jaFechadas[0].fechamentoId, 'close_1')
})

test('O CASO CENTRAL: venda do mesmo dia, feita DEPOIS da confirmação, entra normalmente', () => {
  // 07/07 01:00 UTC = 06/07 22:00 BRT — meia hora depois do fechamento.
  const r = separarJaFechadas([venda({ id: 'tardia', data_hora: '2026-07-07T01:00:00' })], [ANTERIOR])
  assert.equal(r.novas.length, 1)
  assert.equal(r.jaFechadas.length, 0)
})

test('respeita a janela própria do produto no fechamento anterior', () => {
  // Imersão fechou até 22/06 lá; uma venda de 24/06 nunca entrou naquele fechamento.
  const r = separarJaFechadas(
    [venda({ produto: 'Imersão - A reaproximação', data_hora: '2026-06-24T10:00:00' })],
    [ANTERIOR],
  )
  assert.equal(r.novas.length, 1)
})

test('produto que não estava no fechamento anterior não é afetado', () => {
  const r = separarJaFechadas([venda({ produto: 'Como convencer seu cônjuge' })], [ANTERIOR])
  assert.equal(r.novas.length, 1)
})

test('venda fora da janela do fechamento anterior não é afetada', () => {
  const r = separarJaFechadas([venda({ data_hora: '2026-05-20T10:00:00' })], [ANTERIOR])
  assert.equal(r.novas.length, 1)
})

test('sem fechamentos anteriores, tudo é venda nova', () => {
  const r = separarJaFechadas([venda({}), venda({ id: 'b' })], [])
  assert.equal(r.novas.length, 2)
})

test('fechamento sem data_confirmacao é ignorado', () => {
  const rascunho = { ...ANTERIOR, data_confirmacao: undefined } as unknown as Closing
  const r = separarJaFechadas([venda({})], [rascunho])
  assert.equal(r.novas.length, 1)
})

test('cenário do usuário: fechar de 06/07 a 14/08 não repete nada e não perde as tardias', () => {
  const r = separarJaFechadas([
    venda({ id: 'belone',  data_hora: '2026-07-06T21:16:44' }), // já fechada
    venda({ id: 'marcos',  data_hora: '2026-07-06T02:23:51' }), // já fechada
    venda({ id: 'tardia',  data_hora: '2026-07-07T01:30:00' }), // depois da confirmação
    venda({ id: 'depois',  data_hora: '2026-07-20T10:00:00' }), // fora do fechamento antigo
  ], [ANTERIOR])
  assert.deepEqual(r.jaFechadas.map(x => x.id).sort(), ['belone', 'marcos'])
  assert.deepEqual(r.novas.map(x => x.id).sort(), ['depois', 'tardia'])
})
