import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatoDaVenda, montarPacote, PAGAMENTO_DENISE_POR_SESSAO, quebraIntervalo, novasDatasSeguintes, avisosDasDatas, formatoDoNomeDaOferta } from './diagnostico-guiado'

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

// As vendas REAIS que ja existem no banco, uma por uma, com o nome do
// paciente no titulo do teste. A spec pede exatamente isso: se alguem
// quebrar a regra da oferta, o teste falha dizendo de quem e a venda que
// parou de ser reconhecida, em vez de um "esperava 9, recebeu null".
//
// Os order_id sao os do banco de producao, conferidos em 01/09/2026.
// Reparar que Formato 1 se repete com order_id diferente: a oferta e a mesma
// (WXwmPZfJxGqeXerA6dkO), o que muda e o id da fatura antes do hifen.
const VENDAS_REAIS: { paciente: string; orderId: string; formato: 1 | 2 | 3 }[] = [
  { paciente: 'Rafaela Pires Anchieta Silva', orderId: '06547c74-56d5-4cd6-9046-289d8f3ab9bd-WXwmPZfJxGqeXerA6dkO', formato: 1 },
  { paciente: 'Juliane Eller', orderId: '347281e4-f007-44ac-9264-e41da730b2e4-qVvads7GKaI7lN1Kctrr', formato: 3 },
  { paciente: 'Francisco Geraldo Silveira do Nascimento', orderId: 'a24bf3c3-2733-45f4-aab3-35a6829a8063-WXwmPZfJxGqeXerA6dkO', formato: 1 },
  { paciente: 'Bruno Cavallini de Queiroz', orderId: 'fcdf9256-d34c-4209-8719-ccdf98e20351-WXwmPZfJxGqeXerA6dkO', formato: 1 },
  { paciente: 'Valdir Sabino', orderId: '2dc6e39d-a6e5-49d1-b9c6-9eca6dbc88dd-WXwmPZfJxGqeXerA6dkO', formato: 1 },
  { paciente: 'Gisela Palos', orderId: '0f9a0dfa-cbf5-41ac-b4d0-9268ea5ce5b6-H8DA8U21x7Lmv3NreVMs', formato: 2 },
]

const SESSOES_ESPERADAS: Record<1 | 2 | 3, { totalSessoes: number; sessoesPedro: number }> = {
  1: { totalSessoes: 9, sessoesPedro: 2 },
  2: { totalSessoes: 4, sessoesPedro: 1 },
  3: { totalSessoes: 2, sessoesPedro: 1 },
}

for (const v of VENDAS_REAIS) {
  test(`venda real de ${v.paciente} (Formato ${v.formato})`, () => {
    assert.deepEqual(formatoDaVenda(venda(v.orderId)), { formato: v.formato, ...SESSOES_ESPERADAS[v.formato] })
  })
}

// O Francisco e o Bruno compraram o MESMO formato pagando valores
// diferentes (parcelamento com juros). E o caso que sustenta a decisao de
// identificar pela oferta e nunca pelo preco.
test('Francisco e Bruno caem no mesmo formato apesar de valores diferentes', () => {
  const francisco = formatoDaVenda(venda('a24bf3c3-2733-45f4-aab3-35a6829a8063-WXwmPZfJxGqeXerA6dkO'))
  const bruno = formatoDaVenda(venda('fcdf9256-d34c-4209-8719-ccdf98e20351-WXwmPZfJxGqeXerA6dkO'))
  assert.deepEqual(francisco, bruno)
})

// Gisela e a primeira venda do Formato 2, que ate ela so existia na teoria.
test('venda da Gisela monta 4 sessoes: 1 do Pedro e 3 da Denise', () => {
  const f = formatoDaVenda(venda('0f9a0dfa-cbf5-41ac-b4d0-9268ea5ce5b6-H8DA8U21x7Lmv3NreVMs'))!
  const pacote = montarPacote({ formato: f, primeiraDataISO: '2026-09-08T14:00:00.000Z', pedroId: 'PEDRO', deniseId: 'DENISE' })
  assert.deepEqual(pacote.map(s => s.terapeuta_id), ['PEDRO', 'DENISE', 'DENISE', 'DENISE'])
  assert.deepEqual(pacote.map(s => s.comissao_valor), [0, 95, 95, 95])
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

test('venda da Paula Caroline: excecao POR VENDA, nao pela oferta', () => {
  // O Felipe criou uma oferta dentro do produto de Mentoria e fechou o
  // Diagnostico por ela. A excecao vale para esta venda, e so para ela.
  const f = formatoDaVenda({ id: '27a669a3-dad9-4c8f-ae93-bca82bb13e90', order_id: 'e3eada99-d9b2-4d72-9609-333af129cecf-4pv79AgzdiRoWeLm5gyT' })
  assert.equal(f?.formato, 1)
  assert.equal(f?.totalSessoes, 9)
  assert.equal(f?.sessoesPedro, 2)
})

test('CRITICO: outra venda pela MESMA oferta do Felipe nao vira Diagnostico', () => {
  // Oferta e link reutilizavel. Se o Felipe vender uma Mentoria de verdade
  // pelo mesmo link, o sistema NAO pode montar um pacote de 9 sessoes com a
  // Denise. Foi por isso que a excecao saiu da lista de ofertas.
  const f = formatoDaVenda({ id: 'outra-venda-qualquer', order_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-4pv79AgzdiRoWeLm5gyT' })
  assert.equal(f, null)
})

test('a excecao nao contamina venda com o mesmo id em outra oferta', () => {
  // A excecao e por venda: o id e unico, entao o order_id nem importa.
  const f = formatoDaVenda({ id: '27a669a3-dad9-4c8f-ae93-bca82bb13e90', order_id: undefined })
  assert.equal(f?.formato, 1)
})

test('montarPacote respeita datas escolhidas a mao pelo comercial', () => {
  // Regua de 7 dias e o padrao, nao amarra: viagem e feriado sao rotina.
  const f = { formato: 3 as const, totalSessoes: 2, sessoesPedro: 1 }
  const p = montarPacote({
    formato: f, primeiraDataISO: '2026-09-02T14:20:00.000Z', pedroId: 'ped', deniseId: 'den',
    datasISO: ['2026-09-02T14:20:00.000Z', '2026-09-20T18:00:00.000Z'],
  })
  assert.equal(p[0].data_agendada, '2026-09-02T14:20:00.000Z')
  assert.equal(p[1].data_agendada, '2026-09-20T18:00:00.000Z')
})

test('quem atende cada sessao NAO muda por causa das datas manuais', () => {
  const f = { formato: 1 as const, totalSessoes: 9, sessoesPedro: 2 }
  const datas = Array.from({ length: 9 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`)
  const p = montarPacote({ formato: f, primeiraDataISO: datas[0], pedroId: 'ped', deniseId: 'den', datasISO: datas })
  assert.deepEqual(p.slice(0, 2).map(x => x.terapeuta_id), ['ped', 'ped'])
  assert.equal(p.slice(2).every(x => x.terapeuta_id === 'den'), true)
  assert.equal(p.slice(0, 2).every(x => x.comissao_valor === 0), true)
  assert.equal(p.slice(2).every(x => x.comissao_valor === 95), true)
})

test('lista de datas incompleta e IGNORADA: cai na regua em vez de gravar data invalida', () => {
  const f = { formato: 3 as const, totalSessoes: 2, sessoesPedro: 1 }
  const p = montarPacote({
    formato: f, primeiraDataISO: '2026-09-02T14:20:00.000Z', pedroId: 'ped', deniseId: 'den',
    datasISO: ['2026-09-02T14:20:00.000Z'],
  })
  assert.equal(p.length, 2)
  assert.equal(p[1].data_agendada, '2026-09-09T14:20:00.000Z')
})

test('sem datasISO o pacote sai na regua de 7 dias, como sempre', () => {
  const f = { formato: 3 as const, totalSessoes: 2, sessoesPedro: 1 }
  const p = montarPacote({ formato: f, primeiraDataISO: '2026-09-02T14:20:00.000Z', pedroId: 'ped', deniseId: 'den' })
  assert.equal(p[1].data_agendada, '2026-09-09T14:20:00.000Z')
})

// --- avisosDasDatas: roda a cada render do modal e NAO pode lancar em nenhuma
// entrada. Os testes usam o formato cru do campo datetime-local, que e o que a
// tela realmente entrega.

test('CRITICO: campo limpo pelo comercial NAO lanca, sai como invalida', () => {
  // new Date('').toISOString() lanca RangeError. Como isto roda a cada render,
  // a excecao derrubava a pagina inteira e apagava os ajustes ja feitos nas
  // outras sessoes. O teste antigo passava 'lixo' direto pra funcao e nao
  // pegava o caso, porque quem convertia era a tela, ANTES de chamar.
  const a = avisosDasDatas(['2026-09-02T14:20', '', '2026-09-16T14:20'])
  assert.deepEqual(a.invalidas, [2])
})

test('undefined e null tambem saem como invalidas, sem lancar', () => {
  const a = avisosDasDatas(['2026-09-02T14:20', undefined, null])
  assert.deepEqual(a.invalidas, [2, 3])
})

test('string sem sentido sai como invalida', () => {
  assert.deepEqual(avisosDasDatas(['2026-09-02T14:20', 'lixo']).invalidas, [2])
})

test('CRITICO: duas sessoes do pacote no mesmo horario sao apontadas', () => {
  // A trava de conflito da rota compara as datas pedidas contra o BANCO e
  // ignora as sessoes desta venda, entao duas datas iguais do pacote novo
  // passariam batido: dois convites pro paciente na mesma hora.
  const a = avisosDasDatas(['2026-09-02T14:20', '2026-09-20T15:00', '2026-09-20T15:00'])
  assert.deepEqual(a.duplicadas, [3])
})

test('tres no mesmo horario apontam as duas repetidas', () => {
  const a = avisosDasDatas(['2026-09-02T14:20', '2026-09-02T14:20', '2026-09-02T14:20'])
  assert.deepEqual(a.duplicadas, [2, 3])
})

test('data fora de ordem e apontada como fora de ordem, nao como fora da regua', () => {
  // Sessao 3 antes da 2: quase sempre erro de digitacao, e o aviso generico de
  // "fora dos 7 dias" fazia o comercial ler como ajuste normal e confirmar.
  const a = avisosDasDatas(['2026-09-02T14:20', '2026-09-30T14:20', '2026-09-20T14:20'])
  assert.deepEqual(a.foraDeOrdem, [3])
  assert.equal(a.foraDaRegua.includes(3), false)
})

test('MENOR: mudar so o horario nao dispara o aviso de intervalo', () => {
  // "essa fica 15h em vez de 14h" e o ajuste mais comum. Comparacao exata em
  // milissegundos fazia 7d+1h virar aviso, virando ruido.
  const a = avisosDasDatas(['2026-09-02T14:20', '2026-09-09T15:20', '2026-09-16T14:20'])
  assert.deepEqual(a.foraDaRegua, [])
})

test('pacote inteiro na regua nao gera aviso nenhum', () => {
  const a = avisosDasDatas(['2026-09-02T14:20', '2026-09-09T14:20', '2026-09-16T14:20'])
  assert.deepEqual(a, { foraDaRegua: [], foraDeOrdem: [], invalidas: [], duplicadas: [] })
})

test('intervalo de dias diferente de 7 e apontado', () => {
  const a = avisosDasDatas(['2026-09-02T14:20', '2026-09-04T14:20', '2026-09-11T14:20', '2026-09-30T14:20'])
  assert.deepEqual(a.foraDaRegua, [2, 4])
})

test('data invalida no meio nao impede o aviso das demais', () => {
  const a = avisosDasDatas(['2026-09-02T14:20', '', '2026-09-30T14:20'])
  assert.deepEqual(a.invalidas, [2])
  assert.deepEqual(a.foraDaRegua, [])
})

test('lista vazia e lista de um item nao quebram', () => {
  assert.deepEqual(avisosDasDatas([]), { foraDaRegua: [], foraDeOrdem: [], invalidas: [], duplicadas: [] })
  assert.deepEqual(avisosDasDatas(['2026-09-02T14:20']).foraDaRegua, [])
})

test('CRITICO: sessoes que se SOBREPOEM sao apontadas, nao so as identicas', () => {
  // A Denise atende 60 minutos e nao tem grade de horarios: 14:00 e 14:30 no
  // mesmo dia ja empilha duas consultas na agenda dela. A trava de conflito da
  // rota ignora as sessoes da propria venda, entao ninguem mais pega isso.
  const a = avisosDasDatas(['2026-09-02T14:20', '2026-11-10T14:00', '2026-11-10T14:30'])
  assert.deepEqual(a.duplicadas, [3])
})

test('exatamente 60 minutos de diferenca NAO e sobreposicao', () => {
  const a = avisosDasDatas(['2026-09-02T14:00', '2026-11-10T14:00', '2026-11-10T15:00'])
  assert.deepEqual(a.duplicadas, [])
})

test('59 minutos e sobreposicao', () => {
  const a = avisosDasDatas(['2026-09-02T14:00', '2026-11-10T14:00', '2026-11-10T14:59'])
  assert.deepEqual(a.duplicadas, [3])
})

test('a sobreposicao aponta a sessao POSTERIOR na lista, nao a primeira', () => {
  // A primeira e a referencia; quem precisa mudar e a que veio depois.
  const a = avisosDasDatas(['2026-09-02T10:00', '2026-09-02T10:30', '2026-09-02T10:40'])
  assert.deepEqual(a.duplicadas, [2, 3])
})

test('sobreposicao continua valendo com as datas fora de ordem', () => {
  const a = avisosDasDatas(['2026-09-02T14:00', '2026-09-20T14:30', '2026-09-20T14:00'])
  assert.deepEqual(a.duplicadas, [3])
  assert.deepEqual(a.foraDeOrdem, [3])
})

// ── O formato pelo NOME da oferta (Kiwify) ──────────────────────────────────
test('CASO REAL: Ibraim, primeira venda de Diagnostico pela Kiwify', () => {
  // O order_id da Kiwify e so o numero do pedido - a oferta nunca vai grudada
  // nele como na Hubla. A tela mostrava "Oferta nao mapeada" e mostraria em
  // toda venda da Kiwify daqui pra frente.
  const f = formatoDaVenda({
    id: 'ibraim', order_id: '3783277c-b14c-4d5b-bf97-7c424d304a88', oferta_nome: 'FORMATO 2',
    produto: 'Diagnóstico Guiado: Programa de acompanhamento Individual',
  } as never)
  assert.equal(f?.formato, 2)
  assert.equal(f?.totalSessoes, 4)
  assert.equal(f?.sessoesPedro, 1)
})

test('o ID da oferta continua ganhando do nome', () => {
  // Na Hubla o ID e estavel e nao depende de ninguem escrever o nome direito.
  // Se o nome contradisser o ID, vale o ID.
  const f = formatoDaVenda({
    id: 'x', order_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-WXwmPZfJxGqeXerA6dkO',
    oferta_nome: 'FORMATO 3',
  } as never)
  assert.equal(f?.formato, 1, 'o ID diz formato 1, o nome diz 3: vale o ID')
})

test('a excecao por venda continua ganhando de tudo', () => {
  const f = formatoDaVenda({
    id: '27a669a3-dad9-4c8f-ae93-bca82bb13e90', order_id: null, oferta_nome: 'FORMATO 3',
  } as never)
  assert.equal(f?.formato, 1, 'a Paula e excecao mapeada como formato 1')
})

test('a leitura do nome e estrita: numero solto nao vira formato', () => {
  for (const nome of [
    'Pacote de 2 sessoes', 'Oferta 3', 'Promocao 1', 'FORMATO', 'FORMATO 4',
    'FORMATO 12', 'formato zero', '', null, undefined,
  ]) {
    assert.equal(formatoDoNomeDaOferta(nome as never), null, `"${nome}" nao pode virar formato`)
  }
})

test('o nome e lido com folga de escrita', () => {
  assert.equal(formatoDoNomeDaOferta('FORMATO 2'), 2)
  assert.equal(formatoDoNomeDaOferta('formato 2'), 2)
  assert.equal(formatoDoNomeDaOferta('Formato   3'), 3)
  assert.equal(formatoDoNomeDaOferta('FORMATO2'), 2)
  assert.equal(formatoDoNomeDaOferta('Diagnóstico Guiado - Formato 1'), 1)
  assert.equal(formatoDoNomeDaOferta('FORMATO 02'), 2)
})

// ── A trava do PRODUTO no caminho do nome ───────────────────────────────────
// Defeito real de 09-10/09/2026, causado pela correcao da Kiwify: o produto
// "Mentoria Particular - Pedro | Denise" usa "Formato N" no nome da oferta com
// OUTRO significado, e a leitura pelo nome passou a chamar Mentoria de
// Diagnostico. As sete vendas abaixo sao as sete que leram errado em producao.
test('CASO REAL: Amanda, Mentoria da Denise que virou Diagnostico', () => {
  // O que o usuario reportou: "venda da Denise de 4 sessoes o sistema entendeu
  // como diagnostico guiado". A coincidencia das 4 sessoes escondia o erro -
  // a CONTA batia, a DIVISAO nao: viraria 1 do Pedro + 3 da Denise a R$ 95,
  // em vez de 4 da Denise pelo percentual dela.
  const f = formatoDaVenda({
    id: '4c4bcbba-b55d-4bbc-8d6d-d4e3e162261b',
    order_id: '636e4280-a87a-42bf-b17b-6c9a1ffdf6f0-vtRojHzIAzzJRq5PGWhO',
    oferta_nome: 'Formato 2 - 4 Sessões',
    produto: 'Mentoria Particular - Pedro | Denise',
  } as never)
  assert.equal(f, null, 'Mentoria com "Formato 2" no nome da oferta nao e Diagnostico')
})

test('CASO REAL: as ofertas do produto conjunto que colidiam', () => {
  // "Formato 2 - 2 Sessoes" sao DUAS sessoes: ali o N e o codigo do pacote e a
  // quantidade vem escrita ao lado. Lido como Diagnostico Formato 2 viraria 4.
  // "Formato 1 - Sessao Unica" e UMA: viraria NOVE, com 7 da Denise.
  const colisoes = [
    ['Formato 2 - 4 Sessões', 'Jaqueline / Sara / Marcio / Amanda'],
    ['Formato 2 - 2 Sessões', 'Daniel / Greice - viraria 4 sessoes'],
    ['Formato 1 - Sessão Única', 'Osni - viraria 9 sessoes'],
  ]
  for (const [oferta, quem] of colisoes) {
    const f = formatoDaVenda({
      id: 'x', order_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-ofertaNaoMapeada',
      oferta_nome: oferta, produto: 'Mentoria Particular - Pedro | Denise',
    } as never)
    assert.equal(f, null, `${quem}: "${oferta}" nao pode virar Diagnostico`)
  }
})

test('sem o produto na consulta, o caminho do nome nao vale', () => {
  // Registrado de proposito: e o custo da trava. Quem chamar formatoDaVenda
  // sem trazer `produto` perde o reconhecimento das vendas da Kiwify, que e o
  // motivo do caminho do nome existir. O teste de fiacao abaixo cobre isso nos
  // selects; aqui fica a regra explicita.
  const f = formatoDaVenda({ id: 'z', order_id: 'so-o-numero-do-pedido', oferta_nome: 'FORMATO 2' } as never)
  assert.equal(f, null)
})

test('o caminho do ID nao depende do produto', () => {
  // A trava e SO do nome. Venda da Hubla com oferta mapeada segue reconhecida
  // mesmo que o produto esteja escrito de outro jeito - foi o caso da Paula,
  // fechada dentro do produto da Mentoria.
  const f = formatoDaVenda({
    id: 'x', order_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-H8DA8U21x7Lmv3NreVMs',
    oferta_nome: null, produto: 'Mentoria Particular - Pedro Roncada',
  } as never)
  assert.equal(f?.formato, 2)
})

test('venda sem oferta nenhuma continua sem formato', () => {
  assert.equal(formatoDaVenda({ id: 'y', order_id: null, oferta_nome: null } as never), null)
})

test('todo select que alimenta formatoDaVenda traz oferta_nome', () => {
  // O order_id da Kiwify nunca tem a oferta. Um select que esqueca
  // `oferta_nome` faz o formato sumir de novo NAQUELA tela so - sem erro de
  // compilacao, sem erro em tela, so a etiqueta desaparecendo. Foi assim que o
  // Ibraim apareceu como "Oferta nao mapeada".
  const arquivos = [
    'app/terapeutas/agenda/page.tsx',
    'app/terapeutas/[id]/page.tsx',
    'app/api/terapeutas/sessoes/agendar/route.ts',
    'app/api/terapeutas/sessoes/remarcar/route.ts',
    'app/api/terapeutas/sessoes/empurrar-seguintes/route.ts',
    'app/api/terapeutas/dashboard/route.ts',
    'lib/whatsapp-pendentes.ts',
  ]
  for (const arq of arquivos) {
    const texto = readFileSync(new URL('../' + arq, import.meta.url), 'utf8')
    for (const linha of texto.split('\n')) {
      if (!linha.includes('order_id') || !linha.includes('select(')) continue
      assert.ok(linha.includes('oferta_nome'), `${arq}: select traz order_id mas nao oferta_nome -> ${linha.trim().slice(0, 100)}`)
      // Desde 10/09/2026 o caminho do nome exige o produto: sem ele a venda de
      // Diagnostico da Kiwify volta a cair no aviso de oferta desconhecida.
      assert.ok(linha.includes('produto'), `${arq}: select traz oferta_nome mas nao produto -> ${linha.trim().slice(0, 100)}`)
    }
  }
})
