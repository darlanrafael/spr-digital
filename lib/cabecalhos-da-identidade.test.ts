import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CABECALHO_DO_CRACHA, CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'

// Modulo so de constantes. O risco nao e logica, e COLISAO de nomes: se dois
// cabecalhos tiverem o mesmo texto, ou se um deles bater com o do cracha, a
// identidade se confunde. Estes testes atacam exatamente isso.

test('os nomes travados (mudar aqui exige mudar middleware, fetch e testes juntos)', () => {
  assert.equal(CABECALHO_DO_CRACHA, 'x-spr-cracha')
  assert.equal(CABECALHOS_DA_IDENTIDADE.tipo, 'x-spr-quem-tipo')
  assert.equal(CABECALHOS_DA_IDENTIDADE.id, 'x-spr-quem-id')
  assert.equal(CABECALHOS_DA_IDENTIDADE.terapeutaId, 'x-spr-quem-terapeuta-id')
  assert.equal(CABECALHOS_DA_IDENTIDADE.email, 'x-spr-quem-email')
})

test('ATAQUE: nenhum cabecalho de identidade colide com outro', () => {
  const nomes = Object.values(CABECALHOS_DA_IDENTIDADE)
  assert.equal(new Set(nomes).size, nomes.length, 'ha nomes repetidos - identidade se confunde')
})

test('ATAQUE: o cabecalho do cracha NAO colide com os de identidade', () => {
  // Se o cracha usasse o mesmo nome de um campo de identidade, o middleware
  // apagaria o cracha ao limpar a identidade, ou vice-versa.
  const nomes = Object.values(CABECALHOS_DA_IDENTIDADE) as string[]
  assert.ok(!nomes.includes(CABECALHO_DO_CRACHA), 'o cracha colide com um campo de identidade')
})

test('ATAQUE: todos os nomes sao minusculos (HTTP normaliza para minusculo)', () => {
  // Se um nome viesse com maiuscula, o `.get()` do Headers ainda acha (case
  // insensitive), mas o `.delete()` por outro caminho poderia nao bater.
  // Manter tudo minusculo tira essa classe de bug.
  const todos = [CABECALHO_DO_CRACHA, ...Object.values(CABECALHOS_DA_IDENTIDADE)]
  for (const n of todos) assert.equal(n, n.toLowerCase(), `"${n}" tem maiuscula`)
})

test('ATAQUE: todos comecam com o prefixo x-spr- (namespace proprio, nao colide com cabecalho padrao)', () => {
  const todos = [CABECALHO_DO_CRACHA, ...Object.values(CABECALHOS_DA_IDENTIDADE)]
  for (const n of todos) assert.match(n, /^x-spr-/, `"${n}" fora do namespace x-spr-`)
})
