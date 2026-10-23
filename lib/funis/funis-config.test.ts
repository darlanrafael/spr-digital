import { test } from 'node:test'
import assert from 'node:assert/strict'
import { funilDaVenda, ehProdutoPrincipal, produtoDoFunil } from './funis-config'

// GUARDA dos funis. O match (funilDaVenda) e por igualdade EXATA do nome
// normalizado OU pelo produto_id, com a plataforma batendo junto. Estes testes
// travam os casos em que isso pode dar errado - alguns ja deram problema no
// negocio (o dono citou "O RESGATE" x "O RESGATE - CSP"). Dados: catalogo real
// de 14.019 vendas (item 114.4 do spr-digital.md).

const CSP = 'como-ser-perdoado'
const IMERSAO = 'imersao-reaproximacao'

// === O RESGATE: "sem CSP" NAO entra; "- CSP" entra. (dono: nao pode confundir) ===
test('"O RESGATE" (sem CSP) NAO cai em funil nenhum - por nome e por id', () => {
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'O RESGATE', produto_id: 't4ytLBgwp69xubk1irZK' }), null)
  // mesmo sem id (venda antiga), so pelo nome, continua fora:
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'O RESGATE', produto_id: null }), null)
})

test('"🥝 O Resgate" (Kiwify, sem CSP) NAO cai em funil nenhum', () => {
  assert.equal(funilDaVenda({ plataforma: 'kiwify', produto: '🥝 O Resgate', produto_id: '72fcdce0-d821-11f0-96bf-731259ca42de' }), null)
})

test('"O RESGATE - CSP" ENTRA no Como Ser Perdoado - por nome e por id', () => {
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'O RESGATE - CSP', produto_id: '4c7FpX4SdlqVQT0WJfOv' })?.id, CSP)
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'O RESGATE - CSP', produto_id: null })?.id, CSP)
})

// === Produto PRINCIPAL vs agregado (venda unica x com agregados) ===
test('so o produto principal do funil conta como venda unica; bumps nao', () => {
  // CSP: principal = COMO SER PERDOADO; bumps = CSP combos/acesso/alianca.
  assert.equal(ehProdutoPrincipal({ plataforma: 'hubla', produto: 'COMO SER PERDOADO', produto_id: '1s8rVxvbITB2ejQHEHKx' }, 'como-ser-perdoado'), true)
  assert.equal(ehProdutoPrincipal({ plataforma: 'hubla', produto: 'ALIANÇA SAGRADA - CSP', produto_id: 'eNsZ824PsAgz2DrvKYxw' }, 'como-ser-perdoado'), false)
  // Imersao: principal nas duas plataformas.
  assert.equal(ehProdutoPrincipal({ plataforma: 'hubla', produto: 'Imersão - A reaproximação', produto_id: 'd7tvBd7toCPnVZnOWUaZ' }, 'imersao-reaproximacao'), true)
  assert.equal(ehProdutoPrincipal({ plataforma: 'kiwify', produto: 'IImersão - A Reaproximação - Oficial', produto_id: null }, 'imersao-reaproximacao'), true)
  assert.equal(ehProdutoPrincipal({ plataforma: 'hubla', produto: 'Guia prático - Anti-brigas - OB', produto_id: '8C4fqbB8IdQXrydNNgmg' }, 'imersao-reaproximacao'), false)
})

test('MENTORIA EM GRUPO entra no CSP (upsell/agregado), nao como principal', () => {
  const h = { plataforma: 'hubla', produto: 'MENTORIA EM GRUPO - PEDRO RONCADA', produto_id: 'FL2Rs2rICpeVMCW77j6n' }
  const k = { plataforma: 'kiwify', produto: 'Mentoria em grupo- Pedro Roncada', produto_id: 'b7dee3f0-5b82-11f1-bec6-3d073756b1c6' }
  assert.equal(funilDaVenda(h)?.id, 'como-ser-perdoado')
  assert.equal(funilDaVenda(k)?.id, 'como-ser-perdoado')
  assert.equal(ehProdutoPrincipal(h, 'como-ser-perdoado'), false) // agregado, nao venda unica
  assert.equal(ehProdutoPrincipal(k, 'como-ser-perdoado'), false)
})

// === Colisao dos 3 "Primeiros Passos": CSP (Perdoado) x OB (Imersao) x CCC (fora) ===
test('"COMBO ... - CSP" -> Como Ser Perdoado', () => {
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'COMBO - OS PRIMEIROS PASSOS DA RESTAURAÇÃO - CSP', produto_id: 'OOKdn0lKVKGBBLhY78BY' })?.id, CSP)
})
test('"Combo: Primeiros Passos ... - OB" (Hubla) -> Imersao', () => {
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'Combo: Primeiros Passos da Restauração - OB', produto_id: 'hQDdIiz1jjuM9jtWwMjk' })?.id, IMERSAO)
})
test('"Combo ... - OB - CCC" (Kiwify, outro funil) -> fora', () => {
  assert.equal(funilDaVenda({ plataforma: 'kiwify', produto: 'Combo: Primeiros Passos da Restauração - OB - CCC', produto_id: 'f4b38af0-95c1-11f1-88b7-218470cae9f9' }), null)
})

// === Imersao: principal + 4 bumps, nas DUAS plataformas, por id e por nome ===
const imersao: Array<[string, string, string]> = [
  ['hubla',  'Imersão - A reaproximação',                               'd7tvBd7toCPnVZnOWUaZ'],
  ['kiwify', 'IImersão - A Reaproximação - Oficial',                    'f34a2630-d9e0-11f0-ac73-b5cf3aba727f'],
  ['hubla',  'Combo: Primeiros Passos da Restauração - OB',             'hQDdIiz1jjuM9jtWwMjk'],
  ['kiwify', '🥝 Combo: Primeiros Passos da Restauração - OB - imersão', 'e6bd44b0-ee85-11f0-a468-3f63a07cd627'],
  ['hubla',  'Guia prático - Anti-brigas - OB',                         '8C4fqbB8IdQXrydNNgmg'],
  ['kiwify', '🥝 Guia prático - Anti-brigas - OB Imersão',              '4eefa810-ee87-11f0-b4f2-9f6e27362ab7'],
  ['hubla',  'Gravação - Imersão A reaproximação',                      '0uQLyW37o3FYhr7tLPhd'],
  ['kiwify', '🥝 Gravação da Imersão - A Reaproximação - OB Imersão',   '32e2ad30-ee86-11f0-8fbb-ab178724d381'],
  ['hubla',  'O Que fazer Após a traição?  OB',                         'qSNHES80x9ut1fuo9qOv'],
  ['kiwify', '🥝 O Que fazer Após a traição?  OB - Imersão',            '703507b0-ee85-11f0-8e0e-212248210abf'],
]
for (const [plat, nome, id] of imersao) {
  test(`Imersao: "${nome}" (${plat}) cai no funil - por id`, () => {
    assert.equal(funilDaVenda({ plataforma: plat, produto: 'nome qualquer que nao bate', produto_id: id })?.id, IMERSAO)
  })
  test(`Imersao: "${nome}" (${plat}) cai no funil - por nome (venda antiga sem id)`, () => {
    assert.equal(funilDaVenda({ plataforma: plat, produto: nome, produto_id: null })?.id, IMERSAO)
  })
}

// === Terapeutas: OUTRO produto, fica de fora (por nome bateriam em "imersão/gravação") ===
test('produtos "Terapeutas" NAO entram na Imersao', () => {
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'IMERSÃO - PROFISSÃO TERAPEUTAS', produto_id: null }), null)
  assert.equal(funilDaVenda({ plataforma: 'hubla', produto: 'GRAVAÇÃO - IMERSÃO TERAPEUTAS', produto_id: null }), null)
})

// === Plataforma tem que bater: nome certo, plataforma errada, NAO casa ===
test('a plataforma tem que bater junto com nome/id', () => {
  // nome Hubla do principal, mas vindo rotulado como kiwify -> nao casa aquela linha
  assert.equal(funilDaVenda({ plataforma: 'kiwify', produto: 'Imersão - A reaproximação', produto_id: 'd7tvBd7toCPnVZnOWUaZ' }), null)
})

// === produtoDoFunil: casa a venda com a entrada de produto do config ===
test('produtoDoFunil devolve o produto principal e marca principal', () => {
  const p = produtoDoFunil({ plataforma: 'hubla', produto: 'COMO SER PERDOADO', produto_id: '1s8rVxvbITB2ejQHEHKx' }, 'como-ser-perdoado')
  assert.equal(p?.nome, 'COMO SER PERDOADO')
  assert.equal(p?.principal, true)
})

test('produtoDoFunil casa agregado (nao principal) e devolve null fora do funil', () => {
  const ag = produtoDoFunil({ plataforma: 'hubla', produto: 'ALIANÇA SAGRADA - CSP', produto_id: 'eNsZ824PsAgz2DrvKYxw' }, 'como-ser-perdoado')
  assert.equal(ag?.nome, 'ALIANÇA SAGRADA - CSP')
  assert.notEqual(ag?.principal, true)
  // produto de outro funil nao casa aqui
  assert.equal(produtoDoFunil({ plataforma: 'hubla', produto: 'Imersão - A reaproximação', produto_id: 'd7tvBd7toCPnVZnOWUaZ' }, 'como-ser-perdoado'), null)
})
