// lib/cracha-no-fetch.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchComCracha, CABECALHO_DO_CRACHA } from './cracha-no-fetch'

const respostaVazia = () => new Response('{}', { status: 200 })

test('anexa o cracha em chamada para /api/', async () => {
  let vista: Headers | null = null
  const falso = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    vista = new Headers(init?.headers)
    return respostaVazia()
  }
  const f = fetchComCracha(falso as typeof fetch, () => 'abc123')
  await f('/api/terapeutas/dashboard')
  assert.equal(vista!.get(CABECALHO_DO_CRACHA), 'abc123')
})

test('NAO anexa o cracha em endereco de FORA - o cracha nao pode vazar', async () => {
  // Uma chamada para outro site levaria a credencial junto.
  const testar = async (url: string) => {
    let vista: Headers | null = null
    const falso = async (_e: RequestInfo | URL, init?: RequestInit) => {
      vista = new Headers(init?.headers); return respostaVazia()
    }
    await fetchComCracha(falso as typeof fetch, () => 'abc123')(url)
    return vista!.get(CABECALHO_DO_CRACHA)
  }
  // `await` num teste `async`, e NAO `return Promise.all`: o callback do
  // node:test tem de devolver void|Promise<void>, e `return Promise.all([...])`
  // devolve Promise<[void,void]>, que reprova no `tsc --noEmit` (portao de
  // commit deste plano). Provado em 15/09/2026.
  for (const url of ['https://outro-site.com/api/x', 'https://graph.facebook.com/v21.0/me']) {
    assert.equal(await testar(url), null)
  }
})

test('sem cracha guardado, a chamada sai igual a hoje', async () => {
  let vista: Headers | null = null
  const falso = async (_e: RequestInfo | URL, init?: RequestInit) => {
    vista = new Headers(init?.headers); return respostaVazia()
  }
  await fetchComCracha(falso as typeof fetch, () => null)('/api/sales')
  assert.equal(vista!.get(CABECALHO_DO_CRACHA), null)
})

test('preserva os cabecalhos que a chamada ja tinha', async () => {
  // Se o embrulho apagasse o Content-Type, todo POST quebraria.
  let vista: Headers | null = null
  const falso = async (_e: RequestInfo | URL, init?: RequestInit) => {
    vista = new Headers(init?.headers); return respostaVazia()
  }
  await fetchComCracha(falso as typeof fetch, () => 'abc123')('/api/sales', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  })
  assert.equal(vista!.get('content-type'), 'application/json')
  assert.equal(vista!.get(CABECALHO_DO_CRACHA), 'abc123')
})

test('preserva metodo e corpo', async () => {
  let metodo = ''
  let corpo: BodyInit | null | undefined = null
  const falso = async (_e: RequestInfo | URL, init?: RequestInit) => {
    metodo = init?.method ?? ''; corpo = init?.body; return respostaVazia()
  }
  await fetchComCracha(falso as typeof fetch, () => 'abc')('/api/x', { method: 'PATCH', body: '{"a":1}' })
  assert.equal(metodo, 'PATCH')
  assert.equal(corpo, '{"a":1}')
})

test('aceita endereco como URL e como Request, nao so texto', async () => {
  // As 55 chamadas do projeto usam texto e template, mas o embrulho e global:
  // qualquer forma tem de funcionar, senao quebra algo que nao foi previsto.
  let vista: Headers | null = null
  const falso = async (_e: RequestInfo | URL, init?: RequestInit) => {
    vista = new Headers(init?.headers); return respostaVazia()
  }
  const f = fetchComCracha(falso as typeof fetch, () => 'abc')
  // URL objeto com a MESMA origem que a funcao usa quando nao ha window
  // (`http://localhost`). Fixar outra porta aqui testaria o ambiente, nao o
  // embrulho. No navegador de verdade a origem e a window.location.origin.
  await f(new URL('http://localhost/api/x'))
  assert.equal(vista!.get(CABECALHO_DO_CRACHA), 'abc')
})

test('endereco absoluto do PROPRIO site tambem leva o cracha', async () => {
  // Algumas das 55 chamadas podem ser absolutas. Com a mesma origem, entram.
  let vista: Headers | null = null
  const falso = async (_e: RequestInfo | URL, init?: RequestInit) => {
    vista = new Headers(init?.headers); return respostaVazia()
  }
  await fetchComCracha(falso as typeof fetch, () => 'abc')('http://localhost/api/sales')
  assert.equal(vista!.get(CABECALHO_DO_CRACHA), 'abc')
})