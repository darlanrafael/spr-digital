// lib/sessao-do-terapeuta.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { podeAgirNaSessao } from './sessao-do-terapeuta'
import type { Identidade } from './identidade-da-chamada'

const ID_DENISE = 'c3d598b0-2e43-4376-9492-9176169befe5'
const ID_PEDRO = 'f5b18738-fe04-43e0-a6ac-d15768cf196c'

const denise: Identidade = { area: 'sistema', papel: 'terapeuta', id: 'u1', email: 'd@x.com', terapeutaId: ID_DENISE }
const comercial: Identidade = { area: 'sistema', papel: 'comercial', id: 'u2', email: 'c@x.com', terapeutaId: null }
const adminSistema: Identidade = { area: 'sistema', papel: 'admin', id: 'u3', email: 'a@x.com', terapeutaId: null }
const socio: Identidade = { area: 'dashboard', papel: 'socio', id: 'u5', email: 's@x.com', terapeutaId: null }

test('a terapeuta age na PROPRIA sessao', () => {
  assert.equal(podeAgirNaSessao(denise, ID_DENISE), true)
})

test('CRITICO: a terapeuta NAO age na sessao de outra', () => {
  assert.equal(podeAgirNaSessao(denise, ID_PEDRO), false)
})

test('comercial e admin agem em qualquer sessao', () => {
  // O comercial agenda e remarca para as duas: e o trabalho dele.
  assert.equal(podeAgirNaSessao(comercial, ID_PEDRO), true)
  assert.equal(podeAgirNaSessao(adminSistema, ID_DENISE), true)
})

test('o socio do DRE nao e restringido - fica como hoje', () => {
  assert.equal(podeAgirNaSessao(socio, ID_PEDRO), true)
})

test('sessao sem terapeuta definido NAO e liberada para terapeuta', () => {
  // Dado incompleto nao pode virar porta: na duvida, recusa.
  assert.equal(podeAgirNaSessao(denise, null), false)
  assert.equal(podeAgirNaSessao(comercial, null), true, 'para o comercial segue liberado')
})
