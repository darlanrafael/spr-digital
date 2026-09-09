import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoDeDuplicata, type VendaExistente } from './lancamento-manual-duplicata'

const PRODUTO = 'Mentoria Particular - Pedro Roncada'
const venda = (o: Partial<VendaExistente> = {}): VendaExistente => ({
  id: 'v1', produto: PRODUTO, valor_pago_cliente: 1550,
  data_hora: '2026-08-03T12:55:00Z', status: 'aprovada', sessoes: 2, ...o,
})

test('paciente sem nada no sistema nao gera aviso', () => {
  const r = avisoDeDuplicata({ produto: PRODUTO, vendasDoPaciente: [] })
  assert.equal(r.texto, null)
})

test('CASO REAL DA JOICY: venda do mesmo produto com sessoes agendadas', () => {
  // 04/08/2026: ela tinha uma venda de R$ 1.550 comprada no dia anterior, com
  // 2 sessoes ja agendadas. O comercial lancou um manual igual e o sistema nao
  // disse nada.
  const r = avisoDeDuplicata({ produto: PRODUTO, vendasDoPaciente: [venda()] })
  assert.match(r.texto!, /já tem uma venda deste mesmo produto/)
  assert.match(r.texto!, /03\/08/)
  assert.match(r.texto!, /2 sessões/)
  assert.equal(r.mesmoProduto.length, 1)
})

test('venda do mesmo produto SEM sessao tambem avisa, e diz isso', () => {
  const r = avisoDeDuplicata({ produto: PRODUTO, vendasDoPaciente: [venda({ sessoes: 0 })] })
  assert.match(r.texto!, /sem sessão agendada/)
})

test('duas vendas do mesmo produto sao contadas', () => {
  const r = avisoDeDuplicata({
    produto: PRODUTO,
    vendasDoPaciente: [venda({ id: 'a' }), venda({ id: 'b', data_hora: '2026-08-11T12:58:00Z' })],
  })
  assert.match(r.texto!, /já tem 2 vendas deste mesmo produto/)
  assert.equal(r.mesmoProduto.length, 2)
})

test('venda ESTORNADA nao e duplicata: e historico', () => {
  for (const status of ['reembolsada', 'chargeback', 'cancelada', 'em_protesto']) {
    const r = avisoDeDuplicata({ produto: PRODUTO, vendasDoPaciente: [venda({ status })] })
    assert.equal(r.texto, null, status)
  }
})

test('produto diferente avisa mais fraco, sem alarme', () => {
  const r = avisoDeDuplicata({
    produto: PRODUTO,
    vendasDoPaciente: [venda({ produto: 'O RESGATE', valor_pago_cliente: 497, sessoes: 0 })],
  })
  assert.match(r.texto!, /de outro produto/)
  assert.match(r.texto!, /Não é impedimento/)
  assert.equal(r.mesmoProduto.length, 0)
  assert.equal(r.outras.length, 1)
})

test('o mesmo produto MANDA, mesmo havendo outros', () => {
  const r = avisoDeDuplicata({
    produto: PRODUTO,
    vendasDoPaciente: [venda(), venda({ id: 'x', produto: 'O RESGATE', sessoes: 0 })],
  })
  assert.match(r.texto!, /mesmo produto/)
})

test('o nome do produto e comparado sem depender de espaco ou caixa', () => {
  const r = avisoDeDuplicata({
    produto: '  mentoria particular - PEDRO RONCADA ',
    vendasDoPaciente: [venda()],
  })
  assert.equal(r.mesmoProduto.length, 1)
})
