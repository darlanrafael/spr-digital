import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planejarAprovacaoReembolso, type SessaoDaSolicitacao } from './aprovacao-reembolso'

const s = (n: number, status: string, evento: string | null = `ev${n}`): SessaoDaSolicitacao =>
  ({ id: `id${n}`, numero_sessao: n, status, google_event_id: evento })

test('sessoes agendadas: cancela todas e lista os eventos do Google', () => {
  const d = planejarAprovacaoReembolso([s(3, 'agendada'), s(4, 'agendada')])
  assert.equal(d.ok, true)
  if (!d.ok) return
  assert.deepEqual(d.cancelar, ['id3', 'id4'])
  assert.deepEqual(d.eventosACancelar, ['ev3', 'ev4'])
})

test('O CASO DO MIGUEL PIRES: sessao entregue depois do pedido recusa a aprovacao', () => {
  // Pedido aberto em 25/08 com as sessoes 2, 3 e 4. Ficou 8 dias esperando o
  // CEO e a sessao 2 foi atendida nesse intervalo. Aprovar reescreveria um
  // atendimento que aconteceu, e os R$ 1.560 foram calculados contando com ela.
  const d = planejarAprovacaoReembolso([s(2, 'entregue'), s(3, 'agendada'), s(4, 'agendada')])
  assert.equal(d.ok, false)
  if (d.ok) return
  assert.equal(d.motivo, 'sessao_ja_entregue')
  assert.deepEqual(d.numeros, [2])
})

test('a recusa nao devolve nada a cancelar: nao ha o que destruir por engano', () => {
  const d = planejarAprovacaoReembolso([s(2, 'entregue'), s(3, 'agendada')])
  assert.equal(d.ok, false)
  assert.equal('cancelar' in d, false)
  assert.equal('eventosACancelar' in d, false)
})

test('varias entregues saem ordenadas na mensagem', () => {
  const d = planejarAprovacaoReembolso([s(5, 'entregue'), s(2, 'entregue'), s(3, 'agendada')])
  assert.equal(d.ok, false)
  if (d.ok) return
  assert.deepEqual(d.numeros, [2, 5])
})

test('sessao sem evento no Google nao entra na lista de cancelamento do Calendar', () => {
  const d = planejarAprovacaoReembolso([s(3, 'agendada', null), s(4, 'agendada')])
  assert.equal(d.ok, true)
  if (!d.ok) return
  assert.deepEqual(d.cancelar, ['id3', 'id4'])
  assert.deepEqual(d.eventosACancelar, ['ev4'])
})

test('aprovar de novo e inofensivo: sessao ja cancelada nao repete nem bloqueia', () => {
  const d = planejarAprovacaoReembolso([s(3, 'cancelada'), s(4, 'agendada')])
  assert.equal(d.ok, true)
  if (!d.ok) return
  assert.deepEqual(d.cancelar, ['id4'])
  assert.deepEqual(d.eventosACancelar, ['ev4'])
})

test('status remarcada tambem e cancelavel: continua sendo sessao futura do paciente', () => {
  const d = planejarAprovacaoReembolso([s(3, 'remarcada')])
  assert.equal(d.ok, true)
  if (!d.ok) return
  assert.deepEqual(d.cancelar, ['id3'])
})

test('lista vazia nao quebra', () => {
  const d = planejarAprovacaoReembolso([])
  assert.equal(d.ok, true)
  if (!d.ok) return
  assert.deepEqual(d.cancelar, [])
  assert.deepEqual(d.eventosACancelar, [])
})
