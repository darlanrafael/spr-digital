import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  liquidoDoPacote, brutoDoPacote, filhasDoPacote, saleIdsComAsFilhas,
  type VendaComValor,
} from './dinheiro-do-pacote'
import { calcularComissao, calcularReembolso } from './terapeutas-auth'

// Casos reais, medidos no banco em 03/09/2026.
const AMANDA_PAI: VendaComValor = { id: 'pai', status: 'aprovada', valor_pago_cliente: 2680, valor_liquido: 2584.98 }
const AMANDA_FILHA: VendaComValor = { id: 'filha', status: 'aprovada', valor_pago_cliente: 2600, valor_liquido: 2507.77, pacote_pai_id: 'pai' }
// Fabio Nery: duas compras de R$ 700 do mesmo pacote de 4 sessoes com a Denise (30%).
const NERY_PAI: VendaComValor = { id: 'nery1', status: 'aprovada', valor_pago_cliente: 700, valor_liquido: 680.29 }
const NERY_FILHA: VendaComValor = { id: 'nery2', status: 'aprovada', valor_pago_cliente: 700, valor_liquido: 674.08, pacote_pai_id: 'nery1' }

test('a comissao sai do liquido do PACOTE, nao so da venda-pai', () => {
  // As sessoes ficam todas na venda-pai e a filha fica com zero: se a base fosse
  // so a do pai, o dinheiro da segunda compra nao geraria comissao em lugar
  // nenhum. A Denise receberia R$ 177,86 no lugar de R$ 354,10 pelas mesmas 4
  // sessoes.
  const base = liquidoDoPacote(NERY_PAI, [NERY_FILHA])
  assert.equal(base.toFixed(2), '1354.37')
  const comPacote = calcularComissao({ valor_liquido: base, percentual: 30, numero_sessoes: 4 })
  const soOPai = calcularComissao({ valor_liquido: NERY_PAI.valor_liquido!, percentual: 30, numero_sessoes: 4 })
  assert.equal(comPacote.comissao_total.toFixed(2), '354.10')
  assert.equal(soOPai.comissao_total.toFixed(2), '177.86')
})

test('a venda-pai nao entra duas vezes na propria soma', () => {
  // `.eq('id', sale_id)` no lugar de `.eq('pacote_pai_id', sale_id)` devolve a
  // propria venda-pai dentro da lista de filhas: comissao e reembolso em dobro,
  // sem erro nenhum em tela nenhuma.
  assert.equal(liquidoDoPacote(NERY_PAI, [NERY_PAI, NERY_FILHA]).toFixed(2), '1354.37')
  assert.deepEqual(filhasDoPacote(NERY_PAI, [NERY_PAI]).map(v => v.id), [])
  const aponta_para_si = { ...NERY_PAI, pacote_pai_id: NERY_PAI.id }
  assert.equal(liquidoDoPacote(aponta_para_si, [aponta_para_si]), 680.29)
})

test('filha de OUTRO pacote nao soma neste', () => {
  const deOutro: VendaComValor = { id: 'x', status: 'aprovada', valor_liquido: 999, pacote_pai_id: 'outro' }
  assert.equal(liquidoDoPacote(NERY_PAI, [deOutro]), NERY_PAI.valor_liquido)
})

test('filha estornada nao soma - o dinheiro voltou para o cliente', () => {
  // A consulta que alimentava a comissao nao filtrava status nenhum: com a
  // Denise dava R$ 332,87 por sessao no lugar de R$ 168,96.
  for (const status of ['reembolsada', 'chargeback', 'cancelada', 'em_protesto']) {
    const filha = { ...NERY_FILHA, status }
    assert.equal(liquidoDoPacote(NERY_PAI, [filha]), NERY_PAI.valor_liquido, `status ${status}`)
    assert.equal(brutoDoPacote(NERY_PAI, [filha]), NERY_PAI.valor_pago_cliente, `status ${status}`)
  }
})

test('venda sem filha nenhuma continua valendo o que sempre valeu', () => {
  assert.equal(liquidoDoPacote(NERY_PAI, []), 680.29)
  assert.equal(brutoDoPacote(NERY_PAI, []), 700)
})

test('o reembolso da Amanda: R$ 3.980 de direito, R$ 1.380 com so o pai', () => {
  // 8 sessoes no pacote, 1 entregue, tabela do Pedro: o plano equivalente de 1
  // sessao custa R$ 1.300. O total de sessoes ja conta o pacote inteiro, entao
  // usar o valor de uma compra so devolve menos do que o paciente pagou.
  const pago = brutoDoPacote(AMANDA_PAI, [AMANDA_FILHA])
  assert.equal(pago, 5280)
  const certo = calcularReembolso({ terapeuta_nome: 'Pedro Roncada', sessoes_total: 8, sessoes_feitas: 1, valor_pago: pago })
  const errado = calcularReembolso({ terapeuta_nome: 'Pedro Roncada', sessoes_total: 8, sessoes_feitas: 1, valor_pago: AMANDA_PAI.valor_pago_cliente! })
  assert.equal(certo.valor_reembolso, 3980)
  assert.equal(errado.valor_reembolso, 1380)
})

test('a filha entra no faturamento do paciente mesmo sem ter sessao nenhuma', () => {
  const vendas = [AMANDA_PAI, AMANDA_FILHA]
  const ids = saleIdsComAsFilhas(['pai'], vendas)
  assert.deepEqual(ids.sort(), ['filha', 'pai'])
  const bruto = ids.map(id => vendas.find(v => v.id === id)!).reduce((a, v) => a + (v.valor_pago_cliente ?? 0), 0)
  assert.equal(bruto, 5280)
})

test('saleIdsComAsFilhas nao inventa venda: sem filha, devolve o que entrou', () => {
  assert.deepEqual(saleIdsComAsFilhas(['a', 'b'], [{ id: 'a' }, { id: 'b' }, { id: 'c', pacote_pai_id: 'z' }]), ['a', 'b'])
})

test('a filha estornada CONTINUA visivel no prontuario, mesmo sem somar dinheiro', () => {
  // Sumir com a linha esconderia do terapeuta que houve uma segunda compra.
  // Quem decide se ela vale dinheiro e filhasDoPacote, nao esta lista.
  const filhaEstornada = { ...AMANDA_FILHA, status: 'reembolsada' }
  assert.ok(saleIdsComAsFilhas(['pai'], [AMANDA_PAI, filhaEstornada]).includes('filha'))
  assert.equal(brutoDoPacote(AMANDA_PAI, [filhaEstornada]), 2680)
})
