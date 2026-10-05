import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destinoDaListaDeTerapeutas } from './acesso-lista-terapeutas'

const PEDRO_ID = 'f5b18738-fe04-43e0-a6ac-d15768cf196c'
const SESSAO_TERAPEUTA = { tipo: 'terapeuta', terapeuta_id: PEDRO_ID }

test('admin + sessão de terapeuta -> NÃO redireciona (o bug do Pedro)', () => {
  // Pedro é admin no dashboard E terapeuta (mesmo email, duas contas). O layout
  // já o libera; a lista tem que fazer igual, senão o expulsa da lista.
  assert.equal(destinoDaListaDeTerapeutas(true, SESSAO_TERAPEUTA), null)
})

test('terapeuta puro (sem admin) -> redireciona pro próprio painel', () => {
  assert.equal(destinoDaListaDeTerapeutas(false, SESSAO_TERAPEUTA), `/terapeutas/${PEDRO_ID}`)
})

test('sem sessão nenhuma -> não redireciona', () => {
  assert.equal(destinoDaListaDeTerapeutas(false, null), null)
})

test('sessão comercial (não terapeuta) -> não redireciona', () => {
  assert.equal(destinoDaListaDeTerapeutas(false, { tipo: 'comercial', terapeuta_id: null }), null)
})

test('sessão de terapeuta sem terapeuta_id -> não redireciona', () => {
  assert.equal(destinoDaListaDeTerapeutas(false, { tipo: 'terapeuta', terapeuta_id: null }), null)
})

test('admin sem sessão de terapeuta -> não redireciona', () => {
  assert.equal(destinoDaListaDeTerapeutas(true, null), null)
})
