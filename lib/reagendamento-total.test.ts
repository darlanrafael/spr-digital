import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planejarReagendamentoTotal, resumirReagendamentoTotal } from './reagendamento-total'

const s = (numero_sessao: number, status: string, google_event_id: string | null = null) =>
  ({ id: `s${numero_sessao}`, numero_sessao, status, google_event_id })

test('venda sem sessao nenhuma: nada a substituir, agendamento normal', () => {
  const plano = planejarReagendamentoTotal([], 4)
  assert.equal(plano.ok, true)
  assert.deepEqual(plano.ok && plano.substituir, [])
})

test('venda so com pendentes: reagendamento total segue valendo', () => {
  const plano = planejarReagendamentoTotal([
    s(1, 'agendada', 'ev1'), s(2, 'pendente'), s(3, 'remarcada', 'ev3'),
  ], 3)
  assert.equal(plano.ok, true)
  assert.deepEqual(plano.ok && plano.substituir.map(x => x.numero_sessao), [1, 2, 3])
})

// O caso do achado: hoje o delete apaga as pendentes, os eventos do Google sao
// cancelados e so entao o insert bate no unique (sale_id, numero_sessao). A
// recusa tem que vir antes de qualquer uma dessas coisas.
test('venda com sessao entregue e recusada antes de destruir qualquer coisa', () => {
  const plano = planejarReagendamentoTotal([
    s(1, 'entregue'), s(2, 'agendada', 'ev2'), s(3, 'agendada', 'ev3'),
  ], 3)
  assert.equal(plano.ok, false)
  // Nao ha lista de sessoes a apagar: o chamador nao tem o que destruir.
  assert.equal('substituir' in plano, false)
  assert.deepEqual(!plano.ok && plano.entregues, [1])
  assert.match(!plano.ok ? plano.erro : '', /entregue/)
  assert.match(!plano.ok ? plano.erro : '', /remarque uma a uma/i)
})

test('estado misto com varias entregues: mensagem lista todas em ordem', () => {
  const plano = planejarReagendamentoTotal([
    s(3, 'entregue'), s(1, 'entregue'), s(2, 'entregue'), s(4, 'agendada', 'ev4'),
  ], 4)
  assert.equal(plano.ok, false)
  assert.deepEqual(!plano.ok && plano.entregues, [1, 2, 3])
  assert.match(!plano.ok ? plano.erro : '', /as sessões 1, 2 e 3/)
})

test('entregue fora de ordem tambem bloqueia', () => {
  const plano = planejarReagendamentoTotal([s(1, 'agendada'), s(2, 'entregue')], 2)
  assert.equal(plano.ok, false)
})

test('entregue alem do tamanho do pacote novo continua bloqueando', () => {
  // Nao colide com a numeracao 1..2, mas refazer o pacote reescreveria
  // total_sessoes e comissao de um atendimento que ja aconteceu.
  const plano = planejarReagendamentoTotal([s(1, 'agendada'), s(9, 'entregue')], 2)
  assert.equal(plano.ok, false)
  assert.deepEqual(!plano.ok && plano.entregues, [9])
})

// O caso que a versao anterior desta trava deixava passar, e que este mesmo
// teste chegou a cristalizar como "comportamento esperado": 'cancelada'
// sobrevive ao delete (nao esta em STATUS_SUBSTITUIVEIS) e nao era conferida,
// entao o insert do pacote novo batia no unique com as pendentes JA apagadas e
// os convites do paciente JA cancelados no Google.
test('cancelada na faixa 1..N recusa sem destruir nada', () => {
  const plano = planejarReagendamentoTotal([s(1, 'cancelada'), s(2, 'agendada', 'ev2')], 2)
  assert.equal(plano.ok, false)
  assert.equal('substituir' in plano, false)
  assert.deepEqual(!plano.ok && plano.colidem, [1])
  assert.deepEqual(!plano.ok && plano.entregues, [])
  assert.match(!plano.ok ? plano.erro : '', /cancelada/)
})

// Cenario concreto do achado, todo por caminho de producao: pacote de 4 sem
// nenhuma entregue, reembolso parcial de 2 sessoes aprovado pelo CEO (que grava
// status 'cancelada' sem mexer no numero_sessao), e alguem abrindo o deep link
// "Agendar" da venda depois.
test('reembolso parcial aprovado: cancelada 1 e 2 travam o refazer do pacote de 4', () => {
  const plano = planejarReagendamentoTotal([
    s(1, 'cancelada'), s(2, 'cancelada'), s(3, 'agendada', 'ev3'), s(4, 'agendada', 'ev4'),
  ], 4)
  assert.equal(plano.ok, false)
  assert.deepEqual(!plano.ok && plano.colidem, [1, 2])
  assert.match(!plano.ok ? plano.erro : '', /as sessões 1 e 2/)
  assert.match(!plano.ok ? plano.erro : '', /remarque uma a uma/i)
})

test('cancelada fora da faixa do pacote novo nao bloqueia', () => {
  // Pacote novo de 2 sessoes: a numeracao 1..2 esta livre, a cancelada 3 fica
  // onde esta e o insert nao colide com ela.
  const plano = planejarReagendamentoTotal([s(1, 'agendada', 'ev1'), s(3, 'cancelada')], 2)
  assert.equal(plano.ok, true)
  assert.deepEqual(plano.ok && plano.substituir.map(x => x.numero_sessao), [1])
})

test('status desconhecido tambem sobrevive ao delete e bloqueia na faixa', () => {
  // A trava e por sobrevivencia, nao por lista de nomes de status: qualquer
  // status novo criado no futuro entra aqui sozinho.
  const plano = planejarReagendamentoTotal([s(1, 'em_disputa'), s(2, 'agendada')], 2)
  assert.equal(plano.ok, false)
  assert.deepEqual(!plano.ok && plano.colidem, [1])
})

test('total nao confiavel assume o pior caso e recusa', () => {
  const plano = planejarReagendamentoTotal([s(1, 'cancelada')], Number.NaN)
  assert.equal(plano.ok, false)
})

test('resumo conta o que a tela precisa avisar antes de confirmar', () => {
  const r = resumirReagendamentoTotal([
    { numero_sessao: 1, status: 'entregue' },
    { numero_sessao: 2, status: 'agendada', link_meet: 'https://meet.google.com/abc' },
    { numero_sessao: 3, status: 'agendada', link_meet: null },
    { numero_sessao: 4, status: 'cancelada' },
  ], 4)
  assert.deepEqual(r, {
    total: 4, substituiveis: 2, entregues: 1, colidem: [4],
    comConvite: 1, bloqueado: true, motivoBloqueio: 'entregue',
  })
})

test('resumo bloqueia por numeracao quando so ha cancelada na faixa', () => {
  const r = resumirReagendamentoTotal([
    { numero_sessao: 1, status: 'cancelada' },
    { numero_sessao: 2, status: 'agendada', google_event_id: 'ev2' },
  ], 2)
  assert.deepEqual(r, {
    total: 2, substituiveis: 1, entregues: 0, colidem: [1],
    comConvite: 1, bloqueado: true, motivoBloqueio: 'numeracao',
  })
})

test('resumo de venda ainda sem sessao nao bloqueia nada', () => {
  assert.deepEqual(resumirReagendamentoTotal([], 4), {
    total: 0, substituiveis: 0, entregues: 0, colidem: [],
    comConvite: 0, bloqueado: false, motivoBloqueio: null,
  })
})

// A tela e a rota tem que concordar: botao verde com 400 na sequencia foi
// exatamente o defeito que a declaracao previa deveria ter fechado.
test('resumo e plano concordam sobre bloquear em cada cenario', () => {
  const cenarios: { sessoes: ReturnType<typeof s>[]; n: number }[] = [
    { sessoes: [], n: 4 },
    { sessoes: [s(1, 'agendada'), s(2, 'pendente')], n: 2 },
    { sessoes: [s(1, 'entregue'), s(2, 'agendada')], n: 2 },
    { sessoes: [s(1, 'cancelada'), s(2, 'agendada')], n: 2 },
    { sessoes: [s(1, 'agendada'), s(3, 'cancelada')], n: 2 },
    { sessoes: [s(1, 'agendada'), s(9, 'entregue')], n: 2 },
  ]
  for (const { sessoes, n } of cenarios) {
    const plano = planejarReagendamentoTotal(sessoes, n)
    const resumo = resumirReagendamentoTotal(sessoes, n)
    assert.equal(resumo.bloqueado, !plano.ok, JSON.stringify({ sessoes, n }))
  }
})
