import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessoesDoNomeDaOferta, conferirQuantidade, TOLERANCIA_REAIS } from './sessoes-da-oferta'

// Os nomes de oferta usados aqui sao os REAIS, recuperados dos webhooks da
// Hubla em 02/09/2026, com a contagem de cada um no periodo.

test('le a quantidade dos nomes de oferta reais da Hubla', () => {
  assert.equal(sessoesDoNomeDaOferta('Formato - 2 Sessão'), 2)      // 20 vendas
  assert.equal(sessoesDoNomeDaOferta('Formato - 4 Sessão'), 4)      // 13
  assert.equal(sessoesDoNomeDaOferta('Formato - 8 Sessão'), 2 * 4)  // 2
  assert.equal(sessoesDoNomeDaOferta('Formato - 1 Sessão'), 1)      // 2
})

test('nomes bagunçados da Hubla continuam legíveis', () => {
  // Os "(Cópia)" sao da Amanda: as duas metades do pacote de 8 dela.
  assert.equal(sessoesDoNomeDaOferta('Formato - 4 Sessão    (Cópia)'), 4)
  assert.equal(sessoesDoNomeDaOferta('Formato - 4 Sessão    (Cópia) (Cópia)'), 4)
  assert.equal(sessoesDoNomeDaOferta('Formato - 1 Sessão denice'), 1)
  assert.equal(sessoesDoNomeDaOferta('Formato 2 - 4 Sessões'), 4)
  assert.equal(sessoesDoNomeDaOferta('Formato 2 - 2 Sessões'), 2)
})

test('"Sessão Única" vale 1', () => {
  assert.equal(sessoesDoNomeDaOferta('Formato 1 - Sessão Única'), 1)
})

test('o numero do FORMATO nao e confundido com quantidade', () => {
  // "Formato 2 - 4 Sessões" sao 4 sessoes, nao 2. So conta o numero colado na
  // palavra sessao.
  assert.equal(sessoesDoNomeDaOferta('Formato 2 - 4 Sessões'), 4)
  assert.equal(sessoesDoNomeDaOferta('FORMATO 1'), null)
  assert.equal(sessoesDoNomeDaOferta('Mentoria 7 Fases Formato 1'), null)
})

test('oferta vazia, nula ou sem quantidade devolve null', () => {
  assert.equal(sessoesDoNomeDaOferta(null), null)
  assert.equal(sessoesDoNomeDaOferta(undefined), null)
  assert.equal(sessoesDoNomeDaOferta(''), null)
  assert.equal(sessoesDoNomeDaOferta('Restante'), null)
  assert.equal(sessoesDoNomeDaOferta('OFERTA COM DESCONTO - R$ 297,00'), null)
})

test('numero absurdo nao vira quantidade', () => {
  assert.equal(sessoesDoNomeDaOferta('promo 2026 sessões'), null)
})

// --- conferirQuantidade

test('oferta e preco concordam: segue direto', () => {
  const r = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 4 Sessão', precoBase: 2860 }], tabela: 'pedro' })
  assert.deepEqual(r, { situacao: 'ok', sessoes: 4 })
})

test('arredondamento da plataforma NAO gera pergunta', () => {
  // Casos reais: 1549 (Patricia, Caio), 1548 (Mirella), 2859 (Matheus), 5277
  // (Natalia). Sao R$ 1 a R$ 3 e vem da plataforma, nao de decisao comercial.
  for (const [pb, of] of [[1549, 'Formato - 2 Sessão'], [1548, 'Formato - 2 Sessão'], [2859, 'Formato - 4 Sessão'], [5277, 'Formato - 8 Sessão']] as const) {
    assert.equal(conferirQuantidade({ vendas: [{ ofertaNome: of, precoBase: pb }], tabela: 'pedro' }).situacao, 'ok', `${pb} deveria passar calado`)
  }
})

test('exatamente na tolerancia ainda passa calado', () => {
  const r = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 2 Sessão', precoBase: 1550 - TOLERANCIA_REAIS }], tabela: 'pedro' })
  assert.equal(r.situacao, 'ok')
})

test('CASO REAL: valor abaixo do pacote gera a pergunta, sem bloquear', () => {
  // Michelangelo pagou 1500 num pacote de 2 sessoes (1550): R$ 50 de diferenca.
  const r = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 2 Sessão', precoBase: 1500 }], tabela: 'pedro' })
  assert.equal(r.situacao, 'valor_divergente')
  if (r.situacao !== 'valor_divergente') return
  assert.equal(r.sessoes, 2, 'a quantidade continua vindo da oferta')
  assert.equal(r.esperado, 1550)
  assert.equal(r.recebido, 1500)
  assert.equal(r.diferenca, 50)
})

test('CASO REAL DA AMANDA: cada metade sozinha diverge, as duas juntas fecham', () => {
  // 24/08 R$ 2.600 e 25/08 R$ 2.680, as duas "Formato - 4 Sessão". Somadas dao
  // 5.280, o preco do pacote de 8. Isoladas, cada uma parece um pacote de 4
  // pago a menos - e e por isso que a pergunta ao comercial existe.
  const sozinha = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 4 Sessão', precoBase: 2600 }], tabela: 'pedro' })
  assert.equal(sozinha.situacao, 'valor_divergente')
  if (sozinha.situacao !== 'valor_divergente') return
  assert.equal(sozinha.diferenca, 260)

  const comAIrma = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 4 Sessão', precoBase: 2600 }, { ofertaNome: 'Formato - 4 Sessão', precoBase: 2680 }], tabela: 'pedro' })
  assert.equal(comAIrma.situacao, 'ok')
})

test('sem oferta, cai na tabela de preco, como o sistema ja fazia', () => {
  assert.deepEqual(conferirQuantidade({ vendas: [{ ofertaNome: null, precoBase: 2860 }], tabela: 'pedro' }), { situacao: 'ok', sessoes: 4 })
  assert.deepEqual(conferirQuantidade({ vendas: [{ ofertaNome: null, precoBase: 1400 }], tabela: 'denise' }), { situacao: 'ok', sessoes: 4 })
})

test('sem oferta e com preco fora da tabela: INDETERMINADO, ninguem chuta', () => {
  // Casos reais: 4000 (Cristiane), 2297 (Polyanna), 810 (Billimaicon).
  // Antes o sistema caia num palpite pelo nome do produto e deixava o comercial
  // editar. Agora ele para e pede ajuda.
  for (const pb of [4000, 2297, 810, 500, 0]) {
    assert.equal(conferirQuantidade({ vendas: [{ ofertaNome: null, precoBase: pb }], tabela: 'pedro' }).situacao, 'indeterminado', `${pb}`)
  }
})

test('a oferta manda mesmo quando o preco esta fora da tabela', () => {
  const r = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 2 Sessão', precoBase: 810 }], tabela: 'pedro' })
  assert.equal(r.situacao, 'valor_divergente')
  if (r.situacao !== 'valor_divergente') return
  assert.equal(r.sessoes, 2)
})

test('quantidade fora da tabela de precos vale, sem conferencia de valor', () => {
  const r = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 6 Sessões', precoBase: 3900 }], tabela: 'pedro' })
  assert.deepEqual(r, { situacao: 'ok', sessoes: 6 })
})

test('a tabela da Denise e usada quando pedida', () => {
  assert.deepEqual(conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 8 Sessão', precoBase: 2640 }], tabela: 'denise' }), { situacao: 'ok', sessoes: 8 })
  // O mesmo valor na tabela do Pedro divergiria.
  assert.equal(conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 8 Sessão', precoBase: 2640 }], tabela: 'pedro' }).situacao, 'valor_divergente')
})

test('valor ACIMA do pacote tambem gera pergunta', () => {
  // Kleiton pagou 2860 num produto da Denise cujo pacote de 8 custa 2640.
  const r = conferirQuantidade({ vendas: [{ ofertaNome: 'Formato - 8 Sessão', precoBase: 2860 }], tabela: 'denise' })
  assert.equal(r.situacao, 'valor_divergente')
  if (r.situacao !== 'valor_divergente') return
  assert.equal(r.diferenca, -220, 'diferenca negativa quando pagou a mais')
})

test('CRITICO: pacote com UMA venda sem oferta legivel e INDETERMINADO, nao soma so as legiveis', () => {
  // Somar so as ofertas legiveis daria um total menor que o comprado, e o
  // paciente receberia menos sessoes do que pagou. Melhor perguntar do que
  // somar errado. Esta mutacao sobrevivia a suite inteira.
  const r = conferirQuantidade({
    vendas: [
      { ofertaNome: 'Formato - 4 Sessão', precoBase: 2860 },
      { ofertaNome: 'Restante', precoBase: 500 },
    ],
    tabela: 'pedro',
  })
  assert.equal(r.situacao, 'indeterminado')
})

test('todas as vendas com oferta legivel: soma normalmente', () => {
  const r = conferirQuantidade({
    vendas: [
      { ofertaNome: 'Formato - 4 Sessão', precoBase: 2600 },
      { ofertaNome: 'Formato - 4 Sessão', precoBase: 2680 },
    ],
    tabela: 'pedro',
  })
  assert.deepEqual(r, { situacao: 'ok', sessoes: 8 })
})
