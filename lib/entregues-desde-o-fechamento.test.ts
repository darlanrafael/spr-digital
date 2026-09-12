import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { entreguesDesdeOFechamento } from './entregues-desde-o-fechamento'

// O caso REAL da Denise em 11/09/2026, com os valores crus do banco.
const FECH_JULHO = { id: 'e9200da4', data_confirmacao: '2026-07-09T21:59:06Z', sessoes: [{ id: 'jaq-2-8' }, { id: 'samile-2-4' }] }
const FECH_AGOSTO = { id: '65d0e7fd', data_confirmacao: '2026-08-14T18:00:18Z', sessoes: [{ id: 'greice-2-2' }, { id: 'billi-4-4' }] }

const SESSOES = [
  { id: 'antiga', comissao_valor: 90.42, comissao_paga: true, data_entrega: '2026-07-14T22:30:00Z' },
  { id: 'jaq-2-8', comissao_valor: 83.22, comissao_paga: true, data_entrega: '2026-08-14T22:06:00Z' },
  { id: 'greice-2-2', comissao_valor: 99.4738815, comissao_paga: true, data_entrega: '2026-08-14T23:09:00Z' },
  { id: 'billi-4-4', comissao_valor: 86.778523125, comissao_paga: true, data_entrega: '2026-08-17T21:38:00Z' },
  { id: 'marcio-1-4', comissao_valor: 88.216498125, comissao_paga: false, data_entrega: '2026-08-26T22:30:00Z' },
  { id: 'osni', comissao_valor: 141.857541, comissao_paga: false, data_entrega: '2026-09-03T22:17:00Z' },
  { id: 'juliane', comissao_valor: 95, comissao_paga: false, data_entrega: '2026-09-09T15:01:00Z' },
  { id: 'samile-2-4', comissao_valor: 86.778523125, comissao_paga: true, data_entrega: '2026-09-11T21:43:00Z' },
]

test('CASO REAL: a sessao de julho fica FORA, o resto entra', () => {
  const r = entreguesDesdeOFechamento({ sessoes: SESSOES, fechamentos: [FECH_JULHO, FECH_AGOSTO] })
  assert.equal(r.corte, '2026-08-14T18:00:18Z', 'o corte e o fechamento MAIS RECENTE')
  assert.equal(r.sessoes.length, 7)
  assert.ok(!r.sessoes.some(s => s.sessao.id === 'antiga'), 'a de julho nao pode entrar')
})

test('CASO REAL: a sessao paga DEPOIS da data do fechamento aparece com etiqueta', () => {
  // A do Billimaicon foi entregue em 17/08 e paga pelo fechamento datado de
  // 14/08. E "antes da entrega", mas nao e antecipacao no sentido da tela - e
  // por isso que a etiqueta diz o FECHAMENTO e nao "antecipado".
  const r = entreguesDesdeOFechamento({ sessoes: SESSOES, fechamentos: [FECH_JULHO, FECH_AGOSTO] })
  const billi = r.sessoes.find(s => s.sessao.id === 'billi-4-4')!
  assert.equal(billi.pagoEm, '2026-08-14T18:00:18Z')
  assert.equal(billi.fechamentoId, '65d0e7fd')
})

test('CASO REAL: a entregue hoje e paga la em JULHO aponta para julho', () => {
  // A Samile foi antecipada no pagamento de 09/07 e entregue em 11/09. A
  // etiqueta tem que dizer julho, senao o usuario procura no fechamento errado.
  const r = entreguesDesdeOFechamento({ sessoes: SESSOES, fechamentos: [FECH_JULHO, FECH_AGOSTO] })
  const samile = r.sessoes.find(s => s.sessao.id === 'samile-2-4')!
  assert.equal(samile.fechamentoId, 'e9200da4', 'e do fechamento de julho, nao do de agosto')
})

test('sessao pendente nao ganha etiqueta nenhuma', () => {
  const r = entreguesDesdeOFechamento({ sessoes: SESSOES, fechamentos: [FECH_JULHO, FECH_AGOSTO] })
  for (const id of ['marcio-1-4', 'osni', 'juliane']) {
    const s = r.sessoes.find(x => x.sessao.id === id)!
    assert.equal(s.pagoEm, null, id)
    assert.equal(s.fechamentoId, null, id)
  }
})

test('CASO REAL: os totais batem com a tela', () => {
  const r = entreguesDesdeOFechamento({ sessoes: SESSOES, fechamentos: [FECH_JULHO, FECH_AGOSTO] })
  assert.equal(r.aPagar, 325.07, '3 pendentes deste fixture')
  assert.equal(r.jaPago, 356.25, 'as 4 ja pagas somam o valor real da producao')
  assert.equal(r.total, 681.32)
  assert.equal(Math.round((r.aPagar + r.jaPago) * 100) / 100, r.total, 'o total nao pode divergir das partes')
})

test('`comissao_paga` manda, nao a presenca no snapshot', () => {
  // Pagamento feito por fora pode nao ter snapshot. A sessao segue paga, so sem
  // etiqueta de qual fechamento - e melhor que mostra-la como pendente.
  const r = entreguesDesdeOFechamento({
    sessoes: [{ id: 'sem-snapshot', comissao_valor: 100, comissao_paga: true, data_entrega: '2026-09-01T00:00:00Z' }],
    fechamentos: [{ id: 'f', data_confirmacao: '2026-08-01T00:00:00Z', sessoes: [] }],
  })
  assert.equal(r.jaPago, 100)
  assert.equal(r.aPagar, 0)
  assert.equal(r.sessoes[0].pagoEm, null, 'sem snapshot nao ha data para mostrar')
})

test('sem fechamento anterior, entram TODAS as entregues', () => {
  const r = entreguesDesdeOFechamento({ sessoes: SESSOES, fechamentos: [] })
  assert.equal(r.corte, null)
  assert.equal(r.sessoes.length, 8, 'inclusive a de julho')
})

test('sessao sem data de entrega nao entra', () => {
  const r = entreguesDesdeOFechamento({
    sessoes: [{ id: 'x', comissao_valor: 10, comissao_paga: false, data_entrega: null }],
    fechamentos: [],
  })
  assert.equal(r.sessoes.length, 0)
  assert.equal(r.total, 0)
})

test('sai em ordem de entrega, da mais antiga para a mais nova', () => {
  const r = entreguesDesdeOFechamento({ sessoes: SESSOES, fechamentos: [FECH_AGOSTO] })
  const datas = r.sessoes.map(s => s.sessao.data_entrega)
  assert.deepEqual(datas, [...datas].sort(), 'a ordem cronologica e a que o usuario confere com a agenda')
})

test('a tela mostra o bloco e a etiqueta', () => {
  // Teste de fiacao: o calculo pode estar certo e a tela nao mostrar - que e
  // exatamente o estado de antes, em que as pagas sumiam.
  const tela = readFileSync(new URL('../app/terapeutas/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('entreguesDesdeOFechamento') || tela.includes('desdeUltimo'), 'a tela nao usa o bloco')
  const rota = readFileSync(new URL('../app/api/terapeutas/fechamentos/route.ts', import.meta.url), 'utf8')
  assert.ok(rota.includes('entreguesDesdeOFechamento'), 'a rota nao calcula as entregues desde o fechamento')
})

test('o bloco novo PAGINA, senao terapeuta sem fechamento derruba a tela', () => {
  // Achado na revisao de 11/09/2026: sem fechamento anterior nao ha corte,
  // entao entram TODAS as entregues. O Pedro tem 357 e sairiam 357 linhas numa
  // tela so. A Denise tem 14 porque tem fechamento - o caso que eu testei
  // durante a construcao escondeu o problema.
  const tela = readFileSync(new URL('../app/terapeutas/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('desdeUltimoPage'), 'o bloco nao tem estado de pagina')
  assert.ok(
    /desdeUltimo\.sessoes[\s\S]{0,120}\.slice\(\(desdeUltimoPage - 1\)/.test(tela),
    'o bloco nao corta a lista pela pagina',
  )
  assert.ok(tela.includes('setDesdeUltimoPage(1)'), 'a pagina nao volta para 1 ao trocar de terapeuta')
})

test('o corte compara por EPOCA, nao por string', () => {
  // Achado na segunda revisao de 11/09/2026. Os formatos reais do banco:
  //   data_confirmacao  2026-08-14T18:00:18.948+00:00   (com fracao)
  //   data_entrega      2026-07-20T15:20:00+00:00       (sem)
  // No segundo exato em que coincidem, '+' (0x2B) < '.' (0x2E) e a comparacao
  // de texto exclui a sessao.
  const corteReal = '2026-08-14T18:00:18.948+00:00'
  const noMesmoSegundo = '2026-08-14T18:00:18+00:00'
  assert.ok(noMesmoSegundo < corteReal, 'confirma que a comparacao de TEXTO erraria')

  const r = entreguesDesdeOFechamento({
    sessoes: [{ id: 'x', comissao_valor: 100, comissao_paga: false, data_entrega: '2026-08-14T18:00:19+00:00' }],
    fechamentos: [{ id: 'f', data_confirmacao: corteReal, sessoes: [] }],
  })
  assert.equal(r.sessoes.length, 1, 'um segundo DEPOIS do corte tem que entrar')
})

test('fuso diferente de +00:00 nao engana o corte', () => {
  // A mesma hora escrita em BRT. Por texto, "2026-08-14T15:30:00-03:00" e menor
  // que "2026-08-14T18:00:18.948+00:00" e seria excluida - mas 15:30 BRT e
  // 18:30 UTC, DEPOIS do corte.
  const r = entreguesDesdeOFechamento({
    sessoes: [{ id: 'brt', comissao_valor: 100, comissao_paga: false, data_entrega: '2026-08-14T15:30:00-03:00' }],
    fechamentos: [{ id: 'f', data_confirmacao: '2026-08-14T18:00:18.948+00:00', sessoes: [] }],
  })
  assert.equal(r.sessoes.length, 1, '15:30 BRT e 18:30 UTC: entra')
})

test('data invalida no fechamento nao vira corte', () => {
  const r = entreguesDesdeOFechamento({
    sessoes: [{ id: 'x', comissao_valor: 10, comissao_paga: false, data_entrega: '2026-01-01T00:00:00Z' }],
    fechamentos: [{ id: 'ruim', data_confirmacao: 'nao-e-data', sessoes: [] }],
  })
  assert.equal(r.corte, null, 'fechamento com data invalida e ignorado')
  assert.equal(r.sessoes.length, 1)
})
