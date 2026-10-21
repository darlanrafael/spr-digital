import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repasseMentoriaPorSessao, MENTORIA_POR_SESSAO } from './repasse-mentoria-por-sessao'

// Decisao do dono (21/10/2026): a Mentoria Particular do Leomir paga R$ 90 por
// SESSAO entregue, no lugar do % de comissao (igual o diagnostico dele). So o
// Leomir por enquanto; a da Denise continua no %. O Leomir entrega TODAS as
// sessoes (sem split com o Pedro), e a quantidade vem do nome da oferta.

const LEOMIR = 'Mentoria Particular - Pedro | Leomir'

test('Mentoria Particular do Leomir: R$ 90 por sessao da oferta', () => {
  // Luciano "Formato 2 - 2 Sessoes" = 2 sessoes -> R$ 180.
  const r = repasseMentoriaPorSessao(LEOMIR, [{ nome: 'Luciano', oferta_nome: 'Formato 2 - 2 Sessões' }])
  assert.equal(r?.terapeuta, 'Leomir Santos')
  assert.equal(r?.valorPorSessao, 90)
  assert.equal(r?.sessoes, 2)
  assert.equal(r?.valor, 180)
  assert.equal(r?.semSessao.length, 0)
})

test('soma varias vendas do produto (Luciano 2 + Diego 1 = 3 sessoes, R$ 270)', () => {
  const r = repasseMentoriaPorSessao(LEOMIR, [
    { nome: 'Luciano', oferta_nome: 'Formato 2 - 2 Sessões' },
    { nome: 'Diego Rizzo Bruno', oferta_nome: 'Formato 1 - Sessão Única' },
  ])
  assert.equal(r?.sessoes, 3)
  assert.equal(r?.valor, 270)
})

test('produto que NAO esta na lista devolve null (segue no caminho do %)', () => {
  assert.equal(repasseMentoriaPorSessao('Mentoria Particular - Pedro | Denise', [{ nome: 'X', oferta_nome: 'Formato 2 - 2 Sessões' }]), null)
  assert.equal(repasseMentoriaPorSessao('COMO SER PERDOADO', [{ nome: 'X', oferta_nome: null }]), null)
})

test('oferta que nao diz a sessao entra em semSessao (nao subtaxa em silencio)', () => {
  const r = repasseMentoriaPorSessao(LEOMIR, [
    { nome: 'Fulano', oferta_nome: 'oferta estranha sem numero' },
    { nome: 'Ciclano', oferta_nome: 'Formato 2 - 2 Sessões' },
  ])
  assert.equal(r?.sessoes, 2)             // so a que deu pra ler
  assert.equal(r?.valor, 180)
  assert.equal(r?.semSessao.length, 1)
  assert.equal(r?.semSessao[0].nome, 'Fulano')
})

test('o produto do Leomir esta na config', () => {
  assert.ok(MENTORIA_POR_SESSAO.some(m => m.produto === LEOMIR && m.valorPorSessao === 90))
})
