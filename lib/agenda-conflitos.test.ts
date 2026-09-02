import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorTerapeuta , soCompromissos } from './agenda-conflitos'

test('agrupa as datas por terapeuta preservando a ordem', () => {
  const g = agruparPorTerapeuta([
    { terapeuta_id: 'PEDRO',  dataISO: '2026-09-08T14:00:00.000Z' },
    { terapeuta_id: 'PEDRO',  dataISO: '2026-09-15T14:00:00.000Z' },
    { terapeuta_id: 'DENISE', dataISO: '2026-09-22T14:00:00.000Z' },
  ])
  assert.deepEqual(g, {
    PEDRO:  ['2026-09-08T14:00:00.000Z', '2026-09-15T14:00:00.000Z'],
    DENISE: ['2026-09-22T14:00:00.000Z'],
  })
})

test('lista vazia devolve objeto vazio', () => {
  assert.deepEqual(agruparPorTerapeuta([]), {})
})

test('soCompromissos: bloqueio da propria equipe pode ser passado por cima', () => {
  // A equipe reserva o horario na agenda antes de agendar. O caso real: um
  // compromisso "Juliane Eller/Diagnostico Guiado" ocupando 11:20 fazia o
  // agendamento daquele mesmo paciente naquele mesmo horario ser recusado.
  assert.equal(soCompromissos([
    { dataISO: '2026-09-02T14:20:00.000Z', tipo: 'compromisso', descricao: '02/09 às 11:20 - horário bloqueado: Juliane Eller/Diagnóstico Guiado' },
  ]), true)
})

test('soCompromissos: consulta de OUTRO PACIENTE nunca pode ser passada por cima', () => {
  assert.equal(soCompromissos([
    { dataISO: '2026-09-02T14:20:00.000Z', tipo: 'sessao', descricao: 'já tem a consulta de Ana' },
  ]), false)
})

test('soCompromissos: basta UMA sessao no meio para a recusa valer', () => {
  assert.equal(soCompromissos([
    { dataISO: '2026-09-02T14:20:00.000Z', tipo: 'compromisso', descricao: 'almoço' },
    { dataISO: '2026-09-09T14:20:00.000Z', tipo: 'sessao', descricao: 'já tem a consulta de Ana' },
    { dataISO: '2026-09-16T14:20:00.000Z', tipo: 'compromisso', descricao: 'gravação' },
  ]), false)
})

test('soCompromissos: lista vazia nao habilita nada', () => {
  assert.equal(soCompromissos([]), false)
})
