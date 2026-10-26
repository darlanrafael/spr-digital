import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDiagnostico } from './etiqueta-diagnostico'

test('rotulo mostra formato e posicao', () => {
  assert.equal(
    rotuloDiagnostico({ formato: 1, numeroSessao: 3, totalSessoes: 9 }),
    'Diagnóstico Guiado · Formato 1 · sessão 3 de 9',
  )
})

test('Formato 3 com duas sessoes', () => {
  assert.equal(
    rotuloDiagnostico({ formato: 3, numeroSessao: 1, totalSessoes: 2 }),
    'Diagnóstico Guiado · Formato 3 · sessão 1 de 2',
  )
})

// `continuidade` é OPCIONAL: só as telas do Pedro (overview/agenda) passam, pra
// ele ver de quem é a venda. O WhatsApp do paciente NÃO passa -> o texto do
// lembrete fica igual ao de antes.
test('sem continuidade: texto igual ao de antes (lembrete do paciente)', () => {
  assert.equal(
    rotuloDiagnostico({ formato: 1, numeroSessao: 3, totalSessoes: 9 }),
    'Diagnóstico Guiado · Formato 1 · sessão 3 de 9',
  )
})

test('com continuidade: anexa o nome de quem continua', () => {
  assert.equal(
    rotuloDiagnostico({ formato: 1, numeroSessao: 3, totalSessoes: 9, continuidade: 'Leomir' }),
    'Diagnóstico Guiado · Formato 1 · sessão 3 de 9 · continuidade: Leomir',
  )
})

test('continuidade null/vazia nao muda o texto', () => {
  assert.equal(
    rotuloDiagnostico({ formato: 1, numeroSessao: 3, totalSessoes: 9, continuidade: null }),
    'Diagnóstico Guiado · Formato 1 · sessão 3 de 9',
  )
})
