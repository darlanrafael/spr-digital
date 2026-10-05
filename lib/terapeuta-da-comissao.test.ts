import { test } from 'node:test'
import assert from 'node:assert/strict'
import { terapeutaDaComissao } from './terapeuta-da-comissao'

const DENISE = { nome: 'Denise Nascimento', percentual_comissao: 30 }
const PEDRO = { nome: 'Pedro Roncada', percentual_comissao: 0 }
const LEOMIR = { nome: 'Leomir Santos', percentual_comissao: 10 }

test('"Pedro | Leomir" -> Leomir (nao o Pedro socio 0%), mesmo com Pedro ANTES na lista', () => {
  // Esta e a ordem que quebrava a versao antiga (find pegava o Pedro primeiro).
  assert.deepEqual(terapeutaDaComissao('Mentoria Particular - Pedro | Leomir', [PEDRO, LEOMIR]), LEOMIR)
})

test('"Pedro | Denise" -> Denise', () => {
  assert.deepEqual(terapeutaDaComissao('Mentoria Particular - Pedro | Denise', [PEDRO, DENISE]), DENISE)
})

test('produto que nomeia SO o Pedro -> Pedro (0%, o chamador nao gera repasse)', () => {
  assert.deepEqual(terapeutaDaComissao('Mentoria Particular - Pedro Roncada', [DENISE, PEDRO, LEOMIR]), PEDRO)
})

test('produto que nomeia so a Denise -> Denise', () => {
  assert.deepEqual(terapeutaDaComissao('Mentoria Particular - Denise Nascimento', [DENISE, PEDRO, LEOMIR]), DENISE)
})

test('produto que nao nomeia ninguem -> null', () => {
  assert.equal(terapeutaDaComissao('Alianca Sagrada', [DENISE, PEDRO, LEOMIR]), null)
})
