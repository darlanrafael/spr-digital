import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planejarFalta, decisaoDaFalta } from './falta-comissao'

// Regra do dono (25/10/2026): marcar "nao compareceu" faz o paciente PERDER a
// sessao (o pacote anda, sai dos pendentes) e grava a falta no prontuario -
// pra TODOS. A comissao e que muda:
//   - Pedro: nunca recebe por aqui (e socio, recebe no fechamento). Sem falta.
//   - Denise/Leomir: a comissao fica PENDENTE ate o dono decidir (Pagar / Nao
//     pagar) numa fila de Aprovacoes. Por isso a sessao sai com comissao_valor
//     = 0 (nao conta ate ser aprovada) e o valor original fica guardado na falta.

// 2026-10-25T17:30:00Z -> Sao Paulo (UTC-3) = 14:30
const AGORA = Date.UTC(2026, 9, 25, 17, 30, 0)
const NOW_ISO = new Date(AGORA).toISOString()

test('falta da Denise/Leomir: sessao vira entregue, comissao zera e cria aprovacao', () => {
  const p = planejarFalta({ ehPedro: false, comissaoValorSessao: 150, numeroSessao: 3, usuarioNome: 'Leomir Santos', agoraMs: AGORA })
  assert.equal(p.updateData.status, 'entregue')
  assert.equal(p.updateData.status_consulta, 'nao_compareceu')
  assert.equal(p.updateData.comissao_valor, 0)
  assert.equal(p.updateData.data_entrega, NOW_ISO)
  assert.equal(p.updateData.concluido_em, NOW_ISO)
  assert.equal(p.updateData.entregue_confirmado_por, 'Leomir Santos')
  assert.equal(p.criarFalta, true)
  assert.equal(p.faltaComissaoValor, 150)
})

test('falta do Pedro: sai dos pendentes, sem comissao e SEM aprovacao', () => {
  const p = planejarFalta({ ehPedro: true, comissaoValorSessao: 150, numeroSessao: 3, usuarioNome: 'Pedro Roncada', agoraMs: AGORA })
  assert.equal(p.updateData.status, 'entregue')
  assert.equal(p.updateData.status_consulta, 'nao_compareceu')
  assert.equal(p.updateData.comissao_valor, 0)
  assert.equal(p.criarFalta, false)
  assert.equal(p.faltaComissaoValor, 0)
})

test('Denise/Leomir com comissao 0 na sessao: nao cria aprovacao (nada a decidir)', () => {
  const p = planejarFalta({ ehPedro: false, comissaoValorSessao: 0, numeroSessao: 1, usuarioNome: 'Denise', agoraMs: AGORA })
  assert.equal(p.criarFalta, false)
})

test('prontuario: titulo e descricao da falta', () => {
  const p = planejarFalta({ ehPedro: false, comissaoValorSessao: 150, numeroSessao: 3, usuarioNome: 'Leomir Santos', agoraMs: AGORA })
  assert.equal(p.ocorrenciaTitulo, 'Paciente Não Compareceu — Sessão 3')
  assert.equal(p.ocorrenciaDesc, 'Paciente não compareceu à sessão. Registrado por Leomir Santos às 14:30')
})

test('decisao PAGAR: falta aprovada e comissao da sessao volta ao valor original', () => {
  assert.deepEqual(decisaoDaFalta('pagar', 150), { novoStatusFalta: 'aprovado', comissaoDaSessao: 150 })
})

test('decisao NAO PAGAR: falta negada e comissao continua 0', () => {
  assert.deepEqual(decisaoDaFalta('nao_pagar', 150), { novoStatusFalta: 'negado', comissaoDaSessao: 0 })
})
