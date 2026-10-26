// Forca o fuso do processo em UTC: assim a hora do prontuario so vira 14:30
// (Brasilia) se a implementacao pedir timeZone 'America/Sao_Paulo' de fato.
// Sem isso, a maquina em BRT mascara a remocao do timeZone.
process.env.TZ = 'UTC'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planejarFalta, decisaoDaFalta } from './falta-comissao'

// Regra v2 (correcao de 26/10/2026): marcar "nao compareceu" faz o paciente
// PERDER a sessao (o pacote anda, sai dos pendentes) e grava a falta no
// prontuario - pra TODOS. A comissao NUNCA e zerada: a sessao e travada
// (comissao_bloqueada) ate o dono decidir.
//   - Socio (Pedro): sempre bloqueia; nao cria aprovacao.
//   - Contratado com comissao: bloqueia e cria aprovacao pendente.
//   - Contratado sem comissao: nao bloqueia, nada a decidir.

// 2026-10-25T17:30:00Z -> Sao Paulo (UTC-3) = 14:30
const AGORA = Date.UTC(2026, 9, 25, 17, 30, 0)
const NOW_ISO = new Date(AGORA).toISOString()

test('contratado com comissao: trava a comissao, cria aprovacao e NAO zera comissao_valor', () => {
  const p = planejarFalta({ ehSocio: false, temComissao: true, numeroSessao: 3, usuarioNome: 'Leomir Santos', agoraMs: AGORA })
  assert.equal(p.updateData.status, 'entregue')
  assert.equal(p.updateData.status_consulta, 'nao_compareceu')
  assert.equal(p.updateData.comissao_bloqueada, true)
  assert.equal(p.updateData.data_entrega, NOW_ISO)
  assert.equal(p.updateData.concluido_em, NOW_ISO)
  assert.equal(p.updateData.entregue_confirmado_por, 'Leomir Santos')
  assert.equal(p.criarFalta, true)
  assert.equal('comissao_valor' in p.updateData, false)
})

test('socio: trava a comissao e NAO cria aprovacao', () => {
  const p = planejarFalta({ ehSocio: true, temComissao: false, numeroSessao: 3, usuarioNome: 'Pedro Roncada', agoraMs: AGORA })
  assert.equal(p.updateData.status, 'entregue')
  assert.equal(p.updateData.status_consulta, 'nao_compareceu')
  assert.equal(p.updateData.comissao_bloqueada, true)
  assert.equal(p.criarFalta, false)
  assert.equal('comissao_valor' in p.updateData, false)
})

test('socio COM comissao (caso Pedro): trava, mas NAO cria aprovacao', () => {
  const p = planejarFalta({ ehSocio: true, temComissao: true, numeroSessao: 2, usuarioNome: 'Pedro Roncada', agoraMs: AGORA })
  assert.equal(p.updateData.comissao_bloqueada, true)
  assert.equal(p.criarFalta, false)
  assert.equal('comissao_valor' in p.updateData, false)
})

test('contratado sem comissao: nao cria aprovacao e nao trava a comissao', () => {
  const p = planejarFalta({ ehSocio: false, temComissao: false, numeroSessao: 1, usuarioNome: 'Denise', agoraMs: AGORA })
  assert.equal(p.criarFalta, false)
  assert.equal(p.updateData.comissao_bloqueada, false)
  assert.equal('comissao_valor' in p.updateData, false)
})

test('prontuario: titulo e descricao com hora de Brasilia', () => {
  const p = planejarFalta({ ehSocio: false, temComissao: true, numeroSessao: 3, usuarioNome: 'Leomir Santos', agoraMs: AGORA })
  assert.equal(p.ocorrenciaTitulo, 'Paciente Não Compareceu — Sessão 3')
  assert.equal(p.ocorrenciaDesc, 'Paciente não compareceu à sessão. Registrado por Leomir Santos às 14:30')
})

test('decisao PAGAR: falta aprovada e desbloqueia a sessao', () => {
  assert.deepEqual(decisaoDaFalta('pagar'), { novoStatusFalta: 'aprovado', desbloquear: true })
})

test('decisao NAO PAGAR: falta negada e nao desbloqueia', () => {
  assert.deepEqual(decisaoDaFalta('nao_pagar'), { novoStatusFalta: 'negado', desbloquear: false })
})
