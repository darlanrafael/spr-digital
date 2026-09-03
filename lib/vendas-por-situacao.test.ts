import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classificarVendas, ehPendenteDeAgendamento, ehVendaFilha,
  COLUNAS_DA_TELA_DE_VENDAS, COLUNAS_DO_DASHBOARD,
} from './vendas-por-situacao'

type V = { id: string; produto: string; status?: string | null; pacote_pai_id?: string | null }
const MENTORIA = 'Mentoria Particular - Pedro Roncada'

const classificar = (vendas: V[], comSessao: string[] = []) =>
  classificarVendas({
    vendas,
    aprovada: v => !v.status || v.status === 'aprovada',
    temSessao: v => comSessao.includes(v.id),
  })

test('venda ligada a outro pacote SAI de Pendentes de Agendamento', () => {
  // Sem isto, a segunda compra de um pacote pago em duas vezes fica presa em
  // Pendentes para sempre: as sessões estão na venda irmã, e a regra de pendente
  // é "venda sem nenhuma sessão".
  const r = classificar([{ id: 'filha', produto: MENTORIA, pacote_pai_id: 'pai' }])
  assert.deepEqual(r.pendentes.map(v => v.id), [])
})

test('e ENTRA na lista de filhas, que é de onde a tela soma o pacote', () => {
  const r = classificar([{ id: 'filha', produto: MENTORIA, pacote_pai_id: 'pai' }])
  assert.deepEqual(r.filhas.map(v => v.id), ['filha'])
})

test('venda comum sem sessão continua pendente', () => {
  const r = classificar([{ id: 'a', produto: MENTORIA }])
  assert.deepEqual(r.pendentes.map(v => v.id), ['a'])
  assert.deepEqual(r.filhas, [])
})

test('Mentoria em Grupo não é agendamento individual', () => {
  const r = classificar([{ id: 'g', produto: 'Mentoria em Grupo - Pedro' }])
  assert.deepEqual(r.pendentes, [])
})

test('venda com sessão vai para Ativos, não para Pendentes', () => {
  const r = classificar([{ id: 'a', produto: MENTORIA }], ['a'])
  assert.deepEqual(r.pendentes, [])
  assert.deepEqual(r.ativos.map(v => v.id), ['a'])
})

test('reembolso sai das aprovadas', () => {
  const r = classificar([{ id: 'r', produto: MENTORIA, status: 'reembolsada' }])
  assert.deepEqual(r.aprovadas, [])
  assert.deepEqual(r.reembolsos.map(v => v.id), ['r'])
})

test('o corte de vendas_a_partir_de tira de Pendentes', () => {
  const antiga = { id: 'velha', produto: MENTORIA }
  assert.equal(ehPendenteDeAgendamento(antiga, { temSessao: () => false, aposCorte: () => false }), false)
  assert.equal(ehPendenteDeAgendamento(antiga, { temSessao: () => false, aposCorte: () => true }), true)
})

test('ehVendaFilha é a mesma pergunta nos três lugares que a fazem', () => {
  assert.equal(ehVendaFilha({ id: 'a', produto: MENTORIA, pacote_pai_id: 'pai' }), true)
  assert.equal(ehVendaFilha({ id: 'a', produto: MENTORIA, pacote_pai_id: null }), false)
  assert.equal(ehVendaFilha({ id: 'a', produto: MENTORIA }), false)
})

test('o select da tela de vendas carrega as colunas de que a regra depende', () => {
  // Coluna que falta no select não dá erro: chega `undefined` e a regra que
  // depende dela simplesmente para de valer.
  for (const col of ['oferta_nome', 'pacote_pai_id', 'order_id', 'preco_base']) {
    assert.ok(COLUNAS_DA_TELA_DE_VENDAS.split(',').includes(col), `falta ${col} no select da tela de vendas`)
  }
})

test('o select do dashboard carrega pacote_pai_id', () => {
  assert.ok(COLUNAS_DO_DASHBOARD.split(',').includes('pacote_pai_id'))
})
