import { test } from 'node:test'
import assert from 'node:assert/strict'
import { horarioParaMinutos, fimEfetivoSessao } from './agenda-horarios'

// `lib/agenda-horarios.ts` nao tinha arquivo de teste - o terceiro modulo nessa
// situacao encontrado nesta varredura (depois de `formatters.ts` e
// `terapeutas-auth.ts`), e o unico dos tres que decide CHOQUE DE HORARIO.
//
// O que esta em jogo: `fimEfetivoSessao` diz ate quando uma consulta ocupa a
// agenda, e esse fim entra direto na conta de sobreposicao de
// `agenda-conflitos`. Errar para mais bloqueia horario que a propria grade
// oferece; errar para menos coloca DOIS PACIENTES no mesmo horario.

// ── horarioParaMinutos ──────────────────────────────────────────────────────
test('converte o horario da grade em minutos desde a meia-noite', () => {
  assert.equal(horarioParaMinutos('14:10'), 850)
  assert.equal(horarioParaMinutos('00:00'), 0)
  assert.equal(horarioParaMinutos('23:59'), 1439)
  assert.equal(horarioParaMinutos('13:30'), 810)
})

test('hora com zero a esquerda nao vira octal nem NaN', () => {
  // "08:05" com parse descuidado ja rendeu 0 em outros sistemas.
  assert.equal(horarioParaMinutos('08:05'), 485)
  assert.equal(horarioParaMinutos('09:09'), 549)
})

// ── fimEfetivoSessao: SEM grade fixa ────────────────────────────────────────
test('sem grade fixa, a duracao cadastrada vale inteira', () => {
  // E o caso da Denise e o padrao do sistema.
  assert.equal(fimEfetivoSessao(810, 50), 860, '13:30 + 50min = 14:20')
  assert.equal(fimEfetivoSessao(840, 60), 900, '14:00 + 60min = 15:00')
})

test('grade vazia ou ausente e tratada como SEM grade, nao como grade sem horarios', () => {
  // Se lista vazia caisse no caminho da grade, `proximo` ficaria null e a
  // consulta terminaria... na duracao mesmo. Mas `undefined` e `null` precisam
  // chegar no mesmo lugar, e e isso que trava aqui.
  assert.equal(fimEfetivoSessao(810, 50, []), 860)
  assert.equal(fimEfetivoSessao(810, 50, null), 860)
  assert.equal(fimEfetivoSessao(810, 50, undefined), 860)
})

// ── fimEfetivoSessao: COM a grade real do Pedro ─────────────────────────────
// Os tres casos que o comentario do modulo cita como reais.
const GRADE_PEDRO = ['08:00', '12:10', '12:40', '13:30', '14:10', '17:30', '18:15']

test('CASO REAL: 13:30 na grade do Pedro termina 14:10, nao 14:20', () => {
  // Sao 40 minutos, nao os 50 cadastrados. Somar 50 cegamente faz a consulta
  // invadir as 14:10 - um horario que a propria grade oferece como atendivel.
  assert.equal(fimEfetivoSessao(horarioParaMinutos('13:30'), 50, GRADE_PEDRO), horarioParaMinutos('14:10'))
})

test('CASO REAL: 12:10 termina 12:40 (30 minutos)', () => {
  assert.equal(fimEfetivoSessao(horarioParaMinutos('12:10'), 50, GRADE_PEDRO), horarioParaMinutos('12:40'))
})

test('CASO REAL: 17:30 termina 18:15 (45 minutos)', () => {
  assert.equal(fimEfetivoSessao(horarioParaMinutos('17:30'), 50, GRADE_PEDRO), horarioParaMinutos('18:15'))
})

test('quando a grade e MAIS LARGA que a duracao, quem manda e a duracao', () => {
  // 08:00 -> o proximo da grade e 12:10, quatro horas depois. A consulta dura
  // 50 minutos e ocupa 50 minutos: o intervalo ate o proximo horario e folga,
  // nao atendimento. Se a grade mandasse aqui, o terapeuta apareceria ocupado
  // a manha inteira.
  assert.equal(fimEfetivoSessao(horarioParaMinutos('08:00'), 50, GRADE_PEDRO), horarioParaMinutos('08:50'))
})

test('o ULTIMO horario da grade nao tem proximo: vale a duracao', () => {
  // 18:15 e o fim da grade. Sem tratar isso, `proximo` fica null e a conta
  // precisa cair na duracao - senao a ultima consulta do dia nao ocuparia
  // tempo nenhum e aceitaria outro paciente em cima.
  assert.equal(fimEfetivoSessao(horarioParaMinutos('18:15'), 50, GRADE_PEDRO), horarioParaMinutos('19:05'))
})

test('horario FORA da grade usa o proximo horario da grade que vier depois', () => {
  // Encaixe as 13:00 (nao esta na grade). O proximo e 13:30, entao ocupa 30min.
  assert.equal(fimEfetivoSessao(horarioParaMinutos('13:00'), 50, GRADE_PEDRO), horarioParaMinutos('13:30'))
})

test('o "proximo" e o MENOR maior, nao o primeiro da lista que for maior', () => {
  // Grade fora de ordem de proposito: vem do banco, e nada garante ordenacao.
  // Pegar o primeiro maior daria 18:15 e bloquearia a tarde inteira.
  const foraDeOrdem = ['18:15', '14:10', '12:40', '13:30']
  assert.equal(fimEfetivoSessao(horarioParaMinutos('12:40'), 50, foraDeOrdem), horarioParaMinutos('13:30'))
})

test('o proprio horario de inicio NAO conta como proximo', () => {
  // Se contasse, a consulta das 13:30 terminaria 13:30 - duracao zero, e o
  // horario aceitaria outro paciente por cima na mesma hora.
  const fim = fimEfetivoSessao(horarioParaMinutos('13:30'), 50, GRADE_PEDRO)
  assert.ok(fim > horarioParaMinutos('13:30'), 'a consulta tem que ocupar tempo maior que zero')
})

test('a duracao da Denise (60min) na grade do Pedro continua limitada pela grade', () => {
  // Cada terapeuta tem a sua duracao; a grade nao muda com ela.
  assert.equal(fimEfetivoSessao(horarioParaMinutos('13:30'), 60, GRADE_PEDRO), horarioParaMinutos('14:10'))
})
