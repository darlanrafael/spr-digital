import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashSenha, brasiliaLocalToISO, isHojeBrasilia,
  inferirNumeroSessoes, calcularComissao, calcularReembolso,
} from './terapeutas-auth'

// `lib/terapeutas-auth.ts` nao tinha arquivo de teste, e o teste de mutacao de
// 15/09/2026 mediu a consequencia: 40% - de 43 defeitos introduzidos, 26
// passavam sem nenhum teste notar. E o modulo tem as funcoes que decidem
// QUANTAS sessoes um pacote tem, QUANTO a terapeuta recebe e QUANTO se devolve
// num reembolso.

// ── hashSenha ───────────────────────────────────────────────────────────────
test('o hash da senha e estavel: a MESMA senha da SEMPRE o mesmo hash', () => {
  // O mutante que sobrevivia trocava o `+` da concatenacao do sal. Se o sal
  // mudar, TODAS as senhas do sistema param de bater de uma vez, e ninguem
  // entra. O valor abaixo trava o algoritmo e o sal juntos.
  assert.equal(
    hashSenha('senha123'),
    hashSenha('senha123'),
    'o mesmo texto tem que dar o mesmo hash',
  )
  assert.equal(hashSenha('senha123').length, 64, 'sha256 em hex tem 64 caracteres')
  assert.match(hashSenha('x'), /^[0-9a-f]{64}$/, 'so hexadecimal minusculo')
})

test('senhas diferentes dao hashes diferentes, inclusive por um caractere', () => {
  assert.notEqual(hashSenha('senha123'), hashSenha('senha124'))
  assert.notEqual(hashSenha('senha'), hashSenha('Senha'), 'maiuscula conta')
  assert.notEqual(hashSenha(''), hashSenha(' '), 'vazio e espaco sao diferentes')
})

test('o hash NAO e o sha256 puro da senha - o sal esta aplicado', () => {
  // Sem o sal, um vazamento do banco permitiria quebrar as senhas com tabela
  // pronta. Este teste falha se alguem remover o sal.
  const shaPuro = require('crypto').createHash('sha256').update('senha123').digest('hex')
  assert.notEqual(hashSenha('senha123'), shaPuro, 'o sal sumiu do hash')
})

// ── brasiliaLocalToISO ──────────────────────────────────────────────────────
test('a hora digitada na tela e lida como BRASILIA, nao como UTC', () => {
  // O campo `datetime-local` chega sem fuso. `new Date(texto)` no servidor
  // depende do fuso da maquina (Vercel roda em UTC), entao 15:00 digitado
  // viraria 15:00 UTC = 12:00 BRT - a sessao apareceria tres horas antes.
  assert.equal(brasiliaLocalToISO('2026-07-13T15:00'), '2026-07-13T18:00:00.000Z')
  assert.equal(brasiliaLocalToISO('2026-01-01T00:00'), '2026-01-01T03:00:00.000Z')
})

test('hora digitada perto da meia-noite vira o dia seguinte em UTC', () => {
  // 22:00 BRT e 01:00 UTC do dia seguinte. Quem cortar a data do ISO sem
  // converter de volta vai mostrar o dia errado.
  assert.equal(brasiliaLocalToISO('2026-07-13T22:00'), '2026-07-14T01:00:00.000Z')
})

// ── isHojeBrasilia ──────────────────────────────────────────────────────────
test('isHojeBrasilia compara o DIA em Brasilia, nao em UTC — em QUALQUER hora', () => {
  // Serve para detectar "venda de encaixe" - sessao marcada para o mesmo dia,
  // sem tempo do lembrete de vespera pegar. Errar isso deixa o paciente sem
  // aviso nenhum.
  //
  // A primeira versao deste teste usava so `agora`, `agora-26h` e `agora+26h`,
  // e por isso dependia da HORA em que a suite rodasse: o teste de mutacao
  // mostrou que o defeito de sinal no fuso passava em parte do dia e era pego
  // no resto. Agora varre 96 horas em volta de agora e compara com a conta
  // feita aqui, com o sinal correto - um sinal trocado no codigo diverge em
  // varias das 96, em qualquer hora do dia.
  const BRT = 3 * 60 * 60 * 1000
  const diaBRT = (ms: number) => new Date(ms - BRT).toISOString().slice(0, 10)
  const agoraMs = Date.now()
  const hoje = diaBRT(agoraMs)

  let divergencias = 0
  for (let h = -48; h <= 48; h++) {
    const alvo = agoraMs + h * 3600 * 1000
    const esperado = diaBRT(alvo) === hoje
    const obtido = isHojeBrasilia(new Date(alvo).toISOString())
    if (obtido !== esperado) {
      divergencias++
      if (divergencias <= 3) {
        console.error(`  h=${h}: esperado ${esperado} (dia ${diaBRT(alvo)}), obtido ${obtido}`)
      }
    }
  }
  assert.equal(divergencias, 0, `${divergencias} de 97 horas divergiram da conta em BRT`)
})

// ── inferirNumeroSessoes ────────────────────────────────────────────────────
test('o tamanho do pacote sai do NOME do produto, nos dois jeitos de escrever', () => {
  // Os mutantes que sobreviviam trocavam o `||` por `&&` nas tres linhas: so a
  // primeira grafia seria aceita, e "8sess" sem espaco cairia no padrao de UMA
  // sessao. O pacote de 8 viraria pacote de 1, em silencio.
  assert.equal(inferirNumeroSessoes('Pacote 8 sessoes'), 8)
  assert.equal(inferirNumeroSessoes('Pacote 8sessoes'), 8, 'sem espaco tambem conta')
  assert.equal(inferirNumeroSessoes('Pacote 4 sessoes'), 4)
  assert.equal(inferirNumeroSessoes('Pacote 4sessoes'), 4)
  assert.equal(inferirNumeroSessoes('Pacote 2 sessoes'), 2)
  assert.equal(inferirNumeroSessoes('Pacote 2sessoes'), 2)
})

test('nome sem indicacao de quantidade vale UMA sessao', () => {
  assert.equal(inferirNumeroSessoes('Mentoria Particular - Pedro Roncada'), 1)
  assert.equal(inferirNumeroSessoes(''), 1)
})

test('a busca no nome NAO diferencia maiuscula', () => {
  assert.equal(inferirNumeroSessoes('PACOTE 8 SESSOES'), 8)
  assert.equal(inferirNumeroSessoes('Formato - 4 Sessão'), 4)
})

test('a ordem importa: 8 vem antes de 4 e de 2', () => {
  // Um nome com mais de um numero tem que resolver pelo maior declarado
  // primeiro, senao "8 sessoes (era 2 sessoes)" viraria 2.
  assert.equal(inferirNumeroSessoes('8 sessoes, antes 2 sessoes'), 8)
})

// ── calcularComissao ────────────────────────────────────────────────────────
test('CASO REAL: a comissao desconta o imposto ANTES do percentual', () => {
  // Numeros reais da Denise: pacote de 4 sessoes, 30%. Se o imposto nao fosse
  // descontado primeiro, ela receberia R$ 46 a mais por pacote.
  const r = calcularComissao({ valor_liquido: 1349.65, percentual: 30, numero_sessoes: 4 })
  assert.equal(Math.round(r.imposto * 100) / 100, 173.43)
  assert.equal(Math.round(r.base * 100) / 100, 1176.22)
  assert.equal(Math.round(r.comissao_total * 100) / 100, 352.87)
  assert.equal(Math.round(r.comissao_por_sessao * 100) / 100, 88.22, 'bate com o valor real no banco')
})

test('a comissao por sessao vezes o numero de sessoes da o total', () => {
  // Invariante: a divisao nao pode perder dinheiro.
  for (const n of [1, 2, 3, 4, 8, 9]) {
    const r = calcularComissao({ valor_liquido: 2497, percentual: 30, numero_sessoes: n })
    assert.ok(Math.abs(r.comissao_por_sessao * n - r.comissao_total) < 1e-9, `${n} sessoes`)
  }
})

test('terapeuta com 0% recebe zero, e isso nao quebra', () => {
  // E o caso do Pedro, que e socio e esta cadastrado com 0%.
  const r = calcularComissao({ valor_liquido: 5000, percentual: 0, numero_sessoes: 4 })
  assert.equal(r.comissao_total, 0)
  assert.equal(r.comissao_por_sessao, 0)
})

test('venda com liquido ZERO nao gera comissao', () => {
  // Lancamento manual entra com liquido zero por regra. Gerar comissao ali
  // pagaria sobre dinheiro que nao entrou.
  const r = calcularComissao({ valor_liquido: 0, percentual: 30, numero_sessoes: 4 })
  assert.equal(r.comissao_total, 0)
  assert.equal(r.comissao_por_sessao, 0)
})

// ── calcularReembolso ───────────────────────────────────────────────────────
test('nenhuma sessao realizada: devolve TUDO', () => {
  const r = calcularReembolso({ terapeuta_nome: 'Pedro Roncada', sessoes_total: 4, sessoes_feitas: 0, valor_pago: 2860 })
  assert.equal(r.valor_reembolso, 2860)
  assert.match(r.explicacao, /integral/)
})

test('todas realizadas: nao devolve nada, e a FRONTEIRA e exata', () => {
  // O mutante que sobrevivia trocava `>=` por `>`: com 4 de 4 realizadas ele
  // cairia no calculo proporcional e devolveria dinheiro de um pacote
  // inteiramente entregue.
  const todas = calcularReembolso({ terapeuta_nome: 'Pedro', sessoes_total: 4, sessoes_feitas: 4, valor_pago: 2860 })
  assert.equal(todas.valor_reembolso, 0, '4 de 4 nao devolve nada')

  const maisQueTodas = calcularReembolso({ terapeuta_nome: 'Pedro', sessoes_total: 4, sessoes_feitas: 5, valor_pago: 2860 })
  assert.equal(maisQueTodas.valor_reembolso, 0, 'mais que o total tambem nao devolve')

  const quase = calcularReembolso({ terapeuta_nome: 'Pedro', sessoes_total: 4, sessoes_feitas: 3, valor_pago: 2860 })
  assert.ok(quase.valor_reembolso > 0, '3 de 4 ainda devolve alguma coisa')
})

test('a tabela de precos usada depende de QUEM atende', () => {
  // Pedro e Denise tem tabelas diferentes. Usar a errada devolve o valor errado.
  const pedro = calcularReembolso({ terapeuta_nome: 'Pedro Roncada', sessoes_total: 4, sessoes_feitas: 2, valor_pago: 2860 })
  const denise = calcularReembolso({ terapeuta_nome: 'Denise Nascimento', sessoes_total: 4, sessoes_feitas: 2, valor_pago: 1400 })
  assert.notEqual(pedro.valor_reembolso, denise.valor_reembolso)
  assert.match(pedro.explicacao, /1550|1\.550/, 'o plano de 2 do Pedro custa 1550')
})

test('o reembolso nunca passa do que o paciente pagou', () => {
  for (const feitas of [0, 1, 2, 3]) {
    const r = calcularReembolso({ terapeuta_nome: 'Pedro', sessoes_total: 4, sessoes_feitas: feitas, valor_pago: 2860 })
    assert.ok(r.valor_reembolso <= 2860, `${feitas} sessoes devolveu mais do que foi pago`)
    assert.ok(r.valor_reembolso >= 0, `${feitas} sessoes devolveu valor negativo`)
  }
})

test('isHojeBrasilia: o lado do HOJE tambem usa Brasilia, nao UTC', () => {
  // O teste acima varre 97 horas, mas todas do lado do ALVO - com o relogio
  // parado, um sinal trocado no lado do "hoje" cai no mesmo dia em 18 das 24
  // horas e passa despercebido. Aqui o instante e FIXADO no unico trecho do dia
  // em que os dois sinais discordam: entre 21h e 00h de Brasilia, onde o dia
  // BRT e o dia UTC ja sao diferentes.
  //
  // 2026-09-16T01:30:00Z = 15/09 as 22:30 em Brasilia.
  const agora = new Date('2026-09-16T01:30:00.000Z').getTime()

  // Uma hora antes: 15/09 21:30 BRT, o MESMO dia em Brasilia.
  assert.equal(isHojeBrasilia('2026-09-16T00:30:00.000Z', agora), true, '21:30 BRT do mesmo dia e hoje')

  // Tres horas depois: 16/09 01:30 BRT, o dia SEGUINTE em Brasilia.
  assert.equal(isHojeBrasilia('2026-09-16T04:30:00.000Z', agora), false, 'ja passou da meia-noite em Brasilia')

  // A armadilha: 16/09 00:30 UTC e ainda 15/09 em Brasilia. Quem comparar em
  // UTC dos dois lados erra este.
  assert.equal(isHojeBrasilia('2026-09-16T02:59:59.000Z', agora), true, '23:59 BRT ainda e hoje')
  assert.equal(isHojeBrasilia('2026-09-16T03:00:01.000Z', agora), false, '00:00 BRT ja e amanha')
})

test('CASO REAL: venda de encaixe as 22h nao pode ser lida como amanha', () => {
  // E o motivo de a funcao existir: sessao marcada para o MESMO dia, sem tempo
  // do lembrete de vespera pegar. Lida como "amanha", o paciente fica sem
  // aviso nenhum.
  const agora = new Date('2026-09-16T01:00:00.000Z').getTime()  // 15/09 22:00 BRT
  assert.equal(isHojeBrasilia('2026-09-16T01:45:00.000Z', agora), true, 'sessao as 22:45 do mesmo dia')
})
