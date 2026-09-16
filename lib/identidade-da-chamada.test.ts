// lib/identidade-da-chamada.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerIdentidade, terapeutaIdQueValeu, podeAdministrar, deveEsconderDivisaoDeSocios,
  semDivisaoDeSocios,
  podeEditarFechamento, podeEditarCaixa, podeEditarCustos,
  podeMexerEmVenda,
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

const terapeuta = (terapeutaId: string | null): Identidade =>
  ({ area: 'sistema', papel: 'terapeuta', id: 'u1', email: 'a@b.c', terapeutaId })
const comercial: Identidade = { area: 'sistema', papel: 'comercial', id: 'u2', email: 'a@b.c', terapeutaId: null }
const adminSistema: Identidade = { area: 'sistema', papel: 'admin', id: 'u3', email: 'a@b.c', terapeutaId: null }
const adminDre: Identidade = { area: 'dashboard', papel: 'admin', id: 'u4', email: 'a@b.c', terapeutaId: null }
const socio: Identidade = { area: 'dashboard', papel: 'socio', id: 'u5', email: 'a@b.c', terapeutaId: null }
const financeiro: Identidade = { area: 'dashboard', papel: 'financeiro', id: 'u6', email: 'a@b.c', terapeutaId: null }

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

test('CRITICO: terapeuta SEM terapeutaId (cadastro incompleto) nao vaza para todo mundo', () => {
  // O guarda tinha `&& id.terapeutaId` so para o TypeScript estreitar
  // string|null -> string. Efeito colateral perigoso: terapeuta_id nulo
  // (campo e string|null no banco - cadastro incompleto, erro de vinculo)
  // caia fora do `if` e ia para `pedido ?? 'all'`, obedecendo o parametro do
  // cliente. Uma terapeuta sem vinculo pedindo 'all' recebia o faturamento de
  // TODO MUNDO - o mesmo furo que este modulo existe para fechar, reaberto
  // na direcao fail-OPEN. A regra certa fail-CLOSED: sem id proprio, nao ve
  // nada, nunca 'all' e nunca o id de outra pessoa.
  const semVinculo = terapeuta(null)
  const resultado = terapeutaIdQueValeu(semVinculo, 'all')
  assert.notEqual(resultado, 'all')
  assert.notEqual(resultado, ID_PEDRO)
  assert.equal(resultado, '')
})

test('CRITICO: terapeuta SEM terapeutaId pedindo o id de OUTRA tambem nao recebe', () => {
  const semVinculo = terapeuta(null)
  const resultado = terapeutaIdQueValeu(semVinculo, ID_PEDRO)
  assert.notEqual(resultado, ID_PEDRO)
  assert.equal(resultado, '')
})

test('terapeuta com terapeutaId vazio (string, nao null) tambem cai no sentinela', () => {
  // A mesma falha de dado pode chegar como '' em vez de null (ex.: header
  // vazio). O sentinela e o mesmo para os dois - ambos sao "sem vinculo".
  const vazio = terapeuta('')
  assert.equal(terapeutaIdQueValeu(vazio, 'all'), '')
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

test('semDivisaoDeSocios tira os valores e mantem o resto do fechamento', () => {
  const fechamentos = [{
    id: 'close_1', lucroReal: 5863.44, faturamentoBruto: 90000,
    socios: [
      { nome: 'SPR DIGITAL LTDA', valor: 2931.72, repasse_final: 2931.72 },
      { nome: 'Pedro Roncada', valor: 2931.72, repasse_final: 2931.72 },
    ],
  }]
  const limpo = semDivisaoDeSocios(fechamentos)
  assert.equal(limpo[0].id, 'close_1', 'o resto do fechamento continua la')
  assert.equal(limpo[0].lucroReal, 5863.44, 'o lucro real ele ve - so a divisao some')
  assert.deepEqual(limpo[0].socios, [], 'a divisao entre socios sai')
})

test('semDivisaoDeSocios nao quebra com fechamento sem socios', () => {
  // `socios: undefined` e nao `{ id: 'x' }` puro: o generico e
  // `T extends { socios?: unknown[] }`, e no modo estrito um objeto sem a chave
  // `socios` nao casa com o tipo - reprova no `tsc --noEmit`, que e portao de
  // commit. Com a chave presente (mesmo undefined), casa. Provado em 15/09/2026.
  assert.deepEqual(
    semDivisaoDeSocios([{ id: 'x', socios: undefined }]),
    [{ id: 'x', socios: [] }],
  )
})

test('semDivisaoDeSocios NAO altera o original', () => {
  // Se alterasse, o mesmo objeto voltaria vazio para o admin na chamada seguinte.
  const original = [{ id: 'c', socios: [{ nome: 'A', valor: 1 }] }]
  semDivisaoDeSocios(original)
  assert.equal(original[0].socios.length, 1)
})

test('as regras de edicao copiam EXATAMENTE o que a tela ja faz hoje', () => {
  // app/fechamentos/page.tsx:237 e app/caixa/page.tsx:55 -> canEdit = admin
  assert.equal(podeEditarFechamento(adminDre), true)
  assert.equal(podeEditarFechamento(socio), false)
  assert.equal(podeEditarCaixa(adminDre), true)
  assert.equal(podeEditarCaixa(socio), false)
  assert.equal(podeEditarCaixa(financeiro), false, 'a tela do caixa so libera admin')

  // app/dre/page.tsx:61 -> canEdit = admin || financeiro
  assert.equal(podeEditarCustos(adminDre), true)
  assert.equal(podeEditarCustos(financeiro), true)
  assert.equal(podeEditarCustos(socio), false)
})

test('usuario do modulo de terapeutas nao edita dinheiro do DRE', () => {
  // Sao duas areas separadas. Comercial nao mexe em fechamento da empresa.
  assert.equal(podeEditarFechamento(comercial), false)
  assert.equal(podeEditarCaixa(comercial), false)
  assert.equal(podeEditarCustos(terapeuta(ID_DENISE)), false)
})

test('sistema:admin (admin do modulo de terapeutas) nao edita dinheiro do DRE', () => {
  // O caso mais sensivel: adminSistema tem papel 'admin', igual adminDre - se
  // a checagem fosse so `papel === 'admin'` sem exigir `area === 'dashboard'`,
  // este admin do OUTRO sistema editaria fechamento/caixa/custo da empresa.
  assert.equal(podeEditarFechamento(adminSistema), false)
  assert.equal(podeEditarCaixa(adminSistema), false)
  assert.equal(podeEditarCustos(adminSistema), false)
})

test('PROVADO EM PRODUCAO: terapeuta NAO altera venda nem converte moeda', () => {
  // Testado com a credencial real da Denise: PATCH /api/sales respondeu 200
  // "success", e converter-moeda passou pela permissao (404 so por id falso).
  assert.equal(podeMexerEmVenda(terapeuta(ID_DENISE)), false)
})

test('comercial e admin mexem em venda; terapeuta e socio nao', () => {
  // O comercial trabalha com a venda; o socio e leitura no DRE.
  assert.equal(podeMexerEmVenda(comercial), true)
  assert.equal(podeMexerEmVenda(adminSistema), true)
  assert.equal(podeMexerEmVenda(adminDre), true)
  assert.equal(podeMexerEmVenda(socio), false)
})
