import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizar, filtrarProdutos, comOsVisiveisMarcados, semOsVisiveis } from './busca-de-produto'

// Os nomes REAIS que aparecem na tela do fechamento, copiados da producao.
const PRODUTOS = [
  'ACESSO VITALÍCIO - CCC', 'ACESSO VITALÍCIO - CSP', 'ALIANÇA SAGRADA - CSP',
  'Aliança Sagrada - Tudo que a bíblia fala sobre o casamento',
  'COMBO - OS PRIMEIROS PASSOS DA RESTAURAÇÃO - CSP', 'COMO SER PERDOADO',
  'Combo: Primeiros Passos da Restauração - OB', 'Combo: Primeiros Passos da Restauração - OB - CCC',
  'Como convencer seu cônjuge', 'Diagnóstico Guiado: Programa de acompanhamento Individual',
  'Entrada resgate', 'FORMAÇÃO DE TERAPEUTAS EM RESTAURAÇÃO DE CASAMENTO',
  'Gravação - Imersão A reaproximação', 'Guia prático - Anti-brigas - OB',
  'IImersão - A Reaproximação - Oficial', 'Imersão - A reaproximação',
  'MENTORIA EM GRUPO - PEDRO RONCADA', 'Mentoria - Individual Pedro Roncada',
  'Mentoria Individual - Denise', 'Mentoria Particular - Pedro Roncada',
  'Mentoria Particular - Pedro | Denise', 'Mentoria em grupo- Pedro Roncada',
  'O Que fazer Após a traição? OB', 'O RESGATE', 'Quando um só quer',
  'Restauração a dois', 'Combo: Primeiros Passos da Restauração - OB - imersão',
  'Gravação da Imersão - A Reaproximação - OB Imersão',
  'Guia prático - Anti-brigas - OB Imersão', 'O Que fazer Após a traição? OB - Imersão', 'O Resgate',
].map(nome => ({ id: nome, nome }))

test('acha sem acento, que e como a pessoa digita', () => {
  // O motivo do modulo existir: sem isto, "diagnostico" nao acha nada e o
  // usuario conclui que o produto sumiu.
  const r = filtrarProdutos(PRODUTOS, 'diagnostico')
  assert.equal(r.length, 1)
  assert.equal(r[0].nome, 'Diagnóstico Guiado: Programa de acompanhamento Individual')

  assert.equal(filtrarProdutos(PRODUTOS, 'restauracao').length, 6)
  assert.equal(filtrarProdutos(PRODUTOS, 'traicao').length, 2)
  assert.equal(filtrarProdutos(PRODUTOS, 'conjuge').length, 1)
  assert.equal(filtrarProdutos(PRODUTOS, 'alianca').length, 2)
})

test('acha com acento tambem, para quem digita direito', () => {
  assert.equal(filtrarProdutos(PRODUTOS, 'Diagnóstico').length, 1)
  assert.equal(filtrarProdutos(PRODUTOS, 'IMERSÃO').length, filtrarProdutos(PRODUTOS, 'imersao').length)
})

test('nao diferencia maiuscula: CSP e csp sao a mesma coisa', () => {
  // Caso real: as nomenclaturas do trafego sao maiusculas nos nomes dos
  // produtos, e ninguem digita com Caps Lock.
  assert.equal(filtrarProdutos(PRODUTOS, 'csp').length, 3)
  assert.deepEqual(filtrarProdutos(PRODUTOS, 'csp'), filtrarProdutos(PRODUTOS, 'CSP'))
})

test('termos soltos, em qualquer ordem', () => {
  // Os nomes sao longos e cheios de pontuacao. Quem procura digita dois pedacos
  // soltos, nao a frase exata - busca por frase nao acharia.
  const r = filtrarProdutos(PRODUTOS, 'combo imersao')
  assert.equal(r.length, 1)
  assert.equal(r[0].nome, 'Combo: Primeiros Passos da Restauração - OB - imersão')
  assert.deepEqual(filtrarProdutos(PRODUTOS, 'imersao combo'), r, 'a ordem nao pode importar')
  assert.equal(filtrarProdutos(PRODUTOS, 'mentoria pedro').length, 5)
  assert.equal(filtrarProdutos(PRODUTOS, 'mentoria denise').length, 2)
})

test('busca vazia devolve tudo, e espaco em branco tambem', () => {
  for (const b of ['', '   ', '\t']) {
    assert.equal(filtrarProdutos(PRODUTOS, b).length, PRODUTOS.length, JSON.stringify(b))
  }
})

test('busca que nao acha nada devolve lista vazia, nao a lista inteira', () => {
  assert.equal(filtrarProdutos(PRODUTOS, 'xpto').length, 0)
  assert.equal(filtrarProdutos(PRODUTOS, 'mentoria xpto').length, 0, 'um termo sem match ja elimina')
})

test('"Selecionar todos" com busca ativa NAO derruba o que esta escondido', () => {
  // A armadilha que isto evita: 25 produtos marcados, filtra por "CSP", clica em
  // selecionar todos, e perde os 25 sem nenhum aviso na tela.
  const jaMarcados = ['COMO SER PERDOADO', 'O RESGATE']
  const visiveis = filtrarProdutos(PRODUTOS, 'csp').map(p => p.id)
  const r = comOsVisiveisMarcados(jaMarcados, visiveis)
  assert.equal(r.length, 5)
  for (const id of jaMarcados) assert.ok(r.includes(id), `perdeu ${id}`)
  for (const id of visiveis) assert.ok(r.includes(id), `nao marcou ${id}`)
})

test('"Nenhum" com busca ativa desmarca so os visiveis', () => {
  const marcados = PRODUTOS.map(p => p.id)
  const visiveis = filtrarProdutos(PRODUTOS, 'csp').map(p => p.id)
  const r = semOsVisiveis(marcados, visiveis)
  assert.equal(r.length, PRODUTOS.length - 3)
  for (const id of visiveis) assert.ok(!r.includes(id), `deixou ${id} marcado`)
})

test('marcar os visiveis duas vezes nao duplica', () => {
  const visiveis = ['a', 'b']
  assert.deepEqual(comOsVisiveisMarcados(comOsVisiveisMarcados([], visiveis), visiveis), ['a', 'b'])
})

test('a tela de Fechamentos renderiza a lista FILTRADA, nao a lista inteira', () => {
  // Teste de fiacao: a busca pode funcionar perfeitamente e a tela continuar
  // mapeando `availableProducts`, e aí a lupa nao filtra nada.
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('filtrarProdutos'), 'a tela nao usa filtrarProdutos')
  assert.ok(tela.includes('produtosVisiveis.map'), 'a tela nao renderiza a lista filtrada')

  // E os dois botoes precisam respeitar a busca, senao "Selecionar todos"
  // derruba em silencio o que esta marcado e escondido.
  assert.ok(tela.includes('comOsVisiveisMarcados'), 'Selecionar todos ignora a busca')
  assert.ok(tela.includes('semOsVisiveis'), 'Nenhum ignora a busca')
})

test('o contador continua mostrando o total REAL, nao o filtrado', () => {
  // "31 de 31 produtos selecionados" tem que seguir contando tudo: se passasse
  // a contar os visiveis, filtrar mudaria o numero e pareceria que produtos
  // foram desmarcados.
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  const linha = tela.split('\n').find(l => l.includes('produtos selecionados ·'))
  assert.ok(linha, 'nao achei o contador')
  assert.ok(linha!.includes('availableProducts.length'), 'o contador passou a usar a lista filtrada')
})
