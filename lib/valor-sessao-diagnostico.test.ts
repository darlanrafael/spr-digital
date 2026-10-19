import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valorSessaoDoDiagnostico, PAGAMENTO_DENISE_POR_SESSAO } from './diagnostico-guiado'
import { repasseDoDiagnostico } from './repasse-do-diagnostico'

// Regra do dono (19/10/2026): o valor FIXO por sessao do Diagnostico e POR
// TERAPEUTA. A Denise recebe R$ 95, o Leomir R$ 90. Ate aqui o sistema pagava
// R$ 95 pra todo mundo (hardcoded), entao o fechamento do Leomir sairia R$ 5 a
// mais por sessao - achado da revisao antes de qualquer venda do Leomir fechar.

test('valorSessaoDoDiagnostico: Denise 95, Leomir 90, default 95', () => {
  assert.equal(valorSessaoDoDiagnostico('Denise Nascimento'), 95)
  assert.equal(valorSessaoDoDiagnostico('Leomir Santos'), 90)
  assert.equal(valorSessaoDoDiagnostico('Leomir Santos '), 90)   // nome com espaco, como no banco
  assert.equal(valorSessaoDoDiagnostico(null), PAGAMENTO_DENISE_POR_SESSAO)
  assert.equal(valorSessaoDoDiagnostico(undefined), 95)
  assert.equal(valorSessaoDoDiagnostico('Fulano de Tal'), 95)    // terapeuta desconhecido -> default
})

test('repasseDoDiagnostico usa a taxa passada (Leomir 90)', () => {
  // Uma venda Formato 1 (9 sessoes, 2 do Pedro -> 7 da terapeuta principal).
  const venda = { id: 'v1', nome: 'Cliente', produto: 'Diagnóstico Guiado: Programa de acompanhamento Individual - Leomir', oferta_nome: 'FORMATO 1', order_id: 'kw-1' }
  const r95 = repasseDoDiagnostico([venda])              // default 95 (compat)
  const r90 = repasseDoDiagnostico([venda], 90)          // Leomir
  assert.equal(r95.total, 7 * 95)                         // 665
  assert.equal(r90.total, 7 * 90)                         // 630
  assert.equal(r90.porVenda[0].valor, 630)
})

test('repasseDoDiagnostico sem taxa = 95 (Denise, comportamento antigo intacto)', () => {
  const venda = { id: 'v2', nome: 'C', produto: 'Diagnóstico Guiado: Programa de acompanhamento Individual', oferta_nome: 'FORMATO 2', order_id: 'kw-2' }
  // Formato 2 = 4 sessoes, 1 do Pedro -> 3 da Denise.
  assert.equal(repasseDoDiagnostico([venda]).total, 3 * 95)   // 285
})
