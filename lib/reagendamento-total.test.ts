import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planejarReagendamentoTotal, resumirReagendamentoTotal } from './reagendamento-total'

const s = (numero_sessao: number, status: string, google_event_id: string | null = null) =>
  ({ id: `s${numero_sessao}`, numero_sessao, status, google_event_id })

test('venda sem sessao nenhuma: nada a substituir, agendamento normal', () => {
  const plano = planejarReagendamentoTotal([])
  assert.equal(plano.ok, true)
  assert.deepEqual(plano.ok && plano.substituir, [])
})

test('venda so com pendentes: reagendamento total segue valendo', () => {
  const plano = planejarReagendamentoTotal([
    s(1, 'agendada', 'ev1'), s(2, 'pendente'), s(3, 'remarcada', 'ev3'),
  ])
  assert.equal(plano.ok, true)
  assert.deepEqual(plano.ok && plano.substituir.map(x => x.numero_sessao), [1, 2, 3])
})

// O caso do achado: hoje o delete apaga as pendentes, os eventos do Google sao
// cancelados e so entao o insert bate no unique (sale_id, numero_sessao). A
// recusa tem que vir antes de qualquer uma dessas coisas.
test('venda com sessao entregue e recusada antes de destruir qualquer coisa', () => {
  const plano = planejarReagendamentoTotal([
    s(1, 'entregue'), s(2, 'agendada', 'ev2'), s(3, 'agendada', 'ev3'),
  ])
  assert.equal(plano.ok, false)
  // Nao ha lista de sessoes a apagar: o chamador nao tem o que destruir.
  assert.equal('substituir' in plano, false)
  assert.deepEqual(!plano.ok && plano.entregues, [1])
  assert.match(!plano.ok ? plano.erro : '', /entregue/)
  assert.match(!plano.ok ? plano.erro : '', /remarque uma a uma/i)
})

test('estado misto com varias entregues: mensagem lista todas em ordem', () => {
  const plano = planejarReagendamentoTotal([
    s(3, 'entregue'), s(1, 'entregue'), s(2, 'entregue'), s(4, 'agendada', 'ev4'),
  ])
  assert.equal(plano.ok, false)
  assert.deepEqual(!plano.ok && plano.entregues, [1, 2, 3])
  assert.match(!plano.ok ? plano.erro : '', /as sessões 1, 2 e 3/)
})

test('entregue fora de ordem tambem bloqueia', () => {
  const plano = planejarReagendamentoTotal([s(1, 'agendada'), s(2, 'entregue')])
  assert.equal(plano.ok, false)
})

test('cancelada nao bloqueia nem entra na lista de substituicao', () => {
  const plano = planejarReagendamentoTotal([s(1, 'cancelada'), s(2, 'agendada', 'ev2')])
  assert.equal(plano.ok, true)
  assert.deepEqual(plano.ok && plano.substituir.map(x => x.numero_sessao), [2])
})

test('resumo conta o que a tela precisa avisar antes de confirmar', () => {
  const r = resumirReagendamentoTotal([
    { numero_sessao: 1, status: 'entregue' },
    { numero_sessao: 2, status: 'agendada', link_meet: 'https://meet.google.com/abc' },
    { numero_sessao: 3, status: 'agendada', link_meet: null },
    { numero_sessao: 4, status: 'cancelada' },
  ])
  assert.deepEqual(r, { total: 4, substituiveis: 2, entregues: 1, comConvite: 1, bloqueado: true })
})

test('resumo de venda ainda sem sessao nao bloqueia nada', () => {
  assert.deepEqual(resumirReagendamentoTotal([]), {
    total: 0, substituiveis: 0, entregues: 0, comConvite: 0, bloqueado: false,
  })
})
