import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularAlertasPendentes } from './alertas-reembolso'
import type { Closing, Sale } from '@/types'

// Fechamento confirmado em 06/07 21:36, cobrindo O RESGATE de 01/06 a 06/07
// e a Imersão numa janela própria (12/05 a 22/06) — a forma real do
// close_1783384583964.
const FECHADO = {
  id: 'close_1',
  data: '2026-07-07',
  data_confirmacao: '2026-07-07T00:36:23.964+00:00',
  periodo: { inicio: '2026-06-01', fim: '2026-07-06' },
  produtos_incluidos: ['O RESGATE', 'IImersão - A Reaproximação - Oficial'],
  produtos_periodos: [
    { inicio: '2026-05-12', fim: '2026-06-22', produtos: ['IImersão - A Reaproximação - Oficial'] },
  ],
  alertas: [],
} as unknown as Closing

const venda = (over: Partial<Sale>): Sale => ({
  id: 'v1', nome: 'Fulano', email: 'f@x.com', telefone: '', produto: 'O RESGATE',
  plataforma: 'hubla', preco_base: 697, valor_pago_cliente: 697, valor_liquido: 671.18,
  data_hora: '2026-06-24T12:00:00', utm_source: '', utm_medium: '', utm_campaign: '',
  utm_content: '', utm_term: '', status: 'aprovada', projetoId: 'proj_1', ...over,
} as Sale)

test('venda estornada DEPOIS da confirmação vira alerta', () => {
  const a = calcularAlertasPendentes({
    closings: [FECHADO],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].valor, 671.18)
  assert.equal(a[0].tipo, 'reembolso')
})

test('venda estornada ANTES da confirmação não vira alerta — nunca entrou no fechamento', () => {
  const a = calcularAlertasPendentes({
    closings: [FECHADO],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-06-30' })],
  })
  assert.equal(a.length, 0)
})

test('venda que segue aprovada não vira alerta', () => {
  const a = calcularAlertasPendentes({ closings: [FECHADO], sales: [venda({})] })
  assert.equal(a.length, 0)
})

test('chargeback vira alerta com o tipo certo', () => {
  const a = calcularAlertasPendentes({
    closings: [FECHADO],
    sales: [venda({ status: 'chargeback', data_reembolso: '2026-08-01' })],
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].tipo, 'chargeback')
})

test('alerta já deduzido num fechamento anterior não repete', () => {
  const jaDeduzido = {
    ...FECHADO, id: 'close_2', data_confirmacao: '2026-08-01T00:00:00+00:00',
    alertas: [{ saleId: 'v1', nome: 'Fulano', produto: 'O RESGATE', valor: 671.18, data: '2026-07-20' }],
  } as unknown as Closing
  const a = calcularAlertasPendentes({
    closings: [FECHADO, jaDeduzido],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-07-20' })],
  })
  assert.equal(a.length, 0)
})

test('respeita a janela própria do produto (produtos_periodos)', () => {
  // Imersão fechou 12/05-22/06 naquele fechamento; uma venda de 24/06 não entrou nele.
  const a = calcularAlertasPendentes({
    closings: [FECHADO],
    sales: [venda({
      produto: 'IImersão - A Reaproximação - Oficial', data_hora: '2026-06-24T10:00:00',
      status: 'reembolsada', data_reembolso: '2026-08-05', valor_liquido: 35.42,
    })],
  })
  assert.equal(a.length, 0)
})

test('produto fora do fechamento não vira alerta', () => {
  const a = calcularAlertasPendentes({
    closings: [FECHADO],
    sales: [venda({ produto: 'Mentoria em grupo', status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 0)
})

test('venda posterior à confirmação não entrou no fechamento, mesmo dentro do período', () => {
  // Caso real do close_1783445699441: período até 07/07, confirmado 07/07 às 14:34.
  // Uma venda das 20:00 do dia 07/07 está no período mas não existia na confirmação.
  const tardio = {
    ...FECHADO, id: 'close_tardio',
    periodo: { inicio: '2026-06-01', fim: '2026-07-07' },
    data_confirmacao: '2026-07-07T14:34:59.000+00:00',
    produtos_periodos: undefined,
  } as unknown as Closing
  const a = calcularAlertasPendentes({
    closings: [tardio],
    sales: [venda({ data_hora: '2026-07-07T20:00:00', status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 0)
})

test('a mesma venda em dois fechamentos aparece uma vez só', () => {
  const outro = { ...FECHADO, id: 'close_3', alertas: [] } as unknown as Closing
  const a = calcularAlertasPendentes({
    closings: [FECHADO, outro],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 1)
})

test('fechamento sem data_confirmacao é ignorado', () => {
  const semData = { ...FECHADO, data_confirmacao: undefined } as unknown as Closing
  const a = calcularAlertasPendentes({
    closings: [semData],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 0)
})

test('prazo de garantia: venda fechada dentro dos 7 dias e estornada depois vira alerta no fechamento seguinte', () => {
  // A regra do negócio: por lei o cliente tem 7 dias para pedir reembolso.
  // Todo fechamento entra com vendas ainda dentro desse prazo, e os sócios já
  // retiram sobre elas. Quem compra 13/08 pode estornar até 20/08 — depois do
  // fechamento já confirmado e do dinheiro já repassado.
  const fechadoEm14 = {
    id: 'close_ago',
    data: '2026-08-14',
    data_confirmacao: '2026-08-14T02:00:00.000+00:00', // 13/08 23:00 BRT
    periodo: { inicio: '2026-08-01', fim: '2026-08-13' },
    produtos_incluidos: ['O RESGATE'],
    alertas: [],
  } as unknown as Closing

  const compraDia13 = venda({
    id: 'garantia',
    nome: 'Comprou dia 13',
    data_hora: '2026-08-13T15:00:00',
    valor_liquido: 671.18,
    status: 'reembolsada',
    data_reembolso: '2026-08-20', // dentro dos 7 dias, mas depois do fechamento
  })

  const a = calcularAlertasPendentes({ closings: [fechadoEm14], sales: [compraDia13] })

  assert.equal(a.length, 1)
  assert.equal(a[0].saleId, 'garantia')
  assert.equal(a[0].valor, 671.18)
  assert.equal(a[0].data, '2026-08-20')
})

test('prazo de garantia: quem compra 10/08 e estorna 17/08 também é pego', () => {
  const fechadoEm14 = {
    id: 'close_ago', data: '2026-08-14',
    data_confirmacao: '2026-08-14T02:00:00.000+00:00',
    periodo: { inicio: '2026-08-01', fim: '2026-08-13' },
    produtos_incluidos: ['O RESGATE'], alertas: [],
  } as unknown as Closing
  const a = calcularAlertasPendentes({
    closings: [fechadoEm14],
    sales: [venda({ id: 'g2', data_hora: '2026-08-10T09:00:00', status: 'reembolsada', data_reembolso: '2026-08-17' })],
  })
  assert.equal(a.length, 1)
})

test('cenário real de 13/08: três estornos legítimos viram alerta', () => {
  const a = calcularAlertasPendentes({
    closings: [FECHADO],
    sales: [
      venda({ id: 'g', nome: 'Geisane', data_hora: '2026-06-24T09:00:00', valor_liquido: 687.99, status: 'reembolsada', data_reembolso: '2026-07-07' }),
      venda({ id: 'r', nome: 'Rodrigo', data_hora: '2026-06-24T10:00:00', valor_liquido: 671.18, status: 'reembolsada', data_reembolso: '2026-08-12' }),
      venda({ id: 'm', nome: 'Maria Laura', produto: 'IImersão - A Reaproximação - Oficial', data_hora: '2026-06-04T10:00:00', valor_liquido: 35.42, status: 'reembolsada', data_reembolso: '2026-08-05' }),
      venda({ id: 'ok', nome: 'Cliente ativo', data_hora: '2026-06-10T10:00:00' }),
    ],
  })
  assert.equal(a.length, 3)
  assert.equal(a.reduce((s, x) => s + x.valor, 0).toFixed(2), '1394.59')
})
