import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAgendamento, type EstadoDoModal, type VendaNaTela } from './decisao-de-agendamento'

// Caso real: Amanda da Silva Rios pagou o pacote de 8 em duas compras, R$ 2.600
// em 24/08 21:28 e R$ 2.680 em 25/08 12:43, as duas com oferta "Formato - 4
// Sessão". Isoladas cada uma parece 4 sessões pagas a menos; somadas são 8 por
// R$ 5.280, que é o preço de tabela.
const PAI: VendaNaTela = {
  id: 'pai', email: 'amanda@x.com', produto: 'Mentoria Particular - Pedro Roncada',
  data_hora: '2026-08-25T00:28:06Z', oferta_nome: 'Formato - 4 Sessão', preco_base: 2600,
}
const IRMA: VendaNaTela = {
  id: 'irma', email: 'amanda@x.com', produto: 'Mentoria Particular - Pedro Roncada',
  data_hora: '2026-08-25T15:43:50Z', oferta_nome: 'Formato - 4 Sessão', preco_base: 2680,
}

const base = (o: Partial<EstadoDoModal>): EstadoDoModal => ({
  venda: PAI, totalDoDiagnostico: null, pendentes: [], ativos: [], filhas: [],
  entreguesPorVenda: {}, resposta: null, ...o,
})

test('as irmãs saem de vendas_filhas: pacote já ligado soma 8, não 4', () => {
  // A irmã foi ligada numa resposta anterior: ela NÃO está em pendentes (foi
  // filtrada) nem em ativos (não tem sessão). Procurá-la nessas duas listas
  // devolvia vazio e o pacote de 8 era agendado com 4.
  const d = decidirAgendamento(base({ filhas: [{ ...IRMA, pacote_pai_id: 'pai' }] }))
  assert.equal(d.numeroDeSessoes, 8)
  assert.equal(d.confere?.situacao, 'ok')
})

test('sem a irmã na conta, a MESMA venda dá 4 e valor divergente — o teste tem contraste', () => {
  const d = decidirAgendamento(base({}))
  assert.equal(d.numeroDeSessoes, 4)
  assert.equal(d.confere?.situacao, 'valor_divergente')
})

test('a candidata CONFIRMADA agora entra na conta antes de recarregar a página', () => {
  // O link e o agendamento acontecem no mesmo clique. Se a candidata só contasse
  // depois do reload, o sistema juntava as duas compras e agendava 4 sessões de
  // um pacote de 8, com o modal dizendo "4 sessões agendadas".
  const d = decidirAgendamento(base({
    pendentes: [IRMA],
    resposta: { saleId: 'pai', valor: 'mesmo_pacote' },
  }))
  assert.equal(d.respostaEfetiva, 'mesmo_pacote')
  assert.equal(d.candidata?.id, 'irma')
  assert.equal(d.numeroDeSessoes, 8)
})

test('"compra separada" NÃO soma a candidata', () => {
  const d = decidirAgendamento(base({
    pendentes: [IRMA],
    resposta: { saleId: 'pai', valor: 'compra_separada' },
  }))
  assert.equal(d.numeroDeSessoes, 4)
})

test('a resposta dada em OUTRA venda não vaza para esta', () => {
  // Sem o carimbo do sale_id, responder "é o mesmo pacote" uma vez fazia toda
  // venda agendada na mesma sessão de página mandar a mesma resposta.
  const d = decidirAgendamento(base({
    pendentes: [IRMA],
    resposta: { saleId: 'outra-venda-qualquer', valor: 'mesmo_pacote' },
  }))
  assert.equal(d.respostaEfetiva, null)
  assert.equal(d.numeroDeSessoes, 4)
})

test('quantidade indeterminada trava o botão e NUNCA vira 1', () => {
  // Caso real: Cristiane Neves Duarte, R$ 4.000 sem oferta registrada. Cair no
  // palpite de 1 sessão daria a ela uma sessão onde pagou por um pacote.
  const d = decidirAgendamento(base({
    venda: { id: 'c', email: 'cris@x.com', produto: 'Mentoria Particular - Pedro Roncada', data_hora: '2026-06-02T14:44:00Z', oferta_nome: null, preco_base: 4000 },
  }))
  assert.equal(d.confere?.situacao, 'indeterminado')
  assert.equal(d.travado, true)
  assert.notEqual(d.numeroDeSessoes, 1)
  assert.equal(d.numeroDeSessoes, 0)
})

test('lançamento manual fica FORA da regra da oferta e não trava', () => {
  // São 34 nos últimos 90 dias, com preco_base que não bate em tabela nenhuma.
  // Aplicar a regra ali deixaria essas vendas impossíveis de agendar.
  const d = decidirAgendamento(base({
    venda: { id: 'manual_1785342449562_74rv6l', email: 'x@x.com', produto: 'Mentoria Particular - Pedro Roncada', data_hora: '2026-07-29T16:23:00Z', oferta_nome: null, preco_base: 0 },
  }))
  assert.equal(d.confere, null)
  assert.equal(d.numeroDeSessoes, null, 'null = a quantidade continua vindo de quem lançou')
  assert.equal(d.travado, false)
})

test('Diagnóstico Guiado continua vindo do formato, sem passar pela oferta', () => {
  const d = decidirAgendamento(base({ totalDoDiagnostico: 9 }))
  assert.equal(d.numeroDeSessoes, 9)
  assert.equal(d.confere, null)
  assert.equal(d.travado, false)
})

test('valor divergente sozinho já pede resposta ao comercial', () => {
  const d = decidirAgendamento(base({}))
  assert.equal(d.tipoAResponder, 'valor_divergente')
})

test('retry do conflito de compromisso NÃO regrava a resposta', () => {
  // A resposta já foi gravada na primeira tentativa. Regravar batia em 409 e
  // travava o fluxo para sempre, ou duplicava ocorrência e nota de prontuário.
  const d = decidirAgendamento(base({
    pendentes: [IRMA],
    resposta: { saleId: 'pai', valor: 'mesmo_pacote' },
    ehRetryDeCompromisso: true,
  }))
  assert.equal(d.tipoAResponder, null)
  assert.equal(d.numeroDeSessoes, 8, 'a quantidade continua a do pacote inteiro')
})

test('lançamento manual não recebe proposta de juntar compras', () => {
  // A caixa "É o mesmo pacote" aparecia para venda manual e o POST ligava as
  // duas de verdade — mas a quantidade enviada continuava a do palpite por
  // preço, IGNORANDO a irmã. O mesmo defeito de "agendou 4 num pacote de 8",
  // vivo pelo caminho manual.
  const d = decidirAgendamento(base({
    venda: { id: 'manual_1785342449562_74rv6l', email: 'amanda@x.com', produto: PAI.produto, data_hora: '2026-08-25T00:28:06Z', oferta_nome: null, preco_base: 2600 },
    pendentes: [IRMA],
  }))
  assert.equal(d.candidata, null)
  assert.equal(d.tipoAResponder, null)
})

// Os dois testes abaixo usam os mesmos PAI/IRMA de cima, variando so em qual
// lista a irma chega - que e exatamente a diferenca entre a primeira e a
// segunda tentativa de agendamento.
test('SEGUNDA TENTATIVA: a irma ligada nao conta duas vezes', () => {
  // Quando o agendamento falha DEPOIS de a resposta ter sido gravada, a tela
  // recarrega e a candidata passa a chegar tambem por `filhas`. Sem guarda, a
  // conta somava 4 + 4 + 4 e pedia 12 sessoes num pacote de 8.
  const d = decidirAgendamento(base({
    filhas: [{ ...IRMA, pacote_pai_id: 'pai' }],
    resposta: { saleId: 'pai', valor: 'mesmo_pacote' },
  }))
  assert.equal(d.numeroDeSessoes, 8)
  // E a resposta nao e regravada: a ligacao ja esta no banco.
  assert.equal(d.tipoAResponder, null)
})

test('PRIMEIRA tentativa: a candidata ainda nao ligada conta, e a resposta e gravada', () => {
  const d = decidirAgendamento(base({
    pendentes: [IRMA],
    resposta: { saleId: 'pai', valor: 'mesmo_pacote' },
  }))
  assert.equal(d.numeroDeSessoes, 8)
  assert.equal(d.tipoAResponder, 'mesmo_pacote')
})
