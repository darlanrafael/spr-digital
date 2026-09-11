import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resumoDoFechamento } from './resumo-do-fechamento-terapeuta'

test('CASO REAL: o fechamento regularizado de 14/08 cobre 17/06 a 17/08', () => {
  // E o motivo do modulo existir. O card dizia "14/08/26, 15:00" e mais nada,
  // enquanto o pagamento cobria dois meses de sessoes.
  const r = resumoDoFechamento([
    { sale_id: 'v1', data_entrega: '2026-06-17T22:00:00Z' },
    { sale_id: 'v2', data_entrega: '2026-07-14T22:30:00Z' },
    { sale_id: 'v2', data_entrega: '2026-07-21T23:39:00Z' },
    { sale_id: 'v3', data_entrega: '2026-08-17T21:38:00Z' },
  ])
  assert.equal(r.de, '2026-06-17T22:00:00Z')
  assert.equal(r.ate, '2026-08-17T21:38:00Z')
  assert.equal(r.pacientes, 3)
  assert.equal(r.antecipadas, 0)
})

test('conta paciente por VENDA, nao por nome', () => {
  // Tres casos confirmados em 11/09/2026 tem o nome do COMPRADOR no prontuario
  // (Billimaicon e Raquel, Marcio e Lebian, Amanda e Julia). Contar por nome
  // inflaria o numero de pacientes.
  const r = resumoDoFechamento([
    { sale_id: 'v1', paciente_nome: 'Billimaicon Santos Barbosa', data_entrega: '2026-07-27T00:00:00Z' },
    { sale_id: 'v1', paciente_nome: 'Raquel', data_entrega: '2026-07-31T00:00:00Z' },
  ])
  assert.equal(r.pacientes, 1, 'o mesmo sale_id com dois nomes e UM paciente')
})

test('sessao ANTECIPADA e contada e nao estraga o periodo', () => {
  // Antecipada nao tem data_entrega: e a unica marca que sobra no snapshot.
  const r = resumoDoFechamento([
    { sale_id: 'v1', data_entrega: '2026-07-01T00:00:00Z' },
    { sale_id: 'v2', data_entrega: null, data_agendada: '2026-12-01T00:00:00Z' },
    { sale_id: 'v3', data_entrega: '2026-07-10T00:00:00Z' },
  ])
  assert.equal(r.de, '2026-07-01T00:00:00Z')
  assert.equal(r.ate, '2026-07-10T00:00:00Z', 'a antecipada de dezembro nao pode virar o fim do periodo')
  assert.equal(r.antecipadas, 1)
  assert.equal(r.pacientes, 3)
})

test('fechamento SO de antecipadas nao tem periodo, e isso nao e erro', () => {
  const r = resumoDoFechamento([
    { sale_id: 'v1', data_entrega: null },
    { sale_id: 'v2', data_entrega: null },
  ])
  assert.equal(r.de, null)
  assert.equal(r.ate, null)
  assert.equal(r.antecipadas, 2)
  assert.equal(r.pacientes, 2)
})

test('snapshot vazio, nulo ou indefinido nao quebra', () => {
  for (const s of [[], null, undefined]) {
    const r = resumoDoFechamento(s)
    assert.deepEqual(r, { de: null, ate: null, pacientes: 0, antecipadas: 0 }, JSON.stringify(s))
  }
})

test('uma sessao so: de e ate sao a mesma data', () => {
  const r = resumoDoFechamento([{ sale_id: 'v1', data_entrega: '2026-07-01T00:00:00Z' }])
  assert.equal(r.de, r.ate)
  assert.equal(r.pacientes, 1)
})

test('a ordem do snapshot nao importa', () => {
  const fora = resumoDoFechamento([
    { sale_id: 'v1', data_entrega: '2026-08-17T00:00:00Z' },
    { sale_id: 'v2', data_entrega: '2026-06-17T00:00:00Z' },
  ])
  assert.equal(fora.de, '2026-06-17T00:00:00Z')
  assert.equal(fora.ate, '2026-08-17T00:00:00Z')
})

test('sessao sem sale_id nao conta como paciente fantasma', () => {
  const r = resumoDoFechamento([
    { sale_id: 'v1', data_entrega: '2026-07-01T00:00:00Z' },
    { sale_id: null, data_entrega: '2026-07-02T00:00:00Z' },
    { data_entrega: '2026-07-03T00:00:00Z' },
  ])
  assert.equal(r.pacientes, 1)
})

test('as DUAS telas do historico mostram o periodo apurado', () => {
  // Teste de fiacao: os dois cards sao codigo duplicado (a tela do admin e a da
  // propria terapeuta). Corrigir um e esquecer o outro faz a mesma informacao
  // aparecer numa tela e nao na outra, sem erro nenhum - foi o que aconteceu
  // com o historico da empresa em 17/08, que ganhou a faixa e deixou estas duas
  // de fora.
  for (const arq of ['app/terapeutas/fechamentos/page.tsx', 'app/terapeutas/[id]/page.tsx']) {
    const texto = readFileSync(new URL('../' + arq, import.meta.url), 'utf8')
    assert.ok(texto.includes('resumoDoFechamento'), `${arq} nao usa resumoDoFechamento`)
  }
})
