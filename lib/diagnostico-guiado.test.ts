import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatoDaVenda, montarPacote, PAGAMENTO_DENISE_POR_SESSAO, quebraIntervalo, novasDatasSeguintes } from './diagnostico-guiado'

const venda = (order_id: string | undefined, id = 'v1') => ({ id, order_id }) as never

test('oferta do Formato 1 devolve 9 sessoes, 2 do Pedro', () => {
  const f = formatoDaVenda(venda('06547c74-56d5-4cd6-9046-289d8f3ab9bd-WXwmPZfJxGqeXerA6dkO'))
  assert.deepEqual(f, { formato: 1, totalSessoes: 9, sessoesPedro: 2 })
})

test('oferta do Formato 3 devolve 2 sessoes, 1 do Pedro', () => {
  const f = formatoDaVenda(venda('347281e4-f007-44ac-9264-e41da730b2e4-qVvads7GKaI7lN1Kctrr'))
  assert.deepEqual(f, { formato: 3, totalSessoes: 2, sessoesPedro: 1 })
})

test('oferta desconhecida devolve null em vez de adivinhar', () => {
  assert.equal(formatoDaVenda(venda('11111111-2222-3333-4444-555555555555-OFERTANOVA')), null)
})

test('oferta Padrao de R$ 10,00 do mesmo produto nao vira pacote', () => {
  assert.equal(formatoDaVenda(venda('11111111-2222-3333-4444-555555555555-wd6AwMQIJGAekPCGCRsb')), null)
})

test('oferta do Formato 2 devolve 4 sessoes, 1 do Pedro', () => {
  const f = formatoDaVenda(venda('11111111-2222-3333-4444-555555555555-H8DA8U21x7Lmv3NreVMs'))
  assert.deepEqual(f, { formato: 2, totalSessoes: 4, sessoesPedro: 1 })
})

test('lancamento manual nao tem order_id e devolve null', () => {
  assert.equal(formatoDaVenda(venda(undefined, 'manual_1788034875487_zrpmrz')), null)
})

test('venda da Juliane (real, Formato 3)', () => {
  const f = formatoDaVenda(venda('347281e4-f007-44ac-9264-e41da730b2e4-qVvads7GKaI7lN1Kctrr'))
  assert.equal(f?.formato, 3)
})

const F1 = { formato: 1 as const, totalSessoes: 9, sessoesPedro: 2 }
const F3 = { formato: 3 as const, totalSessoes: 2, sessoesPedro: 1 }
const ARGS = { primeiraDataISO: '2026-09-08T14:00:00.000Z', pedroId: 'PEDRO', deniseId: 'DENISE' }

test('Formato 1: 9 sessoes, as duas primeiras do Pedro', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  assert.equal(p.length, 9)
  assert.deepEqual(p.map(s => s.terapeuta_id), ['PEDRO','PEDRO','DENISE','DENISE','DENISE','DENISE','DENISE','DENISE','DENISE'])
})

test('Formato 3: uma sessao para cada, Pedro primeiro', () => {
  const p = montarPacote({ formato: F3, ...ARGS })
  assert.deepEqual(p.map(s => s.terapeuta_id), ['PEDRO','DENISE'])
})

test('7 dias entre todas, inclusive na virada de terapeuta', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  const SETE = 7 * 24 * 60 * 60 * 1000
  for (let i = 1; i < p.length; i++) {
    const dif = new Date(p[i].data_agendada).getTime() - new Date(p[i-1].data_agendada).getTime()
    assert.equal(dif, SETE, `intervalo errado entre a sessao ${i} e a ${i+1}`)
  }
})

test('a Denise recebe R$ 95 por sessao dela e o Pedro zero', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  assert.deepEqual(p.filter(s => s.terapeuta_id === 'PEDRO').map(s => s.comissao_valor), [0, 0])
  assert.equal(p.filter(s => s.terapeuta_id === 'DENISE').every(s => s.comissao_valor === PAGAMENTO_DENISE_POR_SESSAO), true)
  assert.equal(p.reduce((a, s) => a + s.comissao_valor, 0), 7 * 95)
})

test('numero_sessao vai de 1 a N, em ordem', () => {
  const p = montarPacote({ formato: F1, ...ARGS })
  assert.deepEqual(p.map(s => s.numero_sessao), [1,2,3,4,5,6,7,8,9])
})

test('a primeira sessao cai exatamente na data pedida', () => {
  const p = montarPacote({ formato: F3, ...ARGS })
  assert.equal(p[0].data_agendada, '2026-09-08T14:00:00.000Z')
})

test('mover para menos de 7 dias da anterior quebra o intervalo', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-10T14:00:00.000Z',
    anteriorISO: '2026-09-08T14:00:00.000Z',
  }), true)
})

test('exatamente 7 dias nao quebra', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-15T14:00:00.000Z',
    anteriorISO: '2026-09-08T14:00:00.000Z',
  }), false)
})

test('mais de 7 dias nao quebra', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-20T14:00:00.000Z',
    anteriorISO: '2026-09-08T14:00:00.000Z',
  }), false)
})

test('sem vizinhos nao ha o que quebrar', () => {
  assert.equal(quebraIntervalo({ novaDataISO: '2026-09-10T14:00:00.000Z' }), false)
})

test('encostar na seguinte tambem quebra', () => {
  assert.equal(quebraIntervalo({
    novaDataISO: '2026-09-20T14:00:00.000Z',
    seguinteISO: '2026-09-22T14:00:00.000Z',
  }), true)
})

test('gera as datas seguintes de 7 em 7 dias a partir da base', () => {
  const d = novasDatasSeguintes({ baseISO: '2026-09-08T14:00:00.000Z', quantidade: 3 })
  assert.deepEqual(d, [
    '2026-09-15T14:00:00.000Z',
    '2026-09-22T14:00:00.000Z',
    '2026-09-29T14:00:00.000Z',
  ])
})

test('quantidade zero devolve lista vazia', () => {
  assert.deepEqual(novasDatasSeguintes({ baseISO: '2026-09-08T14:00:00.000Z', quantidade: 0 }), [])
})

test('a base nunca aparece na lista, ela ja esta marcada', () => {
  const d = novasDatasSeguintes({ baseISO: '2026-09-08T14:00:00.000Z', quantidade: 2 })
  assert.equal(d.includes('2026-09-08T14:00:00.000Z'), false)
})
