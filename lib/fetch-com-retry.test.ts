import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchComRetry } from './fetch-com-retry'

// A causa raiz de 14/09/2026: o caminho Vercel -> Supabase falha o handshake
// SSL em ~5% das chamadas e o Cloudflare devolve uma pagina 525. Derrubou o
// lembrete de vespera tres noites seguidas, e sem isto atinge qualquer tela.

const respostaOk = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
const pagina525 = () => new Response(
  '<!DOCTYPE html><html><title>supabase.co | 525: SSL handshake failed</title>'
  + '<body>SSL handshake failed Error code 525 Cloudflare</body></html>',
  { status: 525, headers: { 'content-type': 'text/html' } },
)

test('CASO REAL: a pagina 525 do Cloudflare e repetida ate passar', async () => {
  let chamadas = 0
  const falso = async () => { chamadas++; return chamadas < 3 ? pagina525() : respostaOk() }
  const r = await fetchComRetry(falso as never)('https://x/rest/v1/sessoes')
  assert.equal(r.status, 200)
  assert.equal(chamadas, 3, 'duas falhas e um sucesso')
  assert.equal(await r.text(), '{"ok":true}', 'o corpo tem que chegar inteiro em quem chamou')
})

test('falha de conexao e repetida', async () => {
  for (const msg of ['fetch failed', 'ECONNRESET', 'socket hang up', 'handshake failure']) {
    let chamadas = 0
    const falso = async () => { chamadas++; if (chamadas === 1) throw new Error(msg); return respostaOk() }
    const r = await fetchComRetry(falso as never)('https://x')
    assert.equal(r.status, 200, msg)
    assert.equal(chamadas, 2, msg)
  }
})

test('erro que NAO e de conexao sobe na hora, sem repetir', async () => {
  // Repetir aqui esconderia o problema real e gastaria tempo.
  let chamadas = 0
  const falso = async () => { chamadas++; throw new Error('column "xpto" does not exist') }
  await assert.rejects(() => fetchComRetry(falso as never)('https://x'), /xpto/)
  assert.equal(chamadas, 1, 'nao pode repetir erro de SQL')
})

test('resposta 500 do PostgREST NAO e repetida - o banco respondeu', async () => {
  // So a pagina HTML do proxy e repetida. Um 500 com JSON veio do banco: ele
  // executou, e repetir um insert que deu erro de constraint so cria ruido.
  let chamadas = 0
  const falso = async () => {
    chamadas++
    return new Response('{"message":"violates unique constraint"}', {
      status: 500, headers: { 'content-type': 'application/json' },
    })
  }
  const r = await fetchComRetry(falso as never)('https://x')
  assert.equal(r.status, 500)
  assert.equal(chamadas, 1, 'erro do banco nao se repete')
})

test('desiste depois das tentativas e devolve o ultimo erro', async () => {
  let chamadas = 0
  const falso = async () => { chamadas++; throw new Error('fetch failed') }
  await assert.rejects(() => fetchComRetry(falso as never)('https://x'), /fetch failed/)
  assert.equal(chamadas, 4, '1 tentativa + 3 repeticoes')
})

test('desistindo na pagina 525, devolve a RESPOSTA e nao lanca', async () => {
  // Quem chamou precisa poder ler o status e o corpo para decidir o que fazer.
  let chamadas = 0
  const falso = async () => { chamadas++; return pagina525() }
  const r = await fetchComRetry(falso as never)('https://x')
  assert.equal(r.status, 525)
  assert.equal(chamadas, 4)
  assert.match(await r.text(), /525/, 'o corpo tem que continuar legivel apos as tentativas')
})

test('sucesso na primeira nao repete nada', async () => {
  let chamadas = 0
  const falso = async () => { chamadas++; return respostaOk() }
  await fetchComRetry(falso as never)('https://x')
  assert.equal(chamadas, 1)
})

test('o cliente do Supabase USA o retry - nos dois', () => {
  // Teste de fiacao: o retry pode estar perfeito e o cliente nao usar. Seria o
  // mesmo defeito de sempre - a regra existe e nao esta ligada.
  const sb = readFileSync(new URL('../lib/supabase.ts', import.meta.url), 'utf8')
  assert.ok(sb.includes('fetchComRetry'), 'lib/supabase.ts nao importa o retry')
  const usos = (sb.match(/global:\s*\{\s*fetch:\s*fetchComRetry\(\)/g) ?? []).length
  assert.equal(usos, 2, `o retry precisa estar nos DOIS clientes (anon e admin), achei ${usos}`)
})
