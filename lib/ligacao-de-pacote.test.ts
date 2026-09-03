import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarLigacao, desfazerLinkSeAuditoriaFalhar, type PedidoDeLigacao, type VendaParaLigar } from './ligacao-de-pacote'

const PRODUTO = 'Mentoria Particular - Pedro Roncada'
const venda: VendaParaLigar = { id: 'pai', email: 'amanda@x.com', produto: PRODUTO, status: 'aprovada' }
const irma: VendaParaLigar = { id: 'irma', email: 'amanda@x.com', produto: PRODUTO, status: 'aprovada' }

const p = (o: Partial<PedidoDeLigacao> = {}): PedidoDeLigacao => ({
  tipo: 'mesmo_pacote', irmaId: 'irma', venda, irma,
  irmaTemFilhas: false, irmaTemSessoes: false, ...o,
})

test('caso feliz: as duas compras da Amanda são ligadas', () => {
  assert.deepEqual(avaliarLigacao(p()), { acao: 'ligar' })
})

test('a rota NÃO confia na tela: paciente diferente é recusado', () => {
  // Ligar duas vendas de pacientes diferentes dá ao segundo paciente um pacote
  // que não é dele e some com a compra dele de Pendentes.
  const r = avaliarLigacao(p({ irma: { ...irma, email: 'outro@x.com' } }))
  assert.equal(r.acao, 'recusar')
  assert.equal(r.acao === 'recusar' && r.status, 400)
})

test('e-mail vazio dos dois lados não é "mesmo paciente"', () => {
  const r = avaliarLigacao(p({ venda: { ...venda, email: '' }, irma: { ...irma, email: null } }))
  assert.equal(r.acao, 'recusar')
})

test('produto diferente é recusado', () => {
  assert.equal(avaliarLigacao(p({ irma: { ...irma, produto: 'Mentoria Particular - Denise' } })).acao, 'recusar')
})

test('irmã reembolsada não entra num pacote', () => {
  assert.equal(avaliarLigacao(p({ irma: { ...irma, status: 'reembolsada' } })).acao, 'recusar')
})

test('irmã com sessões agendadas é pacote próprio: recusa 409', () => {
  // Ligá-la esconderia as sessões dela de todas as telas, que passam a olhar só
  // a venda-pai.
  const r = avaliarLigacao(p({ irmaTemSessoes: true }))
  assert.equal(r.acao, 'recusar')
  assert.equal(r.acao === 'recusar' && r.status, 409)
})

test('corrente de três compras é barrada', () => {
  // A->B ligado, o agendamento falha, e B->C deixaria B->A->C com uma compra
  // fora da soma do pacote.
  assert.equal(avaliarLigacao(p({ irmaTemFilhas: true })).acao, 'recusar')
})

test('venda que já é filha não pode virar pai (ciclo A->B, B->A)', () => {
  assert.equal(avaliarLigacao(p({ venda: { ...venda, pacote_pai_id: 'outro' } })).acao, 'recusar')
})

test('irmã já ligada a um TERCEIRO pacote é recusada', () => {
  assert.equal(avaliarLigacao(p({ irma: { ...irma, pacote_pai_id: 'terceiro' } })).acao, 'recusar')
})

test('IDEMPOTENTE: irmã já ligada a ESTA venda não é 409, é "já ligada"', () => {
  // Qualquer falha do agendamento depois do link (conflito de agenda, 500,
  // timeout) fazia a próxima tentativa bater em 409 e nunca mais agendar, sem
  // nada na tela dizendo o motivo.
  assert.deepEqual(avaliarLigacao(p({ irma: { ...irma, pacote_pai_id: 'pai' } })), { acao: 'ja_ligada' })
})

test('a venda não pode ser irmã dela mesma', () => {
  assert.equal(avaliarLigacao(p({ irmaId: 'pai' })).acao, 'recusar')
})

test('"mesmo pacote" sem dizer qual é a outra venda é recusado', () => {
  assert.equal(avaliarLigacao(p({ irmaId: null })).acao, 'recusar')
})

test('compra separada e valor divergente só registram, nunca ligam', () => {
  assert.deepEqual(avaliarLigacao(p({ tipo: 'compra_separada', irmaId: null })), { acao: 'so_registrar' })
  assert.deepEqual(avaliarLigacao(p({ tipo: 'valor_divergente', irmaId: null })), { acao: 'so_registrar' })
})

test('a auditoria falhando desfaz SÓ o link criado nesta tentativa', () => {
  // Desfazer um link já gravado e auditado numa tentativa anterior destrói dado
  // bom: a filha volta para Pendentes com uma ocorrência de "compras juntadas"
  // registrada para compras que não estão mais juntadas, e nada detecta isso.
  assert.equal(desfazerLinkSeAuditoriaFalhar({ acao: 'ligar' }), true)
  assert.equal(desfazerLinkSeAuditoriaFalhar({ acao: 'ja_ligada' }), false)
  assert.equal(desfazerLinkSeAuditoriaFalhar({ acao: 'so_registrar' }), false)
})
