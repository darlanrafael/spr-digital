import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FUNIS } from './funis-config'
import { agregarEsteira, type VendaParaEsteira } from './esteira-do-funil'
import { marcarForaDaConta, produtoDesligavelDoFunil, semProdutosDesligaveis } from './produto-desligavel'

// Botao "Contar O Resgate - CSP" na tela de Funis (dono 10/11/2026). Desligado =
// como se as vendas do O RESGATE - CSP nao existissem. Ver
// docs/superpowers/specs/2026-11-10-botao-resgate-funis-design.md.

const v = (o: Partial<VendaParaEsteira>): VendaParaEsteira => ({
  plataforma: 'hubla', produto: 'COMO SER PERDOADO', produto_id: '1s8rVxvbITB2ejQHEHKx',
  status: 'aprovada', valor_pago_cliente: 100, ...o,
})

const csp = FUNIS.find(f => f.nome === 'Como Ser Perdoado')!.id
const imersao = FUNIS.find(f => f.nome === 'Imersão a Reaproximação')!.id

test('produtoDesligavelDoFunil: CSP tem o Resgate; Imersao e id inexistente nao tem', () => {
  assert.equal(produtoDesligavelDoFunil(csp), 'O Resgate - CSP')
  assert.equal(produtoDesligavelDoFunil(imersao), null)
  assert.equal(produtoDesligavelDoFunil('nao-existe'), null)
})

test('semProdutosDesligaveis tira so o Resgate CSP (id, nome, reembolso) e mantem ordem e objetos', () => {
  const resgatePorId = v({ produto: 'X', produto_id: '4c7FpX4SdlqVQT0WJfOv' })
  const resgatePorNome = v({ produto: 'O RESGATE - CSP', produto_id: null })
  const resgateReembolsado = v({ produto: 'O RESGATE - CSP', produto_id: '4c7FpX4SdlqVQT0WJfOv', status: 'reembolsada' })
  const principal = v({})
  const vitalicio = v({ produto: 'ACESSO VITALÍCIO - CSP', produto_id: 'HYscfyfSoG2CrsS6JpSe' })
  const mentoriaHubla = v({ produto: 'MENTORIA EM GRUPO - PEDRO RONCADA', produto_id: 'FL2Rs2rICpeVMCW77j6n' })
  const mentoriaKiwify = v({ plataforma: 'kiwify', produto: 'Mentoria em grupo- Pedro Roncada', produto_id: 'b7dee3f0-5b82-11f1-bec6-3d073756b1c6' })
  const imersaoVenda = v({ produto: 'Imersão - A reaproximação', produto_id: 'd7tvBd7toCPnVZnOWUaZ' })
  const resgateSemCsp = v({ produto: 'O RESGATE', produto_id: 't4ytLBgwp69xubk1irZK' })
  const resgateKiwify = v({ plataforma: 'kiwify', produto: '🥝 O Resgate', produto_id: null })
  const resgateCspPlataformaErrada = v({ plataforma: 'kiwify', produto: 'O RESGATE - CSP', produto_id: null })

  const entrada = [
    resgatePorId, principal, resgatePorNome, vitalicio, mentoriaHubla, resgateReembolsado,
    mentoriaKiwify, imersaoVenda, resgateSemCsp, resgateKiwify, resgateCspPlataformaErrada,
  ]
  const saida = semProdutosDesligaveis(entrada)
  assert.equal(saida[0], principal)
  assert.deepEqual(saida, [
    principal, vitalicio, mentoriaHubla, mentoriaKiwify, imersaoVenda,
    resgateSemCsp, resgateKiwify, resgateCspPlataformaErrada,
  ])
  saida.forEach((x, i) => assert.equal(x, [principal, vitalicio, mentoriaHubla, mentoriaKiwify, imersaoVenda, resgateSemCsp, resgateKiwify, resgateCspPlataformaErrada][i]))
  assert.equal(entrada.length, 11, 'nao muda a lista recebida')
})

test('marcarForaDaConta marca so o degrau do Resgate, so com excluir, e preserva os numeros', () => {
  const vendas = [
    v({}),
    v({ produto: 'O RESGATE - CSP', produto_id: '4c7FpX4SdlqVQT0WJfOv', valor_pago_cliente: 197 }),
    v({ produto: 'O RESGATE - CSP', produto_id: null, valor_pago_cliente: 197 }),
  ]
  const marcada = marcarForaDaConta(agregarEsteira(vendas, csp), csp, true)
  assert.deepEqual(marcada.filter(e => e.foraDaConta).map(e => e.rotulo), ['O Resgate - CSP'])
  const resgate = marcada.find(e => e.rotulo === 'O Resgate - CSP')!
  assert.equal(resgate.vendas, 2)
  assert.equal(resgate.faturamento, 394)
  assert.equal(marcada.find(e => e.rotulo === 'Como Ser Perdoado')!.vendas, 1)

  assert.ok(marcarForaDaConta(agregarEsteira(vendas, csp), csp, false).every(e => e.foraDaConta === false))
  assert.ok(marcarForaDaConta(agregarEsteira([], imersao), imersao, true).every(e => e.foraDaConta === false))
})

test('semProdutosDesligaveis: nome com caixa/espacos sai; id do Resgate em outra plataforma fica', () => {
  const nomeSujo = v({ produto: '  o resgate - csp ', produto_id: null })
  const idNaKiwify = v({ plataforma: 'kiwify', produto: 'X', produto_id: '4c7FpX4SdlqVQT0WJfOv' })
  assert.deepEqual(semProdutosDesligaveis([nomeSujo, idNaKiwify]), [idNaKiwify])
})

test('marcarForaDaConta devolve a esteira inteira (ordem, rotulos, numeros) nos tres ramos', () => {
  const vendas = [
    v({}),
    v({ produto: 'ALIANÇA SAGRADA - CSP', produto_id: 'eNsZ824PsAgz2DrvKYxw', valor_pago_cliente: 50 }),
    v({ produto: 'O RESGATE - CSP', produto_id: '4c7FpX4SdlqVQT0WJfOv', valor_pago_cliente: 197 }),
  ]
  const base = agregarEsteira(vendas, csp)
  assert.deepEqual(marcarForaDaConta(base, csp, true), [
    { rotulo: 'Como Ser Perdoado', vendas: 1, faturamento: 100, foraDaConta: false },
    { rotulo: 'Order bumps', vendas: 1, faturamento: 50, foraDaConta: false },
    { rotulo: 'Mentoria em grupo', vendas: 0, faturamento: 0, foraDaConta: false },
    { rotulo: 'O Resgate - CSP', vendas: 1, faturamento: 197, foraDaConta: true },
  ])
  assert.deepEqual(marcarForaDaConta(base, csp, false), [
    { rotulo: 'Como Ser Perdoado', vendas: 1, faturamento: 100, foraDaConta: false },
    { rotulo: 'Order bumps', vendas: 1, faturamento: 50, foraDaConta: false },
    { rotulo: 'Mentoria em grupo', vendas: 0, faturamento: 0, foraDaConta: false },
    { rotulo: 'O Resgate - CSP', vendas: 1, faturamento: 197, foraDaConta: false },
  ])
  const baseImersao = agregarEsteira([v({ produto: 'Imersão - A reaproximação', produto_id: 'd7tvBd7toCPnVZnOWUaZ', valor_pago_cliente: 297 })], imersao)
  assert.deepEqual(marcarForaDaConta(baseImersao, imersao, true), [
    { rotulo: 'Imersão - A reaproximação', vendas: 1, faturamento: 297, foraDaConta: false },
    { rotulo: 'Order bumps', vendas: 0, faturamento: 0, foraDaConta: false },
  ])
  // a entrada nao e alterada
  assert.deepEqual(base, [
    { rotulo: 'Como Ser Perdoado', vendas: 1, faturamento: 100 },
    { rotulo: 'Order bumps', vendas: 1, faturamento: 50 },
    { rotulo: 'Mentoria em grupo', vendas: 0, faturamento: 0 },
    { rotulo: 'O Resgate - CSP', vendas: 1, faturamento: 197 },
  ])
})
