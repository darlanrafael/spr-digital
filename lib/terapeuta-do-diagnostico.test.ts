import { test } from 'node:test'
import assert from 'node:assert/strict'
import { terapeutaPrincipalDoDiagnostico } from './terapeuta-do-diagnostico'

const DENISE = { id: 'denise-id', nome: 'Denise Nascimento' }
const LEOMIR = { id: 'leomir-id', nome: 'Leomir Santos' }
const PEDRO = { id: 'pedro-id', nome: 'Pedro Roncada' }
const JOANA = { id: 'joana-id', nome: 'Joana Lima' }

const PRODUTO_DENISE = 'Diagnóstico Guiado: Programa de acompanhamento Individual'
const PRODUTO_LEOMIR = 'Diagnóstico Guiado: Programa de acompanhamento Individual - Leomir'

test('produto COM nome -> esse terapeuta (Leomir)', () => {
  const r = terapeutaPrincipalDoDiagnostico(PRODUTO_LEOMIR, [DENISE, LEOMIR, PEDRO])
  assert.deepEqual(r, { terapeuta: LEOMIR, ambiguo: false })
})

test('produto SEM nome -> Denise (default historico)', () => {
  const r = terapeutaPrincipalDoDiagnostico(PRODUTO_DENISE, [DENISE, LEOMIR, PEDRO])
  assert.deepEqual(r, { terapeuta: DENISE, ambiguo: false })
})

test('o nome do Pedro no produto NAO o torna o principal: cai no default Denise', () => {
  const r = terapeutaPrincipalDoDiagnostico(PRODUTO_DENISE + ' Pedro', [DENISE, PEDRO])
  assert.deepEqual(r, { terapeuta: DENISE, ambiguo: false })
})

test('produto nomeia dois terapeutas nao-Pedro -> ambiguo', () => {
  const r = terapeutaPrincipalDoDiagnostico(PRODUTO_DENISE + ' - Leomir Joana', [DENISE, LEOMIR, JOANA, PEDRO])
  assert.deepEqual(r, { terapeuta: null, ambiguo: true })
})

test('sem nome no produto e sem Denise na lista -> terapeuta null (chamador recusa)', () => {
  const r = terapeutaPrincipalDoDiagnostico(PRODUTO_DENISE, [LEOMIR, PEDRO])
  assert.deepEqual(r, { terapeuta: null, ambiguo: false })
})

test('produto sem nome com DUAS Denise ativas -> ambiguo (preserva a guarda antiga)', () => {
  const OUTRA_DENISE = { id: 'denise-2', nome: 'Denise Souza' }
  const r = terapeutaPrincipalDoDiagnostico(PRODUTO_DENISE, [DENISE, OUTRA_DENISE, PEDRO])
  assert.deepEqual(r, { terapeuta: null, ambiguo: true })
})
