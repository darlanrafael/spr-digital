import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normTs, brtDayRangeToUTC, kiwifyBrtRange } from './datas-da-plataforma'

// Estas tres funcoes viviam dentro de `lib/services.ts` sem `export`, e por
// isso nenhum teste as alcancava. Sao 639 linhas, o maior modulo do projeto,
// sem um unico teste - e sao elas que decidem a data de TODA venda em Vendas,
// Fechamentos, DRE e Analises.

// ── normTs: a diferenca entre Hubla e Kiwify ────────────────────────────────
test('HUBLA: UTC de verdade vira hora de Brasilia (menos 3 horas)', () => {
  assert.equal(normTs('2026-09-15T18:00:00+00:00'), '2026-09-15T15:00:00')
  assert.equal(normTs('2026-09-15T18:00:00Z'), '2026-09-15T15:00:00')
})

test('KIWIFY: o sufixo +00:00 e mentira, e a hora fica como esta', () => {
  // A Kiwify grava hora de Brasilia COM sufixo de UTC. Subtrair 3h aqui
  // deslocaria a venda para tras sem motivo.
  assert.equal(normTs('2026-09-15T18:00:00+00:00', true), '2026-09-15T18:00:00')
})

test('O CASO QUE MOTIVA A REGRA: venda da Kiwify entre 00:00 e 02:59', () => {
  // Venda feita 01:30 da manha em Brasilia. Tratada como UTC, viraria 22:30 do
  // DIA ANTERIOR - e a venda sairia do periodo em todo filtro do sistema, indo
  // parar no mes anterior quando cai em dia 1.
  assert.equal(normTs('2026-09-01T01:30:00+00:00', true), '2026-09-01T01:30:00')

  const comoSeFosseHubla = normTs('2026-09-01T01:30:00+00:00', false)
  assert.equal(comoSeFosseHubla, '2026-08-31T22:30:00', 'e isto que o defeito faria: mes anterior')
})

test('o retorno tem 19 caracteres e NAO tem fuso', () => {
  // Hora de parede de Brasilia, para a tela. E o motivo de nao poder ser
  // comparada como texto com `data_confirmacao`, que vem em UTC com fracao -
  // o erro que prendeu R$ 3.181,85 (item 67 do MD).
  const r = normTs('2026-09-15T18:00:00.123456+00:00')
  assert.equal(r.length, 19)
  assert.ok(!r.includes('+') && !r.endsWith('Z'), 'nao pode sobrar fuso')
  assert.equal(r, '2026-09-15T15:00:00')
})

test('data sem fuso nenhum e apenas cortada, nao convertida', () => {
  assert.equal(normTs('2026-09-15T18:00:00'), '2026-09-15T18:00:00')
  assert.equal(normTs('2026-09-15T18:00:00.999'), '2026-09-15T18:00:00')
})

test('vazio, nulo e indefinido devolvem texto vazio', () => {
  assert.equal(normTs(''), '')
  assert.equal(normTs(null), '')
  assert.equal(normTs(undefined), '')
})

test('data invalida com sufixo NAO e convertida - cai no corte', () => {
  // `new Date` daria NaN; a funcao tem guarda para isso e devolve o texto
  // cortado, em vez de "Invalid Date".
  assert.equal(normTs('abacaxi+00:00'), 'abacaxi+00:00')
})

test('VIRADA DE DIA: 02:00 UTC e ainda o dia anterior em Brasilia', () => {
  assert.equal(normTs('2026-09-16T02:00:00Z'), '2026-09-15T23:00:00')
})

test('VIRADA DE ANO: 01/01 as 01:00 UTC e 31/12 em Brasilia', () => {
  assert.equal(normTs('2027-01-01T01:00:00Z'), '2026-12-31T22:00:00')
})

// ── brtDayRangeToUTC: o dia de Brasilia em limites UTC (HUBLA) ──────────────
test('o dia D em Brasilia vai de D 03:00 a (D+1) 02:59:59 em UTC', () => {
  const r = brtDayRangeToUTC('2026-09-15')
  assert.equal(r.startUTC, '2026-09-15T03:00:00')
  assert.equal(r.endUTC, '2026-09-16T02:59:59')
})

test('VIRADA DE MES: o fim do dia 30/09 cai em 01/10', () => {
  // O comentario do codigo diz que o +1 dia e feito via Date UTC justamente
  // para isto. Somar 1 ao texto do dia daria "2026-09-31", que nao existe.
  const r = brtDayRangeToUTC('2026-09-30')
  assert.equal(r.endUTC, '2026-10-01T02:59:59')
})

test('VIRADA DE ANO: o fim do dia 31/12 cai em 01/01 do ano seguinte', () => {
  const r = brtDayRangeToUTC('2026-12-31')
  assert.equal(r.endUTC, '2027-01-01T02:59:59')
})

test('ANO BISSEXTO: 28/02/2028 tem 29/02 depois, nao 01/03', () => {
  // 2028 e bissexto. Uma conta de calendario feita a mao erraria aqui.
  assert.equal(brtDayRangeToUTC('2028-02-28').endUTC, '2028-02-29T02:59:59')
  assert.equal(brtDayRangeToUTC('2028-02-29').endUTC, '2028-03-01T02:59:59')
})

test('ANO NAO BISSEXTO: 28/02/2026 vai direto para 01/03', () => {
  assert.equal(brtDayRangeToUTC('2026-02-28').endUTC, '2026-03-01T02:59:59')
})

// ── kiwifyBrtRange: o dia de Brasilia como esta gravado (KIWIFY) ────────────
test('para a Kiwify o dia e o dia, de 00:00:00 a 23:59:59', () => {
  const r = kiwifyBrtRange('2026-09-15')
  assert.equal(r.start, '2026-09-15T00:00:00')
  assert.equal(r.end, '2026-09-15T23:59:59')
})

test('a faixa da Kiwify NAO desloca na virada de mes', () => {
  // Nao ha conversao: o campo ja esta em hora de Brasilia.
  const r = kiwifyBrtRange('2026-09-30')
  assert.equal(r.start, '2026-09-30T00:00:00')
  assert.equal(r.end, '2026-09-30T23:59:59')
})

// ── as duas faixas juntas ───────────────────────────────────────────────────
test('as duas faixas do MESMO dia NAO coincidem, e e assim que tem de ser', () => {
  // E por isso que a consulta usa a mais larga das duas e filtra depois: cada
  // plataforma guarda o campo num referencial diferente. Se as faixas fossem
  // iguais, uma das duas estaria errada.
  const hubla = brtDayRangeToUTC('2026-09-15')
  const kiwify = kiwifyBrtRange('2026-09-15')
  assert.notEqual(hubla.startUTC, kiwify.start)
  assert.ok(hubla.endUTC > kiwify.end, 'o fim da Hubla e o mais tardio dos dois')
})
