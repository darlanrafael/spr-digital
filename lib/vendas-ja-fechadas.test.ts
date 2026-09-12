import { test } from 'node:test'
import assert from 'node:assert/strict'
import { separarJaFechadas, fechamentoQueContou } from './vendas-ja-fechadas'
import type { Closing, Sale } from '@/types'

// Fechamento real: confirmado 06/07 às 21:36 BRT (00:36 UTC do dia 07).
// Imersão fechou numa janela própria (12/05-22/06); O RESGATE no principal.
const ANTERIOR = {
  id: 'close_1', data: '2026-07-07',
  data_confirmacao: '2026-07-07T00:36:23.964+00:00',
  periodo: { inicio: '2026-06-01', fim: '2026-07-06' },
  produtos_incluidos: ['O RESGATE', 'Imersão - A reaproximação'],
  produtos_periodos: [{ inicio: '2026-05-12', fim: '2026-06-22', produtos: ['Imersão - A reaproximação'] }],
  alertas: [],
} as unknown as Closing

const venda = (o: Partial<Sale>): Sale => ({
  id: 'v', nome: 'x', email: '', telefone: '', produto: 'O RESGATE', plataforma: 'hubla',
  preco_base: 697, valor_pago_cliente: 697, valor_liquido: 671, data_hora: '2026-07-06T12:00:00',
  utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
  status: 'aprovada', projetoId: 'proj_1', ...o,
} as Sale)

test('venda já contada num fechamento confirmado é separada', () => {
  // Antônio Belone: 06/07 às 18:16 BRT, antes da confirmação das 21:36.
  const r = separarJaFechadas([venda({ id: 'belone', data_hora: '2026-07-06T21:16:44' })], [ANTERIOR])
  assert.equal(r.jaFechadas.length, 1)
  assert.equal(r.novas.length, 0)
  assert.equal(r.jaFechadas[0].fechamentoId, 'close_1')
})

test('O CASO CENTRAL: venda do mesmo dia, feita DEPOIS da confirmação, entra normalmente', () => {
  // 07/07 01:00 UTC = 06/07 22:00 BRT — meia hora depois do fechamento.
  const r = separarJaFechadas([venda({ id: 'tardia', data_hora: '2026-07-07T01:00:00' })], [ANTERIOR])
  assert.equal(r.novas.length, 1)
  assert.equal(r.jaFechadas.length, 0)
})

test('respeita a janela própria do produto no fechamento anterior', () => {
  // Imersão fechou até 22/06 lá; uma venda de 24/06 nunca entrou naquele fechamento.
  const r = separarJaFechadas(
    [venda({ produto: 'Imersão - A reaproximação', data_hora: '2026-06-24T10:00:00' })],
    [ANTERIOR],
  )
  assert.equal(r.novas.length, 1)
})

test('produto que não estava no fechamento anterior não é afetado', () => {
  const r = separarJaFechadas([venda({ produto: 'Como convencer seu cônjuge' })], [ANTERIOR])
  assert.equal(r.novas.length, 1)
})

test('venda fora da janela do fechamento anterior não é afetada', () => {
  const r = separarJaFechadas([venda({ data_hora: '2026-05-20T10:00:00' })], [ANTERIOR])
  assert.equal(r.novas.length, 1)
})

test('sem fechamentos anteriores, tudo é venda nova', () => {
  const r = separarJaFechadas([venda({}), venda({ id: 'b' })], [])
  assert.equal(r.novas.length, 2)
})

test('fechamento sem data_confirmacao é ignorado', () => {
  const rascunho = { ...ANTERIOR, data_confirmacao: undefined } as unknown as Closing
  const r = separarJaFechadas([venda({})], [rascunho])
  assert.equal(r.novas.length, 1)
})

test('cenário do usuário: fechar de 06/07 a 14/08 não repete nada e não perde as tardias', () => {
  const r = separarJaFechadas([
    venda({ id: 'belone',  data_hora: '2026-07-06T21:16:44' }), // já fechada
    venda({ id: 'marcos',  data_hora: '2026-07-06T02:23:51' }), // já fechada
    venda({ id: 'tardia',  data_hora: '2026-07-07T01:30:00' }), // depois da confirmação
    venda({ id: 'depois',  data_hora: '2026-07-20T10:00:00' }), // fora do fechamento antigo
  ], [ANTERIOR])
  assert.deepEqual(r.jaFechadas.map(x => x.id).sort(), ['belone', 'marcos'])
  assert.deepEqual(r.novas.map(x => x.id).sort(), ['depois', 'tardia'])
})

// ── O defeito de fuso, achado pelo pre-voo em 12/09/2026 ────────────────────
//
// `Sale.data_hora` vem de `normTs` em hora de BRASILIA sem fuso escrito;
// `data_confirmacao` vem do banco em UTC com fracao e `+00:00`. Comparar os dois
// como TEXTO errava por tres horas, e a direcao do erro era a pior: venda feita
// DEPOIS do fechamento era marcada como "ja fechada" e ficava presa.

test('CASO REAL: Marcio Adriano, R$ 2.827,65, feita 3h DEPOIS do fechamento', () => {
  // Numeros exatos de producao. A venda nao esta em `compradores` de nenhum
  // fechamento - nunca foi contada - e a trava a excluia dos proximos.
  const venda = {
    id: '48a4d120-6ec8-4098-aa0f-6435f4f1123d',
    produto: 'Mentoria Particular - Pedro Roncada',
    data_hora: '2026-08-14T14:42:44',   // BRT, como normTs devolve (17:42:44 UTC)
    valor_liquido: 2827.65,
  } as never
  const fechamento = {
    id: 'close_1786718768403',
    etiqueta: 'FECHAMENTO MENTORIAS - PEDRO',
    data_confirmacao: '2026-08-14T14:46:08.403+00:00',  // UTC = 11:46:08 BRT
    periodo: { inicio: '2026-07-06', fim: '2026-08-14' },
    produtos_incluidos: ['Mentoria Particular - Pedro Roncada'],
  } as never

  // Como TEXTO, '14:42:44' < '14:46:08.403+00:00' e a venda era dada como contada.
  assert.ok('2026-08-14T14:42:44' < '2026-08-14T14:46:08.403+00:00',
    'confirma que a comparacao de texto erraria')

  assert.equal(fechamentoQueContou(venda, [fechamento]), null,
    'a venda veio 3h DEPOIS do fechamento: tem que ser NOVA')
})

test('venda feita ANTES do fechamento continua sendo dada como contada', () => {
  // O outro lado: a trava nao pode parar de funcionar.
  const fechamento = {
    id: 'c1', data_confirmacao: '2026-08-14T14:46:08.403+00:00',
    periodo: { inicio: '2026-07-06', fim: '2026-08-14' },
    produtos_incluidos: ['X'],
  } as never
  // 10:00 BRT = 13:00 UTC, antes das 14:46 UTC.
  const antes = { id: 'a', produto: 'X', data_hora: '2026-08-14T10:00:00', valor_liquido: 100 } as never
  assert.equal(fechamentoQueContou(antes, [fechamento])?.id, 'c1')
})

test('a fronteira de 3 horas, que era onde o erro vivia', () => {
  const fechamento = {
    id: 'c1', data_confirmacao: '2026-08-14T14:00:00+00:00',  // 11:00 BRT
    periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
    produtos_incluidos: ['X'],
  } as never
  const casos: [string, boolean][] = [
    ['2026-08-14T10:59:59', true],   // 13:59:59 UTC - antes: contada
    ['2026-08-14T11:00:00', false],  // 14:00:00 UTC - no instante: nova
    ['2026-08-14T11:00:01', false],  // depois: nova
    ['2026-08-14T13:59:59', false],  // dentro da janela de 3h que o texto errava
  ]
  for (const [dh, deveriaSerContada] of casos) {
    const r = fechamentoQueContou({ id: 'x', produto: 'X', data_hora: dh, valor_liquido: 1 } as never, [fechamento])
    assert.equal(!!r, deveriaSerContada, `${dh} -> esperava ${deveriaSerContada ? 'contada' : 'nova'}`)
  }
})

test('data_hora que JA venha com fuso e respeitada, nao recebe -03:00 em cima', () => {
  const fechamento = {
    id: 'c1', data_confirmacao: '2026-08-14T14:00:00+00:00',
    periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
    produtos_incluidos: ['X'],
  } as never
  // 13:00 UTC escrito com fuso: antes do corte, tem que contar.
  const r = fechamentoQueContou({ id: 'x', produto: 'X', data_hora: '2026-08-14T13:00:00+00:00', valor_liquido: 1 } as never, [fechamento])
  assert.equal(r?.id, 'c1')
})

test('data_hora vazia ou invalida nao quebra nem vira "ja fechada"', () => {
  const fechamento = {
    id: 'c1', data_confirmacao: '2026-08-14T14:00:00+00:00',
    periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
    produtos_incluidos: ['X'],
  } as never
  for (const dh of ['', 'nao-e-data']) {
    assert.equal(fechamentoQueContou({ id: 'x', produto: 'X', data_hora: dh, valor_liquido: 1 } as never, [fechamento]), null, JSON.stringify(dh))
  }
})

// ── Fronteiras da janela, achadas pelo teste de mutacao em 12/09/2026 ───────
//
// O modulo marcava 57%, o mais baixo dos de dinheiro - e e ele que impede
// contar a mesma receita duas vezes. Tres mutantes sobreviviam, todos em
// limites que nenhum teste exercitava.

// Sem `as never` para poder espalhar: espalhar `never` nao compila.
const FECH_JANELA = {
  id: 'cj', data_confirmacao: '2026-09-01T12:00:00+00:00',
  periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
  produtos_incluidos: ['P'],
} as unknown as Closing

const vendaEm = (dia: string) => ({ id: 'v', produto: 'P', data_hora: `${dia}T10:00:00`, valor_liquido: 100 }) as never

test('o PRIMEIRO dia da janela entra; o anterior nao', () => {
  // `d < janela.inicio` virando `<=` fazia o primeiro dia ficar de fora.
  assert.ok(fechamentoQueContou(vendaEm('2026-08-01'), [FECH_JANELA]), '01/08 e o primeiro dia: entra')
  assert.equal(fechamentoQueContou(vendaEm('2026-07-31'), [FECH_JANELA]), null, '31/07 esta fora')
})

test('o ULTIMO dia da janela entra; o seguinte nao', () => {
  assert.ok(fechamentoQueContou(vendaEm('2026-08-31'), [FECH_JANELA]), '31/08 e o ultimo dia: entra')
  assert.equal(fechamentoQueContou(vendaEm('2026-09-01'), [FECH_JANELA]), null, '01/09 esta fora')
})

test('janela com APENAS o inicio ou APENAS o fim e ignorada', () => {
  // `!janela.inicio || !janela.fim` virando `&&` fazia uma janela meio
  // preenchida ser aceita, e a comparacao com `undefined` sempre dar falso -
  // toda venda entraria.
  const soInicio = { ...FECH_JANELA, periodo: { inicio: '2026-08-01', fim: '' } } as unknown as Closing
  const soFim = { ...FECH_JANELA, periodo: { inicio: '', fim: '2026-08-31' } } as unknown as Closing
  assert.equal(fechamentoQueContou(vendaEm('2026-08-15'), [soInicio]), null, 'sem fim, nao conta')
  assert.equal(fechamentoQueContou(vendaEm('2026-08-15'), [soFim]), null, 'sem inicio, nao conta')
})

test('data da venda invalida OU data do fechamento invalida: nao conta', () => {
  // `tVenda === null || Number.isNaN(tFechamento)` virando `&&` exigia as DUAS
  // invalidas para recusar - com uma so, a comparacao seguia com NaN e dava
  // falso, marcando a venda como nova quando deveria ser ignorada.
  const fechSemData = { ...FECH_JANELA, data_confirmacao: 'nao-e-data' } as unknown as Closing
  assert.equal(fechamentoQueContou(vendaEm('2026-08-15'), [fechSemData]), null, 'fechamento com data invalida')
  const vendaSemData = { id: 'v', produto: 'P', data_hora: '', valor_liquido: 100 } as never
  assert.equal(fechamentoQueContou(vendaSemData, [FECH_JANELA]), null, 'venda com data invalida')
})
