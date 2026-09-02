import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularAlertasPendentes } from './alertas-reembolso'
import type { Closing, ClosingBuyer, Sale } from '@/types'

// Um fechamento guarda em `compradores` a lista exata das vendas que somaram
// faturamento nele. É o sinal autoritativo de "esta venda foi repassada".
const comprador = (id: string): ClosingBuyer =>
  ({ id, nome: 'x', email: '', cpf: '', produto: 'p', valor: 0, status: 'ok' }) as ClosingBuyer

const fechamento = (id: string, vendaIds: string[], alertas: unknown[] = []) =>
  ({
    id, data: '2026-07-07', data_confirmacao: '2026-07-07T00:36:23.964+00:00',
    periodo: { inicio: '2026-06-01', fim: '2026-07-06' },
    compradores: vendaIds.map(comprador), alertas,
  }) as unknown as Closing

const venda = (o: Partial<Sale>): Sale => ({
  id: 'v1', nome: 'Fulano', email: 'f@x.com', telefone: '', produto: 'O RESGATE',
  plataforma: 'hubla', preco_base: 697, valor_pago_cliente: 697, valor_liquido: 671.18,
  data_hora: '2026-06-24T12:00:00', utm_source: '', utm_medium: '', utm_campaign: '',
  utm_content: '', utm_term: '', status: 'aprovada', projetoId: 'proj_1', ...o,
} as Sale)

test('venda que foi repassada e depois estornada vira alerta', () => {
  const a = calcularAlertasPendentes({
    closings: [fechamento('c1', ['v1'])],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].saleId, 'v1')
  assert.equal(a[0].valor, 671.18)
  assert.equal(a[0].tipo, 'reembolso')
})

test('venda que segue aprovada não vira alerta', () => {
  const a = calcularAlertasPendentes({ closings: [fechamento('c1', ['v1'])], sales: [venda({})] })
  assert.equal(a.length, 0)
})

test('O BUG DE 14/08: venda cancelada que NUNCA entrou em fechamento não vira alerta', () => {
  // Maria de Fátima e Daiani foram canceladas por não terem respaldo na
  // plataforma. Nenhuma das duas tinha entrado em fechamento, então não há
  // repasse a devolver. A regra antiga olhava janela + data e as acusava.
  const a = calcularAlertasPendentes({
    closings: [fechamento('c1', ['outra-venda'])],
    sales: [venda({ id: 'fantasma', status: 'cancelada', data_reembolso: undefined })],
  })
  assert.equal(a.length, 0)
})

test('cancelamento não é reembolso: mesmo tendo sido repassada, não entra como estorno', () => {
  // Venda cancelada é correção de faturamento (a venda nunca existiu), não
  // devolução ao cliente. O painel fala em "reembolso ou chargeback"; misturar
  // cancelamento ali seria mentira. Caso separado, ainda sem tratamento.
  const a = calcularAlertasPendentes({
    closings: [fechamento('c1', ['v1'])],
    sales: [venda({ status: 'cancelada' })],
  })
  assert.equal(a.length, 0)
})

test('chargeback de venda repassada vira alerta com o tipo certo', () => {
  const a = calcularAlertasPendentes({
    closings: [fechamento('c1', ['v1'])],
    sales: [venda({ status: 'chargeback', data_reembolso: '2026-08-01' })],
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].tipo, 'chargeback')
})

test('alerta já deduzido num fechamento anterior não repete', () => {
  // O caso que o usuário encontrou: os 3 estornos deduzidos no fechamento de
  // 14/08 reaparecendo no fechamento seguinte.
  const a = calcularAlertasPendentes({
    closings: [
      fechamento('c1', ['v1']),
      fechamento('c2', [], [{ saleId: 'v1', nome: 'Fulano', produto: 'O RESGATE', valor: 671.18, data: '2026-08-12' }]),
    ],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 0)
})

test('venda que nunca entrou em fechamento nenhum não vira alerta', () => {
  const a = calcularAlertasPendentes({
    closings: [fechamento('c1', ['outra'])],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 0)
})

test('a mesma venda repassada em dois fechamentos aparece uma vez só', () => {
  const a = calcularAlertasPendentes({
    closings: [fechamento('c1', ['v1']), fechamento('c2', ['v1'])],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 1)
})

test('fechamento sem lista de compradores não quebra', () => {
  const semLista = { id: 'c0', data: '2026-07-07', periodo: { inicio: '', fim: '' }, alertas: [] } as unknown as Closing
  const a = calcularAlertasPendentes({
    closings: [semLista],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-08-12' })],
  })
  assert.equal(a.length, 0)
})

test('cenário real de 13/08: os três estornos legítimos, ordenados por valor', () => {
  const a = calcularAlertasPendentes({
    closings: [fechamento('c1', ['g', 'r', 'm', 'ok'])],
    sales: [
      venda({ id: 'g', nome: 'Geisane', valor_liquido: 687.99, status: 'reembolsada', data_reembolso: '2026-07-07' }),
      venda({ id: 'r', nome: 'Rodrigo', valor_liquido: 671.18, status: 'reembolsada', data_reembolso: '2026-08-12' }),
      venda({ id: 'm', nome: 'Maria Laura', valor_liquido: 35.42, status: 'reembolsada', data_reembolso: '2026-08-05' }),
      venda({ id: 'ok', nome: 'Cliente ativo' }),
    ],
  })
  assert.equal(a.length, 3)
  assert.deepEqual(a.map(x => x.nome), ['Geisane', 'Rodrigo', 'Maria Laura'])
  assert.equal(a.reduce((s, x) => s + x.valor, 0).toFixed(2), '1394.59')
})

test('prazo de garantia: compra de 13/08 repassada e estornada em 20/08 vira alerta', () => {
  const a = calcularAlertasPendentes({
    closings: [fechamento('c_ago', ['garantia'])],
    sales: [venda({
      id: 'garantia', nome: 'Comprou dia 13', data_hora: '2026-08-13T15:00:00',
      valor_liquido: 671.18, status: 'reembolsada', data_reembolso: '2026-08-20',
    })],
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].data, '2026-08-20')
})

test('deducao de reembolso PARCIAL nao esconde o estorno integral da mesma venda', () => {
  // O parcial guarda o saleId junto do solicitacaoId. Se `jaDeduzidos` olhasse
  // só o saleId, devolver R$ 1.560 de um pacote hoje faria o estorno dos
  // R$ 2.758,70 restantes, se viesse depois, nunca aparecer para dedução.
  const a = calcularAlertasPendentes({
    closings: [
      fechamento('c1', ['v1']),
      fechamento('c2', [], [{ solicitacaoId: 'sol1', saleId: 'v1', nome: 'Miguel', produto: 'x', valor: 1560, data: '2026-09-02' }]),
    ],
    sales: [venda({ status: 'reembolsada', data_reembolso: '2026-09-20' })],
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].saleId, 'v1')
})
