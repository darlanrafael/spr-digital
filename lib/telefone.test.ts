import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarTelefoneBR } from './telefone'

// Todos os casos abaixo saíram da tabela `sales` em 17/08/2026, quando o
// usuário reportou que mensagem não chegava em número de fora do Brasil.

test('celular brasileiro sem código do país ganha o 55', () => {
  assert.equal(normalizarTelefoneBR('(11) 99198-6114'), '5511991986114')
  assert.equal(normalizarTelefoneBR('11991986114'), '5511991986114')
})

test('número que já vem completo não é alterado', () => {
  assert.equal(normalizarTelefoneBR('5511976411277'), '5511976411277')
  assert.equal(normalizarTelefoneBR('+55 11 97641-1277'), '5511976411277')
})

test('EUA/Canadá não recebe 55 na frente', () => {
  // O bug: +1 973 771-4399 tem 11 dígitos igual a um celular BR com DDD, e
  // virava 5519737714399 — número inexistente. A Z-API aceitava e a mensagem
  // sumia. Cinco pacientes com sessão agendada nunca receberam lembrete.
  assert.equal(normalizarTelefoneBR('+19737714399'), '19737714399') // Fernanda Lima
  assert.equal(normalizarTelefoneBR('+19548122342'), '19548122342') // Camila Queiroz
  assert.equal(normalizarTelefoneBR('+12014234188'), '12014234188') // Fabiano Souza
  assert.equal(normalizarTelefoneBR('+17747078167'), '17747078167') // Ana Assis
  assert.equal(normalizarTelefoneBR('+12677613457'), '12677613457') // Giselle Ildefonso
})

test('"+" sem código do país continua sendo tratado como brasileiro', () => {
  // Metade da base tem "+" sem o 55. Confiar no "+" pra decidir quebraria
  // esses números, que hoje funcionam — foi a primeira hipótese, descartada
  // ao conferir os dados.
  assert.equal(normalizarTelefoneBR('+64999067729'), '5564999067729') // DDD 64, Goiás
  assert.equal(normalizarTelefoneBR('+11948498485'), '5511948498485') // DDD 11, SP
  assert.equal(normalizarTelefoneBR('+17992585665'), '5517992585665') // DDD 17, Rio Preto
  assert.equal(normalizarTelefoneBR('+81982203024'), '5581982203024') // DDD 81, PE
})

test('DDD 55 (Rio Grande do Sul) não é confundido com código do país', () => {
  assert.equal(normalizarTelefoneBR('+55986837406'), '5555986837406')
})

test('número com 11 dígitos começando em 1 mas com DDD válido e 9 é brasileiro', () => {
  // "17992585665": DDD 17 + 9 + 8 dígitos. O 9 na terceira posição é o que
  // separa do +1 americano, que nunca tem 9 ali.
  assert.equal(normalizarTelefoneBR('17992585665'), '5517992585665')
  assert.equal(normalizarTelefoneBR('12991234567'), '5512991234567')
})

test('estrangeiro com 12+ dígitos passa direto', () => {
  assert.equal(normalizarTelefoneBR('+351912345678'), '351912345678') // Portugal
  assert.equal(normalizarTelefoneBR('+595981123456'), '595981123456') // Paraguai
})

test('fixo brasileiro sem código do país ganha o 55', () => {
  assert.equal(normalizarTelefoneBR('(11) 3255-4400'), '551132554400')
})

test('vazio e lixo devolvem null', () => {
  assert.equal(normalizarTelefoneBR(''), null)
  assert.equal(normalizarTelefoneBR(null), null)
  assert.equal(normalizarTelefoneBR(undefined), null)
  assert.equal(normalizarTelefoneBR('sem número'), null)
})

test('caso ambíguo mantém o comportamento antigo em vez de deixar de enviar', () => {
  // "+4790072134": pode ser celular antigo de Santa Catarina (DDD 47) ou
  // celular da Noruega (código 47). Sem como decidir, preserva o que já
  // acontecia — não vale arriscar parar de enviar pra quem talvez receba.
  assert.equal(normalizarTelefoneBR('+4790072134'), '554790072134')
})
