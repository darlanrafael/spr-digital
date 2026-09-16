// lib/cracha.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarCracha, crachaVencido, precisaRenovar, DIAS_DE_VALIDADE } from './cracha'

const DIA = 24 * 60 * 60 * 1000

test('o cracha gerado tem texto aleatorio longo e validade de 30 dias', () => {
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  const c = gerarCracha(agora)
  assert.equal(c.token.length, 64, 'sao 32 bytes em hexadecimal')
  assert.match(c.token, /^[0-9a-f]{64}$/)
  assert.equal(c.expiraEm, new Date(agora + DIAS_DE_VALIDADE * DIA).toISOString())
})

test('dois crachas gerados NUNCA sao iguais', () => {
  // Se repetissem, uma pessoa entraria na conta de outra.
  const vistos = new Set<string>()
  for (let i = 0; i < 500; i++) vistos.add(gerarCracha().token)
  assert.equal(vistos.size, 500)
})

test('cracha sem validade conta como vencido', () => {
  // Linha antiga, de antes desta mudanca. Na duvida, recusa.
  assert.equal(crachaVencido(null), true)
  assert.equal(crachaVencido(undefined), true)
  assert.equal(crachaVencido(''), true)
})

test('FRONTEIRA: no instante EXATO do vencimento, o cracha ja nao vale', () => {
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  const expira = new Date(agora).toISOString()
  assert.equal(crachaVencido(expira, agora), true, 'vencer no mesmo instante e vencido')
  assert.equal(crachaVencido(new Date(agora + 1000).toISOString(), agora), false, 'um segundo a mais ainda vale')
})

test('precisaRenovar so quando falta menos de 15 dias', () => {
  // Evita escrever no banco a cada acao: na pratica uma escrita a cada ~15 dias.
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  assert.equal(precisaRenovar(new Date(agora + 20 * DIA).toISOString(), agora), false)
  assert.equal(precisaRenovar(new Date(agora + 10 * DIA).toISOString(), agora), true)
  assert.equal(precisaRenovar(new Date(agora + 15 * DIA + 1000).toISOString(), agora), false, 'faltando mais de 15 dias, nao renova')
})

test('FRONTEIRA de renovacao: faltando EXATAMENTE 15 dias ainda NAO renova', () => {
  // Trava a diferenca entre `<` e `<=` no limiar. Teste de mutacao de 15/09/2026
  // mostrou que sem isto trocar `<` por `<=` passava despercebido - um dia a
  // mais de escrita no banco por usuario, em silencio.
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  assert.equal(precisaRenovar(new Date(agora + 15 * DIA).toISOString(), agora), false, 'exatamente 15 dias: ainda nao')
  assert.equal(precisaRenovar(new Date(agora + 15 * DIA - 1000).toISOString(), agora), true, 'um segundo abaixo de 15 dias: renova')
})

test('cracha ja vencido NAO pede renovacao - pede login', () => {
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  assert.equal(precisaRenovar(new Date(agora - DIA).toISOString(), agora), false)
})
test('data INVALIDA conta como vencida (crachaVencido) e nao renova (precisaRenovar)', () => {
  // O mutante da mutacao: `Number.isNaN(t)) return true/false`. Uma data
  // corrompida no banco nao pode virar cracha valido nem pedir renovacao.
  const lixo = 'nao-e-data'
  assert.equal(crachaVencido(lixo), true, 'data quebrada = vencida')
  assert.equal(precisaRenovar(lixo), false, 'data quebrada nao renova')
})

test('precisaRenovar com validade VAZIA nao renova', () => {
  // `!expiraEm) return false`: sem validade gravada, nao ha o que renovar.
  assert.equal(precisaRenovar(null), false)
  assert.equal(precisaRenovar(undefined), false)
  assert.equal(precisaRenovar(''), false)
})
