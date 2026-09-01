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
