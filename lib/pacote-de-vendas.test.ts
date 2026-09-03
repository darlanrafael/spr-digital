import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidataAoMesmoPacote, vendasDoPacote, JANELA_MESMO_PACOTE_HORAS, type VendaCandidata } from './pacote-de-vendas'

const v = (o: Partial<VendaCandidata> & { id: string; data_hora: string }): VendaCandidata => ({
  email: 'paciente@x.com', produto: 'Mentoria Particular - Pedro Roncada', entregues: 0, ...o,
})

test('CASO REAL DA AMANDA: duas compras a 15h de distancia sao candidatas', () => {
  // 24/08 21:28 R$ 2.600 e 25/08 12:43 R$ 2.680, as duas "Formato - 4 Sessão".
  const a = v({ id: 'a', data_hora: '2026-08-25T00:28:00Z', precoBase: 2600 })
  const b = v({ id: 'b', data_hora: '2026-08-25T15:43:00Z', precoBase: 2680 })
  assert.equal(candidataAoMesmoPacote({ venda: a, outras: [b] })?.id, 'b')
  assert.equal(candidataAoMesmoPacote({ venda: b, outras: [a] })?.id, 'a')
})

test('CASO REAL DA JESSICA: 9,8h depois, mas o primeiro pacote JA foi consumido', () => {
  // Comprou de novo com as 4 sessoes da primeira entregues. E cliente
  // satisfeita comprando outro pacote, nao pagamento dividido - e este criterio
  // e mais forte que o relogio.
  const nova = v({ id: 'nova', data_hora: '2026-07-02T20:00:00Z' })
  const antiga = v({ id: 'antiga', data_hora: '2026-07-02T10:12:00Z', entregues: 4 })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [antiga] }), null)
})

test('CASO REAL DO FABIO NERY: 6 minutos depois, mas ja tinha 2 entregues', () => {
  const nova = v({ id: 'n', data_hora: '2026-06-30T10:06:00Z' })
  const antiga = v({ id: 'a', data_hora: '2026-06-30T10:00:00Z', entregues: 2 })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [antiga] }), null)
})

test('CASO REAL DA ANA ASSIS: 24,5h fica de fora por 30 minutos', () => {
  // Nenhum limite escapa da fronteira. E por isso que o sistema pergunta em vez
  // de decidir - mas fora da janela ele nem propoe.
  const nova = v({ id: 'n', data_hora: '2026-08-05T10:30:00Z' })
  const antiga = v({ id: 'a', data_hora: '2026-08-04T10:00:00Z' })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [antiga] }), null)
})

test('exatamente 24h ainda e candidata', () => {
  const nova = v({ id: 'n', data_hora: '2026-08-05T10:00:00Z' })
  const antiga = v({ id: 'a', data_hora: '2026-08-04T10:00:00Z' })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [antiga] })?.id, 'a')
  assert.equal(JANELA_MESMO_PACOTE_HORAS, 24)
})

test('produto diferente nunca e o mesmo pacote', () => {
  const nova = v({ id: 'n', data_hora: '2026-08-25T12:00:00Z' })
  const outra = v({ id: 'o', data_hora: '2026-08-25T13:00:00Z', produto: 'Diagnóstico Guiado: Programa de acompanhamento Individual' })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [outra] }), null)
})

test('paciente diferente nunca e o mesmo pacote, mesmo no mesmo minuto', () => {
  const nova = v({ id: 'n', data_hora: '2026-08-25T12:00:00Z' })
  const outra = v({ id: 'o', data_hora: '2026-08-25T12:00:00Z', email: 'outro@x.com' })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [outra] }), null)
})

test('venda sem e-mail nao casa com ninguem: cruzar por nome ja deu falso positivo neste projeto', () => {
  const nova = v({ id: 'n', data_hora: '2026-08-25T12:00:00Z', email: null })
  const outra = v({ id: 'o', data_hora: '2026-08-25T13:00:00Z', email: null })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [outra] }), null)
})

test('venda que ja pertence a um pacote nao vira candidata de outro', () => {
  const nova = v({ id: 'n', data_hora: '2026-08-25T12:00:00Z' })
  const jaLigada = v({ id: 'o', data_hora: '2026-08-25T13:00:00Z', pacotePaiId: 'outro-pacote' })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [jaLigada] }), null)
})

test('com duas candidatas, escolhe a mais proxima no tempo', () => {
  const nova = v({ id: 'n', data_hora: '2026-08-25T12:00:00Z' })
  const perto = v({ id: 'perto', data_hora: '2026-08-25T14:00:00Z' })
  const longe = v({ id: 'longe', data_hora: '2026-08-25T30:00:00Z'.replace('T30','T23') })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [longe, perto] })?.id, 'perto')
})

test('a candidata pode ser ANTERIOR ou POSTERIOR', () => {
  const meio = v({ id: 'meio', data_hora: '2026-08-25T12:00:00Z' })
  const antes = v({ id: 'antes', data_hora: '2026-08-25T02:00:00Z' })
  assert.equal(candidataAoMesmoPacote({ venda: meio, outras: [antes] })?.id, 'antes')
})

test('data invalida nao quebra nem casa', () => {
  const nova = v({ id: 'n', data_hora: 'lixo' })
  const outra = v({ id: 'o', data_hora: '2026-08-25T12:00:00Z' })
  assert.equal(candidataAoMesmoPacote({ venda: nova, outras: [outra] }), null)
  assert.equal(candidataAoMesmoPacote({ venda: outra, outras: [nova] }), null)
})

test('sem outras vendas, nao ha candidata', () => {
  assert.equal(candidataAoMesmoPacote({ venda: v({ id: 'n', data_hora: '2026-08-25T12:00:00Z' }), outras: [] }), null)
})

test('vendasDoPacote junta a principal com as ligadas a ela', () => {
  const p = { id: 'principal', pacotePaiId: null }
  const todas = [p, { id: 'filha', pacotePaiId: 'principal' }, { id: 'outra', pacotePaiId: 'outro' }, { id: 'solta', pacotePaiId: null }]
  assert.deepEqual(vendasDoPacote(p, todas).map(x => x.id), ['principal', 'filha'])
})
