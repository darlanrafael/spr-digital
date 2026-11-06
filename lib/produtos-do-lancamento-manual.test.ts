import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRODUTOS_DO_LANCAMENTO_MANUAL, produtoDoLancamento, ehDiagnosticoNoLancamento,
  totalDeSessoes, divisaoDoDiagnostico,
  distribuicaoNaTela, produtoPadraoDoTerapeuta, prepararPedido, produtosDaTela,
} from './produtos-do-lancamento-manual'
import { SESSOES_POR_FORMATO_PUBLICO, formatoDaVenda } from './diagnostico-guiado'
import { sessoesDoNomeDaOferta } from './sessoes-da-oferta'

const PEDRO = 'Mentoria Particular - Pedro Roncada'
const DENISE = 'Mentoria Particular - Denise Nascimento'
const DIAG = 'Diagnóstico Guiado: Programa de acompanhamento Individual'

test('os tres produtos que o usuario definiu continuam na lista', () => {
  const nomes = PRODUTOS_DO_LANCAMENTO_MANUAL.map(p => p.nome)
  for (const n of [PEDRO, DENISE, DIAG]) assert.ok(nomes.includes(n), n)
})

test('Mentoria pergunta QUANTIDADE, Diagnostico pergunta FORMATO', () => {
  assert.equal(produtoDoLancamento(PEDRO)?.pergunta, 'quantidade')
  assert.equal(produtoDoLancamento(DENISE)?.pergunta, 'quantidade')
  assert.equal(produtoDoLancamento(DIAG)?.pergunta, 'formato')
  assert.ok(ehDiagnosticoNoLancamento(DIAG))
  assert.equal(ehDiagnosticoNoLancamento(PEDRO), false)
})

test('cada Mentoria ja sugere o terapeuta dela', () => {
  assert.equal(produtoDoLancamento(PEDRO)?.terapeutaPadrao, 'pedro')
  assert.equal(produtoDoLancamento(DENISE)?.terapeutaPadrao, 'denise')
  // O Diagnostico nao sugere: ele divide entre os dois.
  assert.equal(produtoDoLancamento(DIAG)?.terapeutaPadrao, null)
})

test('produto fora da lista nao passa', () => {
  assert.equal(produtoDoLancamento('Qualquer coisa'), null)
  assert.equal(produtoDoLancamento(''), null)
  assert.equal(produtoDoLancamento(null), null)
  assert.match(totalDeSessoes({ produto: 'Qualquer coisa', quantidade: 4 }).erro!, /Escolha um dos produtos/)
})

test('no Diagnostico a quantidade vem do FORMATO, nao de quem lanca', () => {
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 1 }).total, 9)
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 2 }).total, 4)
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 3 }).total, 2)
  // Mesmo mandando quantidade junto, o formato manda.
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 2, quantidade: 99 }).total, 4)
})

test('Diagnostico sem formato nao passa', () => {
  assert.match(totalDeSessoes({ produto: DIAG }).erro!, /Escolha o formato/)
  assert.equal(totalDeSessoes({ produto: DIAG }).total, null)
})

test('na Mentoria a quantidade e do comercial, com limite', () => {
  assert.equal(totalDeSessoes({ produto: PEDRO, quantidade: 4 }).total, 4)
  assert.equal(totalDeSessoes({ produto: DENISE, quantidade: 60 }).total, 60)
  for (const q of [0, -1, 61, 4.5, null]) {
    assert.equal(totalDeSessoes({ produto: PEDRO, quantidade: q as number }).total, null, String(q))
  }
})

test('a divisao do Diagnostico bate com a regra do produto', () => {
  assert.deepEqual(divisaoDoDiagnostico(1), { totalSessoes: 9, sessoesPedro: 2, sessoesDenise: 7 })
  assert.deepEqual(divisaoDoDiagnostico(2), { totalSessoes: 4, sessoesPedro: 1, sessoesDenise: 3 })
  assert.deepEqual(divisaoDoDiagnostico(3), { totalSessoes: 2, sessoesPedro: 1, sessoesDenise: 1 })
})

test('a tabela publica e a mesma que o resto do sistema usa', () => {
  // Se ela divergir da interna, o lancamento manual monta um pacote diferente
  // do que o agendamento de venda real monta - e ninguem percebe.
  assert.deepEqual(SESSOES_POR_FORMATO_PUBLICO, { 1: { totalSessoes: 9, sessoesPedro: 2 }, 2: { totalSessoes: 4, sessoesPedro: 1 }, 3: { totalSessoes: 2, sessoesPedro: 1 } })
})

// ── Lista ligada na tela (06/11/2026) ───────────────────────────────────────
// Caso real: Maisa, Diagnostico lancado como "Mentoria Particular - Pedro
// Roncada" em texto livre. A venda nasceu sem formato e o agendamento so
// oferecia 1 sessao, com um terapeuta so.
test('o Leomir entra na lista: Diagnostico e Mentoria', () => {
  const nomes = PRODUTOS_DO_LANCAMENTO_MANUAL.map(p => p.nome)
  assert.ok(nomes.includes('Diagnóstico Guiado: Programa de acompanhamento Individual - Leomir'))
  assert.ok(nomes.includes('Mentoria Particular - Leomir Santos'))
})

test('a tela mostra quem atende cada parte do Diagnostico', () => {
  assert.equal(
    distribuicaoNaTela('Diagnóstico Guiado: Programa de acompanhamento Individual', 1),
    '9 sessões: 2 com Pedro e 7 com Denise',
  )
  assert.equal(
    distribuicaoNaTela('Diagnóstico Guiado: Programa de acompanhamento Individual - Leomir', 2),
    '4 sessões: 1 com Pedro e 3 com Leomir',
  )
  assert.equal(distribuicaoNaTela('Mentoria Particular - Pedro Roncada', 1), null)
  assert.equal(distribuicaoNaTela('Diagnóstico Guiado: Programa de acompanhamento Individual', null), null)
})

test('produto sugerido segue o terapeuta da tela', () => {
  assert.equal(produtoPadraoDoTerapeuta('Pedro Roncada'), 'Mentoria Particular - Pedro Roncada')
  assert.equal(produtoPadraoDoTerapeuta('Denise Nascimento'), 'Mentoria Particular - Denise Nascimento')
  assert.equal(produtoPadraoDoTerapeuta('Leomir Santos '), 'Mentoria Particular - Leomir Santos')
  assert.equal(produtoPadraoDoTerapeuta('Outra Pessoa'), '')
})

test('pedido de Diagnostico: quantidade e oferta saem do formato, nao do que veio da tela', () => {
  assert.deepEqual(
    prepararPedido({ produto: DIAG, formato_diagnostico: 1, total_sessoes: 1 }),
    { ok: true, total_sessoes: 9, oferta_nome: 'Formato 1' },
  )
})

test('o formato gravado e reconhecido pelo agendamento: 9 sessoes, 2 do Pedro', () => {
  const r = prepararPedido({ produto: DIAG + ' - Leomir', formato_diagnostico: 1 })
  assert.equal(r.ok, true)
  const f = formatoDaVenda({ id: 'manual_x', order_id: null, produto: DIAG + ' - Leomir', oferta_nome: r.ok ? r.oferta_nome : null })
  assert.equal(f?.totalSessoes, 9)
  assert.equal(f?.sessoesPedro, 2)
})

test('Diagnostico sem formato e formato inventado sao recusados', () => {
  assert.equal(prepararPedido({ produto: DIAG }).ok, false)
  assert.equal(prepararPedido({ produto: DIAG, formato_diagnostico: 7 as never }).ok, false)
})

test('Diagnostico com data ou sessao entregue e recusado: o lancamento so sabe um terapeuta', () => {
  assert.equal(prepararPedido({ produto: DIAG, formato_diagnostico: 1, proxima_sessao_data: '2026-11-10T10:00' }).ok, false)
  assert.equal(prepararPedido({ produto: DIAG, formato_diagnostico: 1, sessoes_entregues: 1 }).ok, false)
})

test('Mentoria guarda a quantidade pedida para o agendamento nao cair no preco', () => {
  const r = prepararPedido({ produto: 'Mentoria Particular - Pedro Roncada', total_sessoes: 9 })
  assert.deepEqual(r, { ok: true, total_sessoes: 9, oferta_nome: '9 sessões' })
  assert.equal(sessoesDoNomeDaOferta(r.ok ? r.oferta_nome : null), 9)
  assert.deepEqual(prepararPedido({ produto: 'Mentoria Particular - Pedro Roncada', total_sessoes: 1 }),
    { ok: true, total_sessoes: 1, oferta_nome: '1 sessão' })
})

test('produto fora da lista e quantidade invalida sao recusados', () => {
  assert.equal(prepararPedido({ produto: 'Inventado', total_sessoes: 4 }).ok, false)
  assert.equal(prepararPedido({ produto: 'Mentoria Particular - Pedro Roncada', total_sessoes: 0 }).ok, false)
})

// As sessoes da Mentoria vao para o terapeuta da tela. Escolher a Mentoria da
// Denise na tela do Pedro criaria as sessoes e a comissao no Pedro.
test('a tela so oferece a Mentoria do proprio terapeuta, e os dois Diagnosticos', () => {
  const nomes = produtosDaTela('Pedro Roncada').map(p => p.nome)
  assert.ok(nomes.includes(PEDRO))
  assert.equal(nomes.includes(DENISE), false)
  assert.equal(nomes.includes('Mentoria Particular - Leomir Santos'), false)
  assert.ok(nomes.includes(DIAG))
  assert.ok(nomes.includes(DIAG + ' - Leomir'))
})

test('o servidor recusa Mentoria de outro terapeuta, para quem chamar a rota direto', () => {
  const r = prepararPedido({ produto: DENISE, total_sessoes: 4, terapeuta_nome: 'Pedro Roncada' })
  assert.equal(r.ok, false)
  assert.equal(prepararPedido({ produto: DENISE, total_sessoes: 4, terapeuta_nome: 'Denise Nascimento' }).ok, true)
  assert.equal(prepararPedido({ produto: DIAG, formato_diagnostico: 3, terapeuta_nome: 'Denise Nascimento' }).ok, true)
})
