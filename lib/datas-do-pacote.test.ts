import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarDatasDoPacote, mensagemDoProblema, type ProblemaDatas } from './datas-do-pacote'

const ok = (datasISO: string[], ehDiagnostico = true) => validarDatasDoPacote({ datasISO, ehDiagnostico })
const iso = (d: string) => new Date(d).toISOString()

test('pacote na regua passa sem problema nenhum', () => {
  assert.equal(ok([iso('2026-09-02T14:20Z'), iso('2026-09-09T14:20Z'), iso('2026-09-16T14:20Z')]), null)
})

test('pacote fora da regua passa: intervalo livre foi decisao do usuario', () => {
  assert.equal(ok([iso('2026-09-02T14:20Z'), iso('2026-09-30T14:20Z'), iso('2026-10-02T14:20Z')]), null)
})

test('CAMPO EM BRANCO: 01/01/2000 e recusado', () => {
  // brasiliaLocalToISO('') NAO lanca - o parser legado do V8 aceita ':00-03:00'
  // e devolve ano 2000. A sessao ia pro banco 26 anos no passado e o paciente
  // recebia convite retroativo.
  const p = ok([iso('2026-09-02T14:20Z'), '2000-01-01T05:00:00.000Z'])
  assert.equal(p?.tipo, 'ano_invalido')
  assert.deepEqual(p?.sessoes, [2])
  assert.equal(mensagemDoProblema(p!).status, 400)
})

test('ANO DE 2 DIGITOS: digitar 26 em vez de 2026 e recusado', () => {
  const p = ok([iso('2026-09-02T14:20Z'), '0026-09-09T14:20:00.000Z'])
  assert.equal(p?.tipo, 'ano_invalido')
})

test('ano 2100 passa e 2101 nao', () => {
  assert.equal(ok(['2100-01-01T12:00:00.000Z'], false), null)
  assert.equal(ok(['2101-01-01T12:00:00.000Z'], false)?.tipo, 'ano_invalido')
})

test('SOBREPOSICAO: 14:00 e 14:30 no mesmo dia sao recusadas', () => {
  // A Denise atende 60 minutos e nao tem grade. A trava de conflito da agenda
  // ignora as sessoes da propria venda, entao so esta pega.
  const p = ok([iso('2026-09-02T14:00Z'), iso('2026-11-10T14:00Z'), iso('2026-11-10T14:30Z')])
  assert.equal(p?.tipo, 'sobrepostas')
  assert.deepEqual(p?.sessoes, [3])
  assert.equal(mensagemDoProblema(p!).status, 409)
})

test('exatamente 60 minutos passa', () => {
  assert.equal(ok([iso('2026-11-10T14:00Z'), iso('2026-11-10T15:00Z')]), null)
})

test('FORA DE ORDEM no Diagnostico e recusado: quebra "o Pedro comeca"', () => {
  // montarPacote divide os terapeutas por INDICE. Com as datas invertidas, a
  // sessao 1 (Pedro) acontece DEPOIS da 2 (Denise), e nenhuma tela mostra isso.
  const p = ok([iso('2026-09-10T17:00Z'), iso('2026-09-08T17:00Z')])
  assert.equal(p?.tipo, 'fora_de_ordem')
  assert.deepEqual(p?.sessoes, [2])
})

test('fora de ordem em produto ANTIGO passa: la as datas sempre foram livres', () => {
  assert.equal(ok([iso('2026-09-10T17:00Z'), iso('2026-09-08T17:00Z')], false), null)
})

test('LONGE DEMAIS: 2062 em vez de 2026 e recusado', () => {
  // Passa pela faixa 2020-2100 e abre a janela da trava de conflito para
  // decadas, fazendo-a puxar a agenda inteira do terapeuta.
  const p = ok([iso('2026-09-02T14:20Z'), iso('2026-09-09T14:20Z'), iso('2062-09-16T14:20Z')])
  assert.equal(p?.tipo, 'longe_demais')
  assert.deepEqual(p?.sessoes, [3])
})

test('um Formato 1 espalhado por 8 meses continua valido', () => {
  // Regua folgada nao pode ser confundida com erro de digitacao.
  const datas = Array.from({ length: 9 }, (_, i) => iso(`2026-0${(i % 9) + 1}-10T14:00Z`))
  assert.equal(ok(datas), null)
})

test('distancia e medida a partir da PRIMEIRA sessao, nao da anterior', () => {
  assert.equal(ok([iso('2026-01-10T14:00Z'), iso('2026-12-10T14:00Z')]), null)
  assert.equal(ok([iso('2026-01-10T14:00Z'), iso('2027-06-10T14:00Z')])?.tipo, 'longe_demais')
})

test('produto antigo NAO ganha a trava de distancia', () => {
  assert.equal(ok([iso('2026-01-10T14:00Z'), iso('2029-06-10T14:00Z')], false), null)
})

test('a ordem das checagens: ano invalido vem antes de tudo', () => {
  // Campo em branco junto com sobreposicao: o erro reportado tem que ser o do
  // campo em branco, que e o que a pessoa precisa corrigir primeiro.
  const p = ok(['2000-01-01T05:00:00.000Z', iso('2026-11-10T14:00Z'), iso('2026-11-10T14:10Z')])
  assert.equal(p?.tipo, 'ano_invalido')
})

test('lista vazia e de um item nao quebram', () => {
  assert.equal(ok([]), null)
  assert.equal(ok([iso('2026-09-02T14:20Z')]), null)
})

test('toda mensagem cita as sessoes e nao usa jargao de banco', () => {
  const casos: ProblemaDatas[] = [
    { tipo: 'ano_invalido', sessoes: [2] },
    { tipo: 'sobrepostas', sessoes: [3, 4] },
    { tipo: 'fora_de_ordem', sessoes: [2] },
    { tipo: 'longe_demais', sessoes: [9] },
  ]
  for (const p of casos) {
    const m = mensagemDoProblema(p)
    assert.ok(m.texto.includes(String(p.sessoes[0])), `${p.tipo} nao cita a sessao`)
    assert.equal(/23505|23503|constraint|null/i.test(m.texto), false, `${p.tipo} vaza jargao`)
  }
})
