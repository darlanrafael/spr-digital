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
// --- ATAQUE por mutacao: os testes acima nao cobriam crachaGuardado nem os
// caminhos de window. Estes fecham os 9 sobreviventes da mutacao de 16/09.

import { crachaGuardado, instalarCrachaNoFetch } from './cracha-no-fetch'

// helper: monta um window falso com o localStorage dado
function comWindow(store: Record<string,string>, fn: () => void) {
  const g: any = globalThis
  const antes = g.window
  g.window = { localStorage: { getItem: (k: string) => store[k] ?? null }, location: { origin: 'http://localhost' } }
  try { fn() } finally { g.window = antes }
}

test('crachaGuardado: sem window (servidor) retorna null', () => {
  // linha 18: `typeof window === undefined`. No Node window nao existe.
  const g: any = globalThis
  assert.equal(typeof g.window, 'undefined')
  assert.equal(crachaGuardado(), null)
})

test('crachaGuardado: le o token da sessao do DRE', () => {
  comWindow({ spr_session: JSON.stringify({ token: 'abc123', email: 'a@b.c' }) }, () => {
    assert.equal(crachaGuardado(), 'abc123')
  })
})

test('crachaGuardado: le o token da sessao de TERAPEUTAS quando nao ha DRE', () => {
  comWindow({ terapeutas_session: JSON.stringify({ token: 'xyz789' }) }, () => {
    assert.equal(crachaGuardado(), 'xyz789')
  })
})

test('crachaGuardado: DRE tem prioridade sobre terapeutas', () => {
  comWindow({
    spr_session: JSON.stringify({ token: 'do-dre' }),
    terapeutas_session: JSON.stringify({ token: 'do-terapeuta' }),
  }, () => { assert.equal(crachaGuardado(), 'do-dre') })
})

test('ATAQUE: token que NAO e string e ignorado (linha 24)', () => {
  // `typeof s.token === 'string'`. Se um numero ou objeto vier no token, nao
  // pode ser usado como credencial.
  comWindow({ spr_session: JSON.stringify({ token: 12345 }) }, () => {
    assert.equal(crachaGuardado(), null, 'token numerico nao vale')
  })
  comWindow({ spr_session: JSON.stringify({ token: { a: 1 } }) }, () => {
    assert.equal(crachaGuardado(), null, 'token objeto nao vale')
  })
})

test('ATAQUE: token VAZIO e ignorado (linha 24, o segundo &&)', () => {
  // `&& s.token`: string vazia e falsy, nao pode virar cabecalho vazio.
  comWindow({ spr_session: JSON.stringify({ token: '' }) }, () => {
    assert.equal(crachaGuardado(), null, 'token vazio nao vale')
  })
})

test('ATAQUE: sessao SEM campo token e ignorada', () => {
  comWindow({ spr_session: JSON.stringify({ email: 'a@b.c' }) }, () => {
    assert.equal(crachaGuardado(), null)
  })
})

test('ATAQUE: JSON corrompido no localStorage nao derruba (linha 24 catch)', () => {
  comWindow({ spr_session: '{quebrado!!' }, () => {
    assert.doesNotThrow(() => crachaGuardado())
    assert.equal(crachaGuardado(), null)
  })
})

test('ATAQUE: instalarCrachaNoFetch nao instala duas vezes (linha 72-73)', () => {
  // `instalado` trava a segunda instalacao. Instalar duas vezes embrulharia o
  // embrulho, dobrando o cabecalho ou pior.
  const g: any = globalThis
  const antes = g.window
  let trocas = 0
  const fetchOriginal = async () => new Response('{}')
  g.window = {
    localStorage: { getItem: () => null },
    location: { origin: 'http://localhost' },
    get fetch() { return fetchOriginal },
    set fetch(_v) { trocas++ },
  }
  try {
    instalarCrachaNoFetch()
    instalarCrachaNoFetch()
    instalarCrachaNoFetch()
    assert.equal(trocas, 1, 'so pode trocar o fetch UMA vez, nao importa quantas chamadas')
  } finally { g.window = antes }
})

test('ATAQUE: URL malformada NAO leva o cracha (linha 51, o catch)', () => {
  // `http://[bad` faz `new URL` lancar. O catch retorna false = nao e chamada
  // da casa = nao anexa cracha. O mutante (`return true`) anexaria a credencial
  // numa URL que nem da para parsear - vazamento em potencial.
  const g: any = globalThis
  const antes = g.window
  g.window = { localStorage: { getItem: () => null }, location: { origin: 'http://localhost' } }
  try {
    let anexou = false
    const falso = async (_e: any, init?: RequestInit) => {
      anexou = new Headers(init?.headers).has(CABECALHO_DO_CRACHA)
      return new Response('{}')
    }
    return fetchComCracha(falso as typeof fetch, () => 'abc')('http://[bad').then(() => {
      assert.equal(anexou, false, 'URL malformada nao pode receber o cracha')
    })
  } finally { g.window = antes }
})

// --- Tarefa 5A: o 401 e a sessao perdida. O caso critico e NAO deslogar quem
// so errou a senha (5 rotas devolvem 401 para senha errada).

test('CRITICO: 401 de SENHA ERRADA (sem motivo) NAO desloga', async () => {
  // O 401 de senha errada nao manda `motivo`. So o do middleware manda.
  let deslogou = false
  const falso = async () => new Response(JSON.stringify({ error: 'Senha incorreta' }), { status: 401 })
  await fetchComCracha(falso as unknown as typeof fetch, () => 'abc', () => { deslogou = true })('/api/terapeutas/sessoes')
  assert.equal(deslogou, false, 'errar a senha nao pode jogar a pessoa para fora')
})

test('CRITICO: 401 do MIDDLEWARE (com motivo) desloga', async () => {
  let motivoRecebido: string | null = null
  const falso = async () => new Response(JSON.stringify({ motivo: 'vencido' }), { status: 401 })
  const r = await fetchComCracha(falso as unknown as typeof fetch, () => 'abc', m => { motivoRecebido = m })('/api/sales')
  assert.equal(r.status, 401, 'a resposta continua chegando na tela')
  assert.equal(motivoRecebido, 'vencido', 'a sessao perdida foi sinalizada')
})

test('401 com motivo "sem_cracha" tambem desloga', async () => {
  let motivo: string | null = null
  const falso = async () => new Response(JSON.stringify({ motivo: 'sem_cracha' }), { status: 401 })
  await fetchComCracha(falso as unknown as typeof fetch, () => null, m => { motivo = m })('/api/sales')
  assert.equal(motivo, 'sem_cracha')
})

test('resposta 200 nunca desloga', async () => {
  let deslogou = false
  const falso = async () => new Response('{}', { status: 200 })
  await fetchComCracha(falso as unknown as typeof fetch, () => 'abc', () => { deslogou = true })('/api/sales')
  assert.equal(deslogou, false)
})

test('401 de chamada para FORA (outro dominio) nao desloga', async () => {
  // Um 401 do Facebook nao significa que a sessao do SPR acabou. Como a chamada
  // e para fora, o embrulho nem olha o status - passa direto.
  let deslogou = false
  const falso = async () => new Response(JSON.stringify({ motivo: 'vencido' }), { status: 401 })
  await fetchComCracha(falso as unknown as typeof fetch, () => 'abc', () => { deslogou = true })('https://graph.facebook.com/me')
  assert.equal(deslogou, false, 'chamada externa nao dispara logout do SPR')
})

test('SEM cracha guardado, a chamada ainda sai (agora sempre chama, so nao poe header)', async () => {
  // A Tarefa 5A mudou: antes retornava cedo sem cracha. Agora sempre chama, para
  // poder ver o 401. Confirmo que a chamada acontece e sem o header.
  let chamou = false, temHeader = true
  const falso = async (_e: any, init?: RequestInit) => {
    chamou = true; temHeader = new Headers(init?.headers).has(CABECALHO_DO_CRACHA)
    return new Response('{}')
  }
  await fetchComCracha(falso as unknown as typeof fetch, () => null)('/api/sales')
  assert.equal(chamou, true, 'a chamada tem de acontecer mesmo sem cracha')
  assert.equal(temHeader, false, 'sem cracha, sem header')
})
