import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertasDeEstornoComSessao, vendasComLembreteSuspenso } from './estorno-com-sessao'

const AGORA = '2026-09-09T15:00:00Z'
const venda = (o: Partial<Parameters<typeof alertasDeEstornoComSessao>[0]['vendas'][number]> = {}) => ({
  id: 'v1', nome: 'Fulano', email: 'fulano@x.com', produto: 'Mentoria',
  status: 'reembolsada', valor_pago_cliente: 2860, data_reembolso: '2026-08-11', ...o,
})
const sessao = (o: Partial<Parameters<typeof alertasDeEstornoComSessao>[0]['sessoes'][number]> = {}) => ({
  id: 's1', sale_id: 'v1', data_agendada: '2026-09-15T22:20:00Z', status: 'agendada', ...o,
})

test('o caso central: estorno na plataforma com sessao futura', () => {
  const r = alertasDeEstornoComSessao({ vendas: [venda()], sessoes: [sessao()], agoraISO: AGORA })
  assert.equal(r.length, 1)
  assert.equal(r[0].saleId, 'v1')
  assert.equal(r[0].sessoes.length, 1)
})

test('CASO REAL DA CRIS: paciente com OUTRA venda aprovada nao alerta', () => {
  // Ela pagou no cartao, achou o juro alto, foi reembolsada e pagou por PIX 21
  // minutos depois. Tem estorno e tem pagamento ao mesmo tempo. Alertar aqui
  // treinaria todo mundo a ignorar o alerta.
  const r = alertasDeEstornoComSessao({
    vendas: [
      venda({ id: 'cartao', valor_pago_cliente: 3549.48 }),
      venda({ id: 'pix', status: 'aprovada', data_reembolso: null }),
    ],
    sessoes: [sessao({ sale_id: 'cartao' })],
    agoraISO: AGORA,
  })
  assert.deepEqual(r, [])
})

test('CASO REAL: lancamento manual marcado como reembolsada nao alerta', () => {
  // Manual nao vem de plataforma nenhuma, entao nao existe estorno de verdade
  // nele. Na base, um foi marcado a mao so para sinalizar que nao era venda
  // real - alertar ali seria alarme falso puro.
  const r = alertasDeEstornoComSessao({
    vendas: [venda({ id: 'manual_1784602139974_4138pg' })],
    sessoes: [sessao({ sale_id: 'manual_1784602139974_4138pg' })],
    agoraISO: AGORA,
  })
  assert.deepEqual(r, [])
})

test('e o manual tambem nao SALVA outra venda do alerta', () => {
  // Se a unica venda "aprovada" do paciente e um lancamento manual, o estorno
  // real continua sendo estorno: nao ha dinheiro de plataforma cobrindo.
  const r = alertasDeEstornoComSessao({
    vendas: [venda(), venda({ id: 'manual_x', status: 'aprovada', data_reembolso: null })],
    sessoes: [sessao()],
    agoraISO: AGORA,
  })
  assert.equal(r.length, 1)
})

test('sessao passada, entregue ou cancelada nao gera alerta', () => {
  for (const s of [
    sessao({ data_agendada: '2026-09-01T12:00:00Z' }),
    sessao({ status: 'entregue' }),
    sessao({ status: 'cancelada' }),
    sessao({ data_agendada: null }),
  ]) {
    assert.deepEqual(alertasDeEstornoComSessao({ vendas: [venda()], sessoes: [s], agoraISO: AGORA }), [])
  }
})

test('venda aprovada nao alerta, mesmo com sessao futura', () => {
  const r = alertasDeEstornoComSessao({
    vendas: [venda({ status: 'aprovada', data_reembolso: null })], sessoes: [sessao()], agoraISO: AGORA,
  })
  assert.deepEqual(r, [])
})

test('CANCELADA fica de fora: e correcao de faturamento, nao devolucao', () => {
  const r = alertasDeEstornoComSessao({ vendas: [venda({ status: 'cancelada' })], sessoes: [sessao()], agoraISO: AGORA })
  assert.deepEqual(r, [])
})

test('chargeback e em_protesto alertam igual', () => {
  for (const status of ['chargeback', 'em_protesto']) {
    const r = alertasDeEstornoComSessao({ vendas: [venda({ status })], sessoes: [sessao()], agoraISO: AGORA })
    assert.equal(r.length, 1, status)
  }
})

test('a sessao mais proxima vem primeiro, e o alerta mais urgente tambem', () => {
  const r = alertasDeEstornoComSessao({
    vendas: [
      venda({ id: 'a', email: 'a@x.com' }),
      venda({ id: 'b', email: 'b@x.com' }),
    ],
    sessoes: [
      sessao({ id: 's-a2', sale_id: 'a', data_agendada: '2026-10-01T12:00:00Z' }),
      sessao({ id: 's-a1', sale_id: 'a', data_agendada: '2026-09-20T12:00:00Z' }),
      sessao({ id: 's-b',  sale_id: 'b', data_agendada: '2026-09-12T12:00:00Z' }),
    ],
    agoraISO: AGORA,
  })
  assert.deepEqual(r.map(x => x.saleId), ['b', 'a'], 'b tem sessao mais proxima')
  assert.deepEqual(r[1].sessoes.map(s => s.id), ['s-a1', 's-a2'])
})

test('o lembrete e suspenso exatamente para quem alerta', () => {
  const p = { vendas: [venda()], sessoes: [sessao()], agoraISO: AGORA }
  assert.deepEqual([...vendasComLembreteSuspenso(p)], ['v1'])
  // E nao para a Cris.
  const cris = {
    vendas: [venda({ id: 'cartao' }), venda({ id: 'pix', status: 'aprovada', data_reembolso: null })],
    sessoes: [sessao({ sale_id: 'cartao' })], agoraISO: AGORA,
  }
  assert.deepEqual([...vendasComLembreteSuspenso(cris)], [])
})

test('e-mail vazio nao junta pacientes diferentes por engano', () => {
  // Duas vendas sem e-mail nao podem virar "o mesmo paciente".
  const r = alertasDeEstornoComSessao({
    vendas: [venda({ email: null }), venda({ id: 'outra', email: null, status: 'aprovada', data_reembolso: null })],
    sessoes: [sessao()],
    agoraISO: AGORA,
  })
  assert.equal(r.length, 1, 'o estorno continua sendo estorno')
})
