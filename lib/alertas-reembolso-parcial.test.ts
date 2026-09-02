import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularAlertasReembolsoParcial, chaveAlerta, type SolicitacaoReembolso, type VendaDoAlerta } from './alertas-reembolso-parcial'
import type { Closing, ClosingAlert } from '@/types'

const sol = (o: Partial<SolicitacaoReembolso> = {}): SolicitacaoReembolso => ({
  id: 'sol1', sale_id: 'v1', paciente_nome: 'Miguel Pires', paciente_email: 'm@x.com',
  valor_reembolso: 1560, status: 'aprovado',
  created_at: '2026-08-25T17:18:00Z', updated_at: '2026-09-02T14:00:00Z', ...o,
})

const fechamento = (alertas: ClosingAlert[]) =>
  ({ id: 'c1', data: '2026-09-05', periodo: { inicio: '', fim: '' }, alertas }) as unknown as Closing

const produtos = new Map<string, VendaDoAlerta>([['v1', { produto: 'Mentoria Particular - Pedro Roncada', status: 'aprovada' }]])

test('O CASO DO MIGUEL PIRES: reembolso parcial aprovado vira deducao no proximo fechamento', () => {
  // Comprou 4 sessoes por R$ 2.860, fez 1, devolvemos R$ 1.560. A venda NAO e
  // alterada; o que entra no fechamento seguinte e a deducao.
  const a = calcularAlertasReembolsoParcial({ solicitacoes: [sol()], closings: [], vendaPorSaleId: produtos })
  assert.equal(a.length, 1)
  assert.equal(a[0].valor, 1560)
  assert.equal(a[0].tipo, 'reembolso_parcial')
  assert.equal(a[0].solicitacaoId, 'sol1')
  assert.equal(a[0].produto, 'Mentoria Particular - Pedro Roncada')
})

test('pedido pendente ou rejeitado nao deduz nada', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ id: 's1', status: 'pendente' }), sol({ id: 's2', status: 'rejeitado' })],
    closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 0)
})

test('deducao ja abatida num fechamento nao repete', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol()],
    closings: [fechamento([{ solicitacaoId: 'sol1', saleId: 'v1', nome: 'Miguel Pires', produto: 'x', valor: 1560, data: '2026-09-02' }])],
    vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 0)
})

test('parcial abatido NAO esconde estorno total posterior da mesma venda', () => {
  // A chave e a solicitacao, nao a venda: se fosse o saleId, um parcial ja
  // deduzido apagaria o alerta do estorno integral que viesse depois.
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ id: 'sol2', valor_reembolso: 400 })],
    closings: [fechamento([{ solicitacaoId: 'sol1', saleId: 'v1', nome: 'Miguel', produto: 'x', valor: 1560, data: '2026-09-02' }])],
    vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].solicitacaoId, 'sol2')
})

test('alerta antigo, sem solicitacaoId, nao suprime nenhum parcial', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol()],
    closings: [fechamento([{ saleId: 'v1', nome: 'Miguel', produto: 'x', valor: 2758.7, data: '2026-08-30' }])],
    vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 1)
})

test('valor zero ou negativo nao vira deducao', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ id: 'z', valor_reembolso: 0 }), sol({ id: 'n', valor_reembolso: -10 })],
    closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 0)
})

test('a data e a da aprovacao, nao a da abertura do pedido', () => {
  const a = calcularAlertasReembolsoParcial({ solicitacoes: [sol()], closings: [], vendaPorSaleId: produtos })
  assert.equal(a[0].data, '2026-09-02')
})

test('sem updated_at cai na data de criacao', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ updated_at: null })], closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a[0].data, '2026-08-25')
})

test('venda desconhecida nao quebra: usa rotulo generico', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ sale_id: 'sumida' })], closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a[0].produto, 'Reembolso parcial')
})

test('ordena por valor, maior primeiro', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ id: 'a', valor_reembolso: 100 }), sol({ id: 'b', valor_reembolso: 900 })],
    closings: [], vendaPorSaleId: produtos,
  })
  assert.deepEqual(a.map(x => x.valor), [900, 100])
})

test('chaveAlerta: parcial usa a solicitacao, estorno inteiro usa a venda', () => {
  assert.equal(chaveAlerta({ solicitacaoId: 'sol1', saleId: 'v1', nome: '', produto: '', valor: 0, data: '' }), 'sol1')
  assert.equal(chaveAlerta({ saleId: 'v1', nome: '', produto: '', valor: 0, data: '' }), 'v1')
})

test('CRITICO: venda ja reembolsada por inteiro nao gera deducao parcial tambem', () => {
  // Se a venda virou 'reembolsada', o fechamento tira a receita inteira e quem
  // trata a devolucao e o modulo de estorno. Deduzir aqui tambem cobraria dos
  // socios duas vezes pelo mesmo dinheiro - R$ 1.560 + R$ 2.758,70 numa venda
  // que gerou R$ 2.758,70.
  const reembolsada = new Map<string, VendaDoAlerta>([['v1', { produto: 'x', status: 'reembolsada' }]])
  const a = calcularAlertasReembolsoParcial({ solicitacoes: [sol()], closings: [], vendaPorSaleId: reembolsada })
  assert.equal(a.length, 0)
})

test('CRITICO: venda em chargeback tambem nao gera deducao parcial', () => {
  const cb = new Map<string, VendaDoAlerta>([['v1', { produto: 'x', status: 'chargeback' }]])
  const a = calcularAlertasReembolsoParcial({ solicitacoes: [sol()], closings: [], vendaPorSaleId: cb })
  assert.equal(a.length, 0)
})

test('duas aprovacoes cobrindo a MESMA sessao deduzem uma vez so', () => {
  // O par 57bbdc78/ae08b8ac ja existe no banco: mesma venda, mesma sessao,
  // R$ 700 cada. Salvou-se ate hoje so porque as duas foram rejeitadas.
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [
      sol({ id: 'p1', valor_reembolso: 700, sessoes_ids: ['ses1'], updated_at: '2026-09-01T10:00:00Z' }),
      sol({ id: 'p2', valor_reembolso: 700, sessoes_ids: ['ses1'], updated_at: '2026-09-02T10:00:00Z' }),
    ],
    closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].solicitacaoId, 'p1')
  assert.equal(a.reduce((t, x) => t + x.valor, 0), 700)
})

test('aprovacoes de sessoes DIFERENTES da mesma venda somam as duas', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [
      sol({ id: 'p1', valor_reembolso: 700, sessoes_ids: ['ses1'], updated_at: '2026-09-01T10:00:00Z' }),
      sol({ id: 'p2', valor_reembolso: 500, sessoes_ids: ['ses2'], updated_at: '2026-09-02T10:00:00Z' }),
    ],
    closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 2)
  assert.equal(a.reduce((t, x) => t + x.valor, 0), 1200)
})

test('a dedup nao depende da ordem em que o banco devolveu as linhas', () => {
  const invertido = calcularAlertasReembolsoParcial({
    solicitacoes: [
      sol({ id: 'p2', valor_reembolso: 700, sessoes_ids: ['ses1'], updated_at: '2026-09-02T10:00:00Z' }),
      sol({ id: 'p1', valor_reembolso: 700, sessoes_ids: ['ses1'], updated_at: '2026-09-01T10:00:00Z' }),
    ],
    closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(invertido.length, 1)
  assert.equal(invertido[0].solicitacaoId, 'p1')
})

test('aprovacao das 21h30 BRT fica no dia certo, nao no seguinte', () => {
  // 02/09 00:20 UTC e 01/09 21:20 em Brasilia. Cortar a string do timestamptz
  // direto jogava a data para frente.
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ updated_at: '2026-09-02T00:20:31+00:00' })],
    closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a[0].data, '2026-09-01')
})

test('venda fora do mapa continua gerando deducao: o mapa pode nao ter carregado', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol({ sale_id: 'sumida' })], closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].produto, 'Reembolso parcial')
})
