import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoDaLinha } from './aviso-da-linha-da-agenda'

const sessao = (inicio: number) => ({ inicio, ehSessao: true })
const compromisso = (inicio: number, titulo: string) => ({ inicio, ehSessao: false, titulo })

test('linha com um item so nao avisa nada', () => {
  assert.equal(avisoDaLinha([sessao(19 * 60 + 20)]), null)
  assert.equal(avisoDaLinha([compromisso(19 * 60 + 30, 'JANTAR')]), null)
  assert.equal(avisoDaLinha([]), null)
})

test('CASO REAL 09/09/2026: Valdir as 19:20 e o JANTAR das 19:30', () => {
  // A tela dizia "2 consultas marcadas no mesmo horario". Nao eram duas
  // consultas, e nenhuma estava no horario da outra.
  const a = avisoDaLinha([sessao(19 * 60 + 20), compromisso(19 * 60 + 30, 'JANTAR')])
  assert.equal(a?.texto, 'Consulta avançando sobre o compromisso "JANTAR" das 19:30')
  assert.equal(a?.gravidade, 'atencao')
})

test('DUAS CONSULTAS continua sendo conflito vermelho', () => {
  // O caso grave: alguem fica sem atendimento. Foi o defeito que gerou 25
  // duplas marcacoes no banco antes da trava de 11/08.
  const a = avisoDaLinha([sessao(12 * 60 + 40), sessao(12 * 60 + 40)])
  assert.equal(a?.texto, '2 consultas marcadas no mesmo horário')
  assert.equal(a?.gravidade, 'conflito')
})

test('tres consultas dizem tres', () => {
  const a = avisoDaLinha([sessao(600), sessao(600), sessao(600)])
  assert.equal(a?.texto, '3 consultas marcadas no mesmo horário')
})

test('duas consultas MAIS um compromisso: manda o caso grave', () => {
  // Nunca deixar a dupla marcacao parecer o caso inofensivo.
  const a = avisoDaLinha([sessao(600), sessao(600), compromisso(610, 'ALMOÇO')])
  assert.equal(a?.gravidade, 'conflito')
  assert.match(a!.texto, /2 consultas/)
})

test('uma consulta e dois compromissos nao inventa nome', () => {
  const a = avisoDaLinha([sessao(600), compromisso(610, 'ALMOÇO'), compromisso(615, 'REUNIÃO')])
  assert.equal(a?.texto, 'Consulta avançando sobre o compromisso 2 compromissos')
  assert.equal(a?.gravidade, 'atencao')
})

test('compromisso sem titulo nao vira aspas vazias', () => {
  const a = avisoDaLinha([sessao(600), { inicio: 610, ehSessao: false, titulo: '   ' }])
  assert.equal(a?.texto, 'Consulta avançando sobre o compromisso um compromisso das 10:10')
})

test('dois compromissos e nenhuma consulta tambem avisa', () => {
  // Nao e o caso comum, mas a linha tem dois itens e o terapeuta precisa ver.
  const a = avisoDaLinha([compromisso(600, 'ALMOÇO'), compromisso(605, 'JANTAR')])
  assert.equal(a?.gravidade, 'atencao')
})

test('a hora do compromisso sai com dois digitos', () => {
  const a = avisoDaLinha([sessao(540), compromisso(9 * 60 + 5, 'CAFÉ')])
  assert.match(a!.texto, /das 09:05/)
})
