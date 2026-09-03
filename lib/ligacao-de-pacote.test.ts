import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarLigacao, desfazerLinkSeAuditoriaFalhar, refazerLinkSeAuditoriaFalhar, type PedidoDeLigacao, type VendaParaLigar } from './ligacao-de-pacote'

const PRODUTO = 'Mentoria Particular - Pedro Roncada'
// Datas reais das duas compras da Amanda: 15h de distancia, dentro da janela.
const venda: VendaParaLigar = { id: 'pai', email: 'amanda@x.com', produto: PRODUTO, status: 'aprovada', data_hora: '2026-08-25T12:43:00Z' }
const irma: VendaParaLigar = { id: 'irma', email: 'amanda@x.com', produto: PRODUTO, status: 'aprovada', data_hora: '2026-08-24T21:28:00Z' }

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

test('a janela de 24h vale no SERVIDOR, nao so na tela', () => {
  // A regra central do negocio vivia so no cliente: a rota aceitava juntar duas
  // compras separadas por meses - exatamente o caso que a regra existe para nao
  // juntar (pacote consumido e recomprado depois).
  const r = avaliarLigacao(p({ irma: { ...irma, data_hora: '2026-06-19T12:00:00Z' } }))
  assert.equal(r.acao, 'recusar')
  assert.equal(r.acao === 'recusar' && r.status, 409)
  assert.match(r.acao === 'recusar' ? r.erro : '', /acima do limite de 24h/)
})

test('exatamente na janela ainda liga; um minuto depois nao', () => {
  const em24h = { ...irma, data_hora: '2026-08-24T12:43:00Z' }
  assert.deepEqual(avaliarLigacao(p({ irma: em24h })), { acao: 'ligar' })
  const passou = { ...irma, data_hora: '2026-08-24T12:42:00Z' }
  assert.equal(avaliarLigacao(p({ irma: passou })).acao, 'recusar')
})

test('sem data das duas compras nao da para conferir a janela: recusa', () => {
  // Recusar e o comportamento certo: assumir que passa juntaria compras
  // distantes sem ninguem ver.
  assert.equal(avaliarLigacao(p({ irma: { ...irma, data_hora: null } })).acao, 'recusar')
  assert.equal(avaliarLigacao(p({ irma: { ...irma, data_hora: 'nao-e-data' } })).acao, 'recusar')
})

test('RETRATACAO: dizer "compra separada" sobre uma irma JA ligada desfaz a ligacao', () => {
  // Sequencia real que isso destravava: o comercial junta as compras, o
  // agendamento falha por conflito de horario, ele reconsidera, clica em "E
  // compra separada" e segue. Antes a ligacao continuava gravada e o pacote de
  // 8 era agendado com 4 sessoes, com a outra compra escondida de todas as
  // telas para sempre.
  const ligada = { ...irma, pacote_pai_id: 'pai' }
  assert.deepEqual(avaliarLigacao(p({ tipo: 'compra_separada', irma: ligada })), { acao: 'desligar' })
  assert.deepEqual(avaliarLigacao(p({ tipo: 'valor_divergente', irma: ligada })), { acao: 'desligar' })
})

test('"compra separada" sobre irma NAO ligada continua so registrando', () => {
  assert.deepEqual(avaliarLigacao(p({ tipo: 'compra_separada' })), { acao: 'so_registrar' })
  // E nao desliga a filha de OUTRO pacote.
  const deOutro = { ...irma, pacote_pai_id: 'terceiro' }
  assert.deepEqual(avaliarLigacao(p({ tipo: 'compra_separada', irma: deOutro })), { acao: 'so_registrar' })
})

test('a auditoria falhando REFAZ so o desligamento feito nesta tentativa', () => {
  assert.equal(refazerLinkSeAuditoriaFalhar({ acao: 'desligar' }), true)
  assert.equal(refazerLinkSeAuditoriaFalhar({ acao: 'ligar' }), false)
  assert.equal(refazerLinkSeAuditoriaFalhar({ acao: 'ja_ligada' }), false)
  assert.equal(refazerLinkSeAuditoriaFalhar({ acao: 'so_registrar' }), false)
  // E o de desfazer nao dispara no desligamento.
  assert.equal(desfazerLinkSeAuditoriaFalhar({ acao: 'desligar' }), false)
})
