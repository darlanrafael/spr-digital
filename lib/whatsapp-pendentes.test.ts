import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verificarSecretCron, vendaEntraNoLembrete } from './whatsapp-pendentes'

// `lib/whatsapp-pendentes.ts` nao tinha arquivo de teste - e e o modulo do
// disparo de lembrete que PAROU EM PRODUCAO na noite de 13 para 14/09/2026
// (item 73 do MD: erro 525 da Cloudflare no caminho Vercel -> Supabase).
//
// O que mora aqui e o que mais importa no modulo: a UNICA autenticacao do
// disparo, e a regra que decide se uma mensagem REAL vai para um paciente REAL.

// ── verificarSecretCron: a unica tranca do disparo ──────────────────────────
const req = (cabecalho?: string): Request =>
  new Request('https://x/api/whatsapp/pendentes', {
    headers: cabecalho === undefined ? {} : { 'x-whatsapp-cron-secret': cabecalho },
  })

test('o segredo certo passa', () => {
  process.env.WHATSAPP_CRON_SECRET = 'segredo-de-teste'
  assert.equal(verificarSecretCron(req('segredo-de-teste')), true)
})

test('segredo errado NAO passa', () => {
  process.env.WHATSAPP_CRON_SECRET = 'segredo-de-teste'
  assert.equal(verificarSecretCron(req('outro')), false)
  assert.equal(verificarSecretCron(req('segredo-de-testX')), false, 'um caractere diferente nao passa')
  assert.equal(verificarSecretCron(req('segredo-de-test')), false, 'prefixo nao passa')
  assert.equal(verificarSecretCron(req('SEGREDO-DE-TESTE')), false, 'maiuscula conta')
  // Espaco nas PONTAS passa, e esta certo: o padrao HTTP manda remover espaco
  // em volta do valor do cabecalho, e o `Request` faz isso antes de a funcao
  // ver o texto. Eu escrevi o contrario no primeiro teste e ele falhou - a
  // afirmacao estava errada, nao o codigo.
  assert.equal(verificarSecretCron(req('  segredo-de-teste  ')), true, 'o HTTP tira o espaco das pontas')
})

test('sem o cabecalho NAO passa', () => {
  process.env.WHATSAPP_CRON_SECRET = 'segredo-de-teste'
  assert.equal(verificarSecretCron(req(undefined)), false)
  assert.equal(verificarSecretCron(req('')), false, 'cabecalho vazio nao passa')
})

test('FALHA FECHADA: sem a variavel de ambiente, NINGUEM passa', () => {
  // O caso perigoso. Se a ausencia da variavel liberasse a rota, qualquer
  // pessoa disparava mensagem de WhatsApp para paciente de verdade - e um
  // deploy sem a variavel configurada abriria isso sozinho, em silencio.
  delete process.env.WHATSAPP_CRON_SECRET
  assert.equal(verificarSecretCron(req('qualquer-coisa')), false)
  assert.equal(verificarSecretCron(req('')), false)
  assert.equal(verificarSecretCron(req(undefined)), false)
})

test('FALHA FECHADA: variavel vazia tambem nao libera', () => {
  // `''` e falsy, mas a comparacao `'' === ''` daria true se a guarda do
  // ambiente nao existisse - e um cabecalho vazio passaria.
  process.env.WHATSAPP_CRON_SECRET = ''
  assert.equal(verificarSecretCron(req('')), false)
  process.env.WHATSAPP_CRON_SECRET = 'segredo-de-teste'
})

// ── vendaEntraNoLembrete: manda ou nao manda a mensagem ─────────────────────
test('sem corte configurado, a venda ENTRA', () => {
  // O corte e opcional. Deixar de avisar por falta de configuracao seria pior
  // que avisar demais.
  assert.equal(vendaEntraNoLembrete({ corteDoTerapeuta: null, dataHoraDaVenda: '2026-01-01T00:00:00Z' }), true)
  assert.equal(vendaEntraNoLembrete({ corteDoTerapeuta: undefined, dataHoraDaVenda: '2026-01-01T00:00:00Z' }), true)
  assert.equal(vendaEntraNoLembrete({ corteDoTerapeuta: '', dataHoraDaVenda: '2026-01-01T00:00:00Z' }), true)
})

test('sem data de venda conhecida, a venda ENTRA', () => {
  assert.equal(vendaEntraNoLembrete({ corteDoTerapeuta: '2026-08-01T00:00:00Z', dataHoraDaVenda: null }), true)
  assert.equal(vendaEntraNoLembrete({ corteDoTerapeuta: '2026-08-01T00:00:00Z', dataHoraDaVenda: undefined }), true)
})

test('venda ANTES do corte fica FORA - e o caso que a regra existe para pegar', () => {
  // Dado retroativo, lancado em massa. Sem esta regra a automacao manda
  // mensagem real sobre paciente que nem deveria aparecer.
  assert.equal(vendaEntraNoLembrete({
    corteDoTerapeuta: '2026-08-01T00:00:00Z',
    dataHoraDaVenda: '2026-07-31T23:59:59Z',
  }), false)
})

test('venda DEPOIS do corte entra', () => {
  assert.equal(vendaEntraNoLembrete({
    corteDoTerapeuta: '2026-08-01T00:00:00Z',
    dataHoraDaVenda: '2026-08-01T00:00:01Z',
  }), true)
})

test('FRONTEIRA: venda no instante EXATO do corte ENTRA', () => {
  // "vendas a partir de" inclui o proprio instante. O mutante que trocava `>=`
  // por `>` sobrevivia sem este teste, e cortaria a venda feita exatamente no
  // segundo configurado - um paciente sem nenhum aviso, sem nada na tela
  // explicando por que.
  assert.equal(vendaEntraNoLembrete({
    corteDoTerapeuta: '2026-08-01T00:00:00Z',
    dataHoraDaVenda: '2026-08-01T00:00:00Z',
  }), true)
})

test('o corte compara INSTANTE, nao texto: fusos diferentes, mesmo momento', () => {
  // A regra do item 67 do MD, que custou R$ 3.181,85: no banco convivem data
  // em UTC com sufixo e data de Brasilia. Comparadas como texto, o erro e de
  // tres horas. Aqui os dois lados sao o MESMO instante escrito de dois jeitos.
  assert.equal(vendaEntraNoLembrete({
    corteDoTerapeuta: '2026-08-01T03:00:00Z',
    dataHoraDaVenda: '2026-08-01T00:00:00-03:00',
  }), true, 'mesmo instante entra pela fronteira')
})

test('uma hora antes do corte, com fusos diferentes, fica FORA', () => {
  assert.equal(vendaEntraNoLembrete({
    corteDoTerapeuta: '2026-08-01T03:00:00Z',
    dataHoraDaVenda: '2026-07-31T23:00:00-03:00',
  }), false)
})
