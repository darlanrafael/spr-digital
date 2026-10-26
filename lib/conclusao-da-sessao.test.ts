import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarConclusaoDaSessao, sessaoConcluivel } from './conclusao-da-sessao'
import { brasiliaLocalToISO } from './terapeutas-auth'

// O "concluir" (marcar entregue) era um bloco inline dentro do PATCH de
// /api/terapeutas/sessoes. Extraido pra ca pra que o botao individual E o
// "concluir varias de uma vez" (lote) usem EXATAMENTE a mesma regra - senao as
// duas divergem e uma sessao concluida em lote vira um objeto diferente de uma
// concluida no ✓ verde. Este teste trava os campos gravados.

// 2026-10-25T17:30:00Z -> Sao Paulo (UTC-3, fixo) = 14:30.
const AGORA = Date.UTC(2026, 9, 25, 17, 30, 0)
const NOW_ISO = new Date(AGORA).toISOString()

test('concluir (agora, sem data manual) grava status entregue e data = agora', () => {
  const r = montarConclusaoDaSessao({ numeroSessao: 3, usuarioNome: 'Leomir Santos', agoraMs: AGORA })
  assert.equal(r.updateData.status_consulta, 'concluida')
  assert.equal(r.updateData.status, 'entregue')
  assert.equal(r.updateData.data_entrega, NOW_ISO)
  assert.equal(r.updateData.concluido_em, NOW_ISO)
  assert.equal(r.updateData.entregue_confirmado_por, 'Leomir Santos')
})

test('concluir sem data manual descreve a hora local de Brasilia', () => {
  const r = montarConclusaoDaSessao({ numeroSessao: 3, usuarioNome: 'Leomir Santos', agoraMs: AGORA })
  assert.equal(r.ocorrenciaDesc, 'Consulta concluída por Leomir Santos às 14:30')
})

test('titulo da ocorrencia usa o numero da sessao', () => {
  const r = montarConclusaoDaSessao({ numeroSessao: 7, usuarioNome: 'Denise', agoraMs: AGORA })
  assert.equal(r.ocorrenciaTitulo, 'Consulta Concluída — Sessão 7')
})

test('tipo da ocorrencia e acao de log sao de confirmacao de entrega', () => {
  const r = montarConclusaoDaSessao({ numeroSessao: 1, usuarioNome: 'X', agoraMs: AGORA })
  assert.equal(r.ocorrenciaTipo, 'confirmacao_entrega')
  assert.equal(r.logAcao, 'confirmacao_entrega')
})

test('concluir COM data manual usa a data informada e avisa no texto', () => {
  const manual = '2026-10-20T15:00'
  const r = montarConclusaoDaSessao({ numeroSessao: 2, usuarioNome: 'Denise', dataEntregaManual: manual, agoraMs: AGORA })
  assert.equal(r.updateData.data_entrega, brasiliaLocalToISO(manual))
  assert.equal(r.updateData.concluido_em, NOW_ISO)
  assert.match(r.ocorrenciaDesc, /informada manualmente/)
})

// Guarda do lote: so pode concluir quem ainda esta pendente. Sem isto, mandar
// no lote um id ja entregue reescreveria a data_entrega, geraria ocorrencia
// duplicada no prontuario e um segundo log de comissao.
test('sessao pendente/agendada pode ser concluida em lote', () => {
  assert.equal(sessaoConcluivel('agendada'), true)
  assert.equal(sessaoConcluivel('pendente'), true)
})

test('sessao ja entregue NAO entra no lote (evita conclusao dupla)', () => {
  assert.equal(sessaoConcluivel('entregue'), false)
})

test('status ausente/estranho nao entra no lote (defensivo)', () => {
  assert.equal(sessaoConcluivel(null), false)
  assert.equal(sessaoConcluivel('cancelada'), false)
})
