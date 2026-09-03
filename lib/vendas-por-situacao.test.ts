import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classificarVendas, ehPendenteDeAgendamento, ehVendaFilha, COLUNAS_DA_TELA_DE_VENDAS, COLUNAS_DO_DASHBOARD, ehDoTerapeuta, ehDiagnosticoGuiado, entrouNoCaixa, STATUS_DE_REEMBOLSO, termosDeProduto } from './vendas-por-situacao'

type V = { id: string; produto: string; status?: string | null; pacote_pai_id?: string | null }
const MENTORIA = 'Mentoria Particular - Pedro Roncada'

const classificar = (vendas: V[], comSessao: string[] = []) =>
  classificarVendas({
    vendas,
    aprovada: v => !v.status || v.status === 'aprovada',
    temSessao: v => comSessao.includes(v.id),
  })

test('venda ligada a outro pacote SAI de Pendentes de Agendamento', () => {
  // Sem isto, a segunda compra de um pacote pago em duas vezes fica presa em
  // Pendentes para sempre: as sessões estão na venda irmã, e a regra de pendente
  // é "venda sem nenhuma sessão".
  const r = classificar([{ id: 'filha', produto: MENTORIA, pacote_pai_id: 'pai' }])
  assert.deepEqual(r.pendentes.map(v => v.id), [])
})

test('e ENTRA na lista de filhas, que é de onde a tela soma o pacote', () => {
  const r = classificar([{ id: 'filha', produto: MENTORIA, pacote_pai_id: 'pai' }])
  assert.deepEqual(r.filhas.map(v => v.id), ['filha'])
})

test('venda comum sem sessão continua pendente', () => {
  const r = classificar([{ id: 'a', produto: MENTORIA }])
  assert.deepEqual(r.pendentes.map(v => v.id), ['a'])
  assert.deepEqual(r.filhas, [])
})

test('Mentoria em Grupo não é agendamento individual', () => {
  const r = classificar([{ id: 'g', produto: 'Mentoria em Grupo - Pedro' }])
  assert.deepEqual(r.pendentes, [])
})

test('venda com sessão vai para Ativos, não para Pendentes', () => {
  const r = classificar([{ id: 'a', produto: MENTORIA }], ['a'])
  assert.deepEqual(r.pendentes, [])
  assert.deepEqual(r.ativos.map(v => v.id), ['a'])
})

test('reembolso sai das aprovadas', () => {
  const r = classificar([{ id: 'r', produto: MENTORIA, status: 'reembolsada' }])
  assert.deepEqual(r.aprovadas, [])
  assert.deepEqual(r.reembolsos.map(v => v.id), ['r'])
})

test('o corte de vendas_a_partir_de tira de Pendentes', () => {
  const antiga = { id: 'velha', produto: MENTORIA }
  assert.equal(ehPendenteDeAgendamento(antiga, { temSessao: () => false, aposCorte: () => false }), false)
  assert.equal(ehPendenteDeAgendamento(antiga, { temSessao: () => false, aposCorte: () => true }), true)
})

test('ehVendaFilha é a mesma pergunta nos três lugares que a fazem', () => {
  assert.equal(ehVendaFilha({ id: 'a', produto: MENTORIA, pacote_pai_id: 'pai' }), true)
  assert.equal(ehVendaFilha({ id: 'a', produto: MENTORIA, pacote_pai_id: null }), false)
  assert.equal(ehVendaFilha({ id: 'a', produto: MENTORIA }), false)
})

test('o select da tela de vendas carrega as colunas de que a regra depende', () => {
  // Coluna que falta no select não dá erro: chega `undefined` e a regra que
  // depende dela simplesmente para de valer.
  for (const col of ['oferta_nome', 'pacote_pai_id', 'order_id', 'preco_base']) {
    assert.ok(COLUNAS_DA_TELA_DE_VENDAS.split(',').includes(col), `falta ${col} no select da tela de vendas`)
  }
})

test('o select do dashboard carrega pacote_pai_id', () => {
  assert.ok(COLUNAS_DO_DASHBOARD.split(',').includes('pacote_pai_id'))
})

test('o Diagnostico Guiado nao some dos Pendentes por nao ter nome de terapeuta', () => {
  // As tres telas escolhiam de quem e a venda por "o produto contem o primeiro
  // nome do terapeuta". O Diagnostico nao contem nenhum, entao a tela do
  // comercial (que abria excecao) mostrava e as outras duas nao. Medido em
  // 03/09/2026 na venda do Francisco Geraldo, R$ 4.997.
  const DIAG = 'Diagnóstico Guiado: Programa de acompanhamento Individual'
  assert.equal(ehDoTerapeuta(DIAG, 'Pedro'), true)
  assert.equal(ehDoTerapeuta(DIAG, 'Denise'), false)
  assert.equal(ehDiagnosticoGuiado(DIAG), true)
})

test('a regra antiga continua valendo para os demais produtos', () => {
  assert.equal(ehDoTerapeuta('Mentoria Particular - Pedro Roncada', 'Pedro'), true)
  assert.equal(ehDoTerapeuta('Mentoria Particular - Pedro Roncada', 'Denise'), false)
  assert.equal(ehDoTerapeuta('Mentoria Particular - Pedro | Denise', 'Denise'), true)
  assert.equal(ehDiagnosticoGuiado('Mentoria Particular - Pedro Roncada'), false)
})

test('venda ligada a outro pacote fica FORA das aprovadas-pendentes mas DENTRO das filhas', () => {
  // As filhas saem de `vendas`, nao de `aprovadas`: uma segunda compra
  // estornada continua com o `pacote_pai_id` gravado e o pacote continua
  // agendado. Filtrando por aprovada, o prontuario do pai perdia o aviso de
  // "pago em mais de uma compra" e o botao de separar, e a filha aparecia em
  // Reembolsos sem nada dizendo que fazia parte de um pacote de 8.
  const pai = { id: 'pai', produto: 'Mentoria Particular - Pedro', status: 'aprovada' }
  const filhaEstornada = { id: 'f', produto: 'Mentoria Particular - Pedro', status: 'reembolsada', pacote_pai_id: 'pai' }
  const r = classificarVendas({
    vendas: [pai, filhaEstornada],
    aprovada: v => !v.status || v.status === 'aprovada',
    temSessao: v => v.id === 'pai',
  })
  assert.deepEqual(r.filhas.map(v => v.id), ['f'])
  assert.deepEqual(r.reembolsos.map(v => v.id), ['f'])
  assert.deepEqual(r.pendentes.map(v => v.id), [])
})

test('entrouNoCaixa e a mesma pergunta que a lista de aprovadas faz', () => {
  assert.equal(entrouNoCaixa('aprovada'), true)
  assert.equal(entrouNoCaixa(null), true)
  assert.equal(entrouNoCaixa(undefined), true)
  for (const s of STATUS_DE_REEMBOLSO) assert.equal(entrouNoCaixa(s), false, s)
})

test('o select do dashboard carrega oferta_nome: sem ele a projecao volta a chutar', () => {
  // Sem a oferta, duas compras do mesmo pacote somam R$ 5.280, acham 8 sessoes
  // na tabela e dividem por 2 irmas - projetando 4 onde o pacote tem 8.
  assert.ok(COLUNAS_DO_DASHBOARD.includes('oferta_nome'))
  assert.ok(COLUNAS_DO_DASHBOARD.includes('pacote_pai_id'))
})

test('toda varredura de vendas dos terapeutas tem de trazer o Diagnostico', () => {
  // O produto do Diagnostico nao contem nome de terapeuta nenhum. A varredura
  // do dashboard filtrava so por nome, entao as vendas dele ficavam de fora, e
  // como `consultas_hoje` e `proximas_consultas` sao filtradas por
  // `.in('sale_id', saleIds)`, as sessoes do Diagnostico sumiam do Overview
  // inteiro: 11 sessoes de 7 pacientes invisiveis, medido em 03/09/2026.
  const t = termosDeProduto(['pedro', 'denise'])
  assert.deepEqual(t, [
    'produto.ilike.%pedro%',
    'produto.ilike.%denise%',
    'produto.ilike.%Diagnóstico Guiado%',
  ])
  // Mesmo sem terapeuta nenhum na lista, o Diagnostico continua entrando.
  assert.deepEqual(termosDeProduto([]), ['produto.ilike.%Diagnóstico Guiado%'])
})
