// lib/identidade-da-chamada.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerIdentidade, terapeutaIdQueValeu, podeAdministrar, deveEsconderDivisaoDeSocios,
  type Identidade,
} from './identidade-da-chamada'

import { CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'

const req = (cabecalhos: Record<string, string>) =>
  new Request('https://x/api/y', { headers: cabecalhos })

test('o teste usa os MESMOS nomes de cabecalho que o middleware escreve', () => {
  // Trava a ligacao entre os dois lados. Sem isto, o teste poderia passar com
  // um nome que o middleware nao escreve, e a identidade sumiria em producao.
  assert.equal(CABECALHOS_DA_IDENTIDADE.tipo, 'x-spr-quem-tipo')
  assert.equal(CABECALHOS_DA_IDENTIDADE.id, 'x-spr-quem-id')
  assert.equal(CABECALHOS_DA_IDENTIDADE.email, 'x-spr-quem-email')
  assert.equal(CABECALHOS_DA_IDENTIDADE.terapeutaId, 'x-spr-quem-terapeuta-id')
})

const ID_DENISE = 'c3d598b0-2e43-4376-9492-9176169befe5'
const ID_PEDRO = 'f5b18738-fe04-43e0-a6ac-d15768cf196c'

const terapeuta = (terapeutaId: string): Identidade =>
  ({ area: 'sistema', papel: 'terapeuta', id: 'u1', email: 'a@b.c', terapeutaId })
const comercial: Identidade = { area: 'sistema', papel: 'comercial', id: 'u2', email: 'a@b.c', terapeutaId: null }
const adminSistema: Identidade = { area: 'sistema', papel: 'admin', id: 'u3', email: 'a@b.c', terapeutaId: null }
const adminDre: Identidade = { area: 'dashboard', papel: 'admin', id: 'u4', email: 'a@b.c', terapeutaId: null }
const socio: Identidade = { area: 'dashboard', papel: 'socio', id: 'u5', email: 'a@b.c', terapeutaId: null }

test('sem os cabecalhos do middleware, nao ha identidade', () => {
  assert.equal(lerIdentidade(req({})), null)
})

test('falta so o tipo, tambem nao ha identidade', () => {
  // Distingue de "faltam os dois": se so o `||` virasse `&&` aqui, este caso
  // seguiria adiante e tentaria fazer split(':') de um tipo nulo.
  assert.equal(lerIdentidade(req({ 'x-spr-quem-id': 'u1' })), null)
})

test('falta so o id, tambem nao ha identidade', () => {
  assert.equal(lerIdentidade(req({ 'x-spr-quem-tipo': 'sistema:terapeuta' })), null)
})

test('le a identidade que o middleware escreveu', () => {
  const i = lerIdentidade(req({
    'x-spr-quem-tipo': 'sistema:terapeuta',
    'x-spr-quem-id': 'u1',
    'x-spr-quem-email': 'denise@x.com',
    'x-spr-quem-terapeuta-id': ID_DENISE,
  }))
  assert.deepEqual(i, { area: 'sistema', papel: 'terapeuta', id: 'u1', email: 'denise@x.com', terapeutaId: ID_DENISE })
})

test('le identidade da area dashboard tambem, nao so sistema', () => {
  // Sem este caso, uma inversao no segundo `!==` (que rejeita `dashboard`
  // junto com qualquer coisa que nao seja `sistema` nem `dashboard`) passaria
  // batido: todos os outros testes desta funcao usam area sistema.
  const i = lerIdentidade(req({
    'x-spr-quem-tipo': 'dashboard:socio',
    'x-spr-quem-id': 'u5',
  }))
  assert.deepEqual(i, { area: 'dashboard', papel: 'socio', id: 'u5', email: '', terapeutaId: null })
})

test('CRITICO: terapeuta pedindo "all" recebe o proprio, nao todos', () => {
  // E o furo que motivou o trabalho inteiro: hoje a rota obedece o parametro do
  // cliente, e a Denise pedindo all recebe o faturamento do Pedro.
  assert.equal(terapeutaIdQueValeu(terapeuta(ID_DENISE), 'all'), ID_DENISE)
})

test('CRITICO: terapeuta pedindo o id de OUTRA recebe o proprio', () => {
  assert.equal(terapeutaIdQueValeu(terapeuta(ID_DENISE), ID_PEDRO), ID_DENISE)
})

test('terapeuta sem pedir nada recebe o proprio', () => {
  assert.equal(terapeutaIdQueValeu(terapeuta(ID_DENISE), null), ID_DENISE)
})

test('admin e comercial continuam podendo pedir qualquer um, inclusive all', () => {
  // O comercial agenda para as duas terapeutas: restringir aqui quebraria o dia
  // a dia dele.
  assert.equal(terapeutaIdQueValeu(adminSistema, 'all'), 'all')
  assert.equal(terapeutaIdQueValeu(comercial, ID_PEDRO), ID_PEDRO)
  assert.equal(terapeutaIdQueValeu(adminDre, 'all'), 'all')
})

test('o socio do DRE nao e restringido no modulo de terapeutas', () => {
  // Decisao do usuario: ele fica exatamente com a visualizacao de hoje.
  assert.equal(terapeutaIdQueValeu(socio, 'all'), 'all')
})

test('terapeutaId so vale quando area E papel tambem sao terapeuta', () => {
  // O tipo permite terapeutaId em qualquer Identidade (o middleware hoje so
  // preenche para terapeuta, mas a funcao e pura e nao pode confiar nisso).
  // Sem este teste, um `&&` virando `||` aqui passaria batido: os outros
  // papeis do teste todos tem terapeutaId null, entao nunca exercitam a
  // diferenca entre "E" e "OU".
  const comercialComTerapeutaId: Identidade = {
    area: 'sistema', papel: 'comercial', id: 'u2', email: 'a@b.c', terapeutaId: ID_PEDRO,
  }
  assert.equal(terapeutaIdQueValeu(comercialComTerapeutaId, 'all'), 'all')
})

test('so admin administra: comercial e terapeuta NAO', () => {
  assert.equal(podeAdministrar(adminSistema), true)
  assert.equal(podeAdministrar(adminDre), true)
  assert.equal(podeAdministrar(comercial), false)
  assert.equal(podeAdministrar(terapeuta(ID_DENISE)), false)
  assert.equal(podeAdministrar(socio), false)
})

test('a divisao entre socios some SO para o socio', () => {
  assert.equal(deveEsconderDivisaoDeSocios(socio), true)
  assert.equal(deveEsconderDivisaoDeSocios(adminDre), false)
  assert.equal(deveEsconderDivisaoDeSocios(adminSistema), false)
  assert.equal(deveEsconderDivisaoDeSocios(comercial), false)
})
