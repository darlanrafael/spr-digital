import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datasDoLancamento, montarSessoesDoLancamento, fimDaSessaoISO } from './criar-lancamento-manual'

const base = { terapeuta_id: 't1' }
const hh = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')

test('sem data de referencia, nenhuma sessao e calculada', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 4 })
  assert.deepEqual(r.entregues, [])
  assert.deepEqual(r.futuras, [])
  assert.equal(r.totalSessoes, 4)
})

test('as futuras saem de 7 em 7 dias a partir da proxima', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 3, sessoes_entregues: 0, proxima_sessao_data: '2026-10-01T10:30' })
  assert.equal(r.futuras.length, 3)
  assert.equal(hh(r.futuras[0]), '2026-10-01 10:30')
  assert.equal(hh(r.futuras[1]), '2026-10-08 10:30')
  assert.equal(hh(r.futuras[2]), '2026-10-15 10:30')
})

test('as entregues saem de 7 em 7 dias PARA TRAS', () => {
  // Data no passado de proposito: com proxima no futuro, a guarda do caso
  // Buzetti recusa - e e o teste seguinte que cobre isso.
  const r = datasDoLancamento({ ...base, total_sessoes: 3, sessoes_entregues: 2, proxima_sessao_data: '2026-02-05T10:30' })
  assert.equal(r.entregues.length, 2)
  assert.equal(hh(r.entregues[0]), '2026-01-22 10:30')
  assert.equal(hh(r.entregues[1]), '2026-01-29 10:30')
  assert.equal(r.futuras.length, 1)
  assert.equal(hh(r.futuras[0]), '2026-02-05 10:30')
})

test('CASO REAL DO BUZETTI: entregue que cairia no futuro e recusada', () => {
  // Lancado em 04/09 com proxima em 17/09 e 1 entregue: a conta deu 10/09,
  // seis dias no futuro. A sessao nascia "entregue", ocupava horario na agenda
  // e contava nas metricas antes de acontecer.
  const daquiUmMes = new Date(Date.now() + 30 * 24 * 3600 * 1000)
  const iso = new Date(daquiUmMes.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16)
  const r = datasDoLancamento({ ...base, total_sessoes: 2, sessoes_entregues: 1, proxima_sessao_data: iso })
  assert.ok(r.erro, 'tinha que recusar')
  assert.match(r.erro!, /sairiam com data no futuro/)
  assert.deepEqual(r.entregues, [])
})

test('entregue no passado passa normalmente', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 2, sessoes_entregues: 1, proxima_sessao_data: '2026-01-15T10:30' })
  assert.equal(r.erro, undefined)
  assert.equal(r.entregues.length, 1)
})

test('datas futuras informadas a mao vencem a regua de 7 dias', () => {
  const r = datasDoLancamento({
    ...base, total_sessoes: 2, sessoes_entregues: 0,
    proxima_sessao_data: '2026-10-01T10:30',
    datas_futuras: ['2026-10-01T10:30', '2026-10-20T14:00'],
  })
  assert.equal(hh(r.futuras[1]), '2026-10-20 14:00')
})

test('lista de datas com tamanho errado e ignorada, e volta a regua', () => {
  const r = datasDoLancamento({
    ...base, total_sessoes: 3, sessoes_entregues: 0,
    proxima_sessao_data: '2026-10-01T10:30',
    datas_futuras: ['2026-10-01T10:30'],
  })
  assert.equal(r.futuras.length, 3)
  assert.equal(hh(r.futuras[1]), '2026-10-08 10:30')
})

test('entregues nao pode passar do total', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 2, sessoes_entregues: 9, proxima_sessao_data: '2026-01-15T10:30' })
  assert.equal(r.entregues.length, 2)
  assert.equal(r.futuras.length, 0)
})

// ── A montagem das sessoes, que nenhum teste alcancava ──────────────────────
//
// O teste de mutacao de 15/09/2026 mediu: este modulo pegava 34% dos defeitos.
// A parte de datas era testada; a que MONTA as sessoes nao, porque estava
// dentro da funcao que precisa de banco. Entre os defeitos que passavam:
// numeracao errada e duracao do evento no Google.

const PARAMS = {
  saleId: 'manual_1',
  terapeutaId: 'ter-1',
  entregues: [] as string[],
  futuras: [] as string[],
  totalSessoes: 4,
  comissaoPorSessao: 95,
  pacienteNome: 'Fulano de Tal',
  pacienteEmail: 'fulano@x.com',
  usuarioNome: 'Felipe Vieira',
}

test('a numeracao comeca em 1 e as futuras CONTINUAM a contagem', () => {
  // O mutante que sobrevivia trocava `i + 1` por `i - 1` e
  // `entregues.length + i + 1` por variacoes. O pacote saia com numero
  // repetido ou com buraco, e nada reclamava na hora - so muito depois alguem
  // repara que tem duas sessoes "1".
  const s = montarSessoesDoLancamento({
    ...PARAMS,
    entregues: ['2026-09-01T10:00:00Z', '2026-09-08T10:00:00Z'],
    futuras: ['2026-09-15T10:00:00Z', '2026-09-22T10:00:00Z'],
  })
  assert.deepEqual(s.map(x => x.numero_sessao), [1, 2, 3, 4], 'numeracao tem que ser 1,2,3,4 sem repetir nem pular')
  assert.equal(new Set(s.map(x => x.numero_sessao)).size, 4, 'nenhum numero repetido')
})

test('so entregues, ou so futuras, numeram certo do mesmo jeito', () => {
  const soEntregues = montarSessoesDoLancamento({ ...PARAMS, entregues: ['a', 'b', 'c'], totalSessoes: 3 })
  assert.deepEqual(soEntregues.map(x => x.numero_sessao), [1, 2, 3])
  const soFuturas = montarSessoesDoLancamento({ ...PARAMS, futuras: ['a', 'b', 'c'], totalSessoes: 3 })
  assert.deepEqual(soFuturas.map(x => x.numero_sessao), [1, 2, 3], 'sem entregues, as futuras comecam em 1')
})

test('entregue e agendada saem com os campos coerentes entre si', () => {
  const [entregue, futura] = montarSessoesDoLancamento({
    ...PARAMS, entregues: ['2026-09-01T10:00:00Z'], futuras: ['2026-09-08T10:00:00Z'], totalSessoes: 2,
  })
  assert.equal(entregue.status, 'entregue')
  assert.equal(entregue.status_consulta, 'concluida')
  assert.equal(entregue.data_entrega, '2026-09-01T10:00:00Z', 'entregue tem data de entrega')
  assert.equal(entregue.entregue_confirmado_por, 'Felipe Vieira', 'quem confirmou fica registrado')

  assert.equal(futura.status, 'agendada')
  assert.equal(futura.status_consulta, 'aguardando')
  assert.equal(futura.data_entrega, null, 'futura NAO pode ter data de entrega')
  assert.equal(futura.entregue_confirmado_por, null, 'futura nao tem quem confirmou')
})

test('nenhuma sessao nasce com comissao ja paga', () => {
  // Nascer paga significa a terapeuta nunca receber por ela: some da fila de
  // pagamento sem nunca ter entrado.
  const s = montarSessoesDoLancamento({ ...PARAMS, entregues: ['a'], futuras: ['b', 'c'], totalSessoes: 3 })
  for (const x of s) assert.equal(x.comissao_paga, false, `sessao ${x.numero_sessao} nasceu paga`)
})

test('o total_sessoes do pacote vai em TODAS as linhas', () => {
  // A tela mostra "2 de 4". Se o total variar entre as linhas, o paciente ve
  // numeros diferentes em sessoes do mesmo pacote.
  const s = montarSessoesDoLancamento({ ...PARAMS, entregues: ['a'], futuras: ['b'], totalSessoes: 8 })
  for (const x of s) assert.equal(x.total_sessoes, 8)
})

test('lista vazia nao gera sessao nenhuma', () => {
  assert.deepEqual(montarSessoesDoLancamento(PARAMS), [])
})

test('a sessao dura UMA hora no Google, nem mais nem menos', () => {
  // O mutante trocava o `+` da soma por `-`, e o evento nascia terminando uma
  // hora ANTES de comecar. O Google aceita e o convite fica sem sentido.
  assert.equal(fimDaSessaoISO('2026-09-15T14:00:00.000Z'), '2026-09-15T15:00:00.000Z')
  assert.equal(fimDaSessaoISO('2026-09-15T23:30:00.000Z'), '2026-09-16T00:30:00.000Z', 'atravessa a meia-noite')
  const inicio = new Date('2026-09-15T14:00:00Z').getTime()
  const fim = new Date(fimDaSessaoISO('2026-09-15T14:00:00Z')).getTime()
  assert.equal(fim - inicio, 60 * 60 * 1000, 'exatamente 3.600.000 ms')
  assert.ok(fim > inicio, 'o fim nunca pode ser antes do inicio')
})
