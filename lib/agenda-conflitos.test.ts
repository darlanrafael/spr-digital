import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorTerapeuta , soCompromissos, mensagemConflito } from './agenda-conflitos'

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

test('a mensagem diz POR QUE esta bloqueado, nao so que esta', () => {
  // O comercial leu "horario bloqueado: Juliane Eller/Diagnostico Guiado"
  // enquanto agendava a Juliane, e entendeu que ela ja estava agendada. A
  // mensagem precisa dizer de quem e a agenda, o intervalo e que e bloqueio.
  const m = mensagemConflito([{
    dataISO: '2026-09-02T14:20:00.000Z',
    tipo: 'compromisso',
    descricao: 'em 02/09 às 11:20: a agenda de Pedro Roncada tem um bloqueio das 11:20 às 12:00: "Juliane Eller/Diagnóstico Guiado". É um compromisso lançado na agenda, não uma consulta marcada.',
  }])
  assert.ok(m.includes('Pedro Roncada'), 'nao diz de quem e a agenda')
  assert.ok(m.includes('11:20 às 12:00'), 'nao diz o intervalo ocupado')
  assert.ok(m.includes('não uma consulta marcada'), 'nao distingue bloqueio de consulta')
})

test('varios horarios ocupados saem em lista, com o total na frente', () => {
  const m = mensagemConflito([
    { dataISO: 'a', tipo: 'compromisso', descricao: 'em 02/09 às 11:20: bloqueio' },
    { dataISO: 'b', tipo: 'sessao', descricao: 'em 09/09 às 11:20: consulta' },
  ])
  assert.ok(m.startsWith('2 horários do pacote estão ocupados:'))
  assert.ok(m.includes('• em 02/09'))
  assert.ok(m.includes('• em 09/09'))
})

test('CRITICO: linha de compromisso com categoria "sessao" NAO pode ser passada por cima', () => {
  // `compromissos_terapeuta` guarda os dois tipos: a tela de lancamento manual
  // oferece "Categoria: Compromisso | Sessao". Classificar tudo como
  // compromisso fazia uma CONSULTA REAL virar bloqueio, e o override ofereceria
  // "Agendar assim mesmo" em cima dela. Ha 4 linhas assim no banco, com nome de
  // paciente no titulo (Cris Polonine, Wagner Muller, Jessica Moura).
  assert.equal(soCompromissos([
    { dataISO: '2026-07-21T12:40:00.000Z', tipo: 'sessao', descricao: 'Pedro atende "Cris Polonine" das 09:40 às 10:30 (consulta lançada na agenda)' },
  ]), false)
})

test('bloqueio de verdade continua podendo ser passado por cima', () => {
  assert.equal(soCompromissos([
    { dataISO: '2026-09-05T14:20:00.000Z', tipo: 'compromisso', descricao: 'bloqueio: ALMOÇO' },
  ]), true)
})

test('consulta lancada a mao no meio de bloqueios derruba o override inteiro', () => {
  assert.equal(soCompromissos([
    { dataISO: 'a', tipo: 'compromisso', descricao: 'ALMOÇO' },
    { dataISO: 'b', tipo: 'sessao', descricao: 'consulta lançada na agenda' },
    { dataISO: 'c', tipo: 'compromisso', descricao: 'GRAVAÇÃO' },
  ]), false)
})
