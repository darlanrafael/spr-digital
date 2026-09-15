# Autenticação das rotas de API - plano de implementação

> **Para quem for executar:** SUB-SKILL OBRIGATÓRIA: usar
> superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans, tarefa por tarefa. Os passos usam caixa de
> marcação (`- [ ]`).

**Objetivo:** fazer as rotas de API exigirem prova de login e passarem a decidir
o acesso pela identidade de quem chama, em vez de confiar no que o navegador
manda.

**Arquitetura:** o login emite um crachá (texto aleatório com validade
deslizante de 30 dias), guardado no banco. O navegador manda o crachá em toda
chamada, por um embrulho único em cima do `fetch`. Um `middleware.ts` confere o
crachá antes de qualquer rota de API e entrega a identidade para a rota. As
regras de quem pode o quê ficam em um módulo puro, com teste próprio.

**Base:** spec aprovada em
`docs/superpowers/specs/2026-09-15-autenticacao-api-design.md`.

**Stack:** Next.js 16.2.7, React 19, TypeScript, Supabase, testes com
`node:test` via `tsx --test lib/*.test.ts`.

## Restrições globais

Valem para TODAS as tarefas.

1. **Sete rotas não podem ser tocadas.** `app/api/webhooks/hubla`,
   `app/api/webhooks/kiwify`, `app/api/whatsapp/pendentes-vespera`,
   `app/api/whatsapp/pendentes-30min`, `app/api/whatsapp/marcar-enviado`,
   `app/api/dashboard-usuarios/login`, `app/api/terapeutas/login`. Exigir crachá
   nos dois webhooks **para a entrada de vendas em silêncio**.
2. **O sócio fica exatamente com a visualização de hoje.** O middleware não pode
   restringir sessão do DRE dentro do módulo de terapeutas;
   `app/terapeutas/layout.tsx:27` continua valendo. A única coisa que ele não vê
   é a divisão entre sócios.
3. **Nenhuma fase pode quebrar o sistema no ar.** Fases 1 e 2 deixam o
   comportamento idêntico ao de hoje.
4. **Teste de acesso prova chamando.** Teste que lê código não conta. Cada regra
   ganha prova que faz a requisição e confere a resposta.
5. **Sem travessão (—) em nenhum arquivo.** Usar hífen simples. O pré-voo
   (`npm run preflight`) reprova.
6. **Antes de cada commit:** `npx tsc --noEmit`, `npm test` e `npm run preflight`
   têm de passar.
7. **Nada de `git add -A` com o teste de mutação rodando.** O gancho de
   pré-commit recusa; não force.
8. **Rodar local NÃO isola os dados.** O `.env.local` aponta para o Supabase de
   PRODUÇÃO. Ler local é ler o banco real; escrever local é escrever no banco
   real. Por isso as provas de rota de escrita mandam corpo inválido de
   propósito: a rota recusa na validação e nada é gravado. **Nenhum passo deste
   plano cria, altera ou apaga registro de produção.**

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20260916000000_cracha_no_dashboard.sql` | duas colunas novas em `usuarios_dashboard` |
| `lib/cracha.ts` | puro: gerar crachá, dizer se venceu, dizer se precisa renovar |
| `lib/dashboard-auth.ts` (modificar) | emitir e conferir crachá do DRE |
| `lib/rotas-abertas.ts` | puro: a lista das 7 rotas que não exigem crachá |
| `lib/cracha-no-fetch.ts` | puro: embrulha o `fetch` do navegador e anexa o crachá |
| `middleware.ts` | confere o crachá e entrega a identidade para a rota |
| `lib/identidade-da-chamada.ts` | puro: lê a identidade e responde as regras de acesso |
| `scripts/provar-acesso.ts` | prova executável: faz as chamadas e confere as respostas |

---

## FASE 1 - emitir o crachá (sistema idêntico ao de hoje)

### Tarefa 1: as duas colunas em `usuarios_dashboard`

**Arquivos:**
- Criar: `supabase/migrations/20260916000000_cracha_no_dashboard.sql`

**Interfaces:**
- Produz: as colunas `session_token` (text, nulo, único) e
  `session_token_expira_em` (timestamptz, nulo) em `usuarios_dashboard`.

- [ ] **Passo 1: escrever a migração**

```sql
-- supabase/migrations/20260916000000_cracha_no_dashboard.sql
-- O login do DRE passa a emitir cracha, igual ao modulo de terapeutas ja faz em
-- usuarios_sistema. Mesmas duas colunas, mesmo significado.
alter table usuarios_dashboard
  add column if not exists session_token text,
  add column if not exists session_token_expira_em timestamptz;

-- O cracha e a credencial: dois usuarios nao podem ter o mesmo. O indice e
-- parcial porque a maioria das linhas fica com NULL ate a pessoa entrar.
create unique index if not exists usuarios_dashboard_session_token_unico
  on usuarios_dashboard (session_token)
  where session_token is not null;
```

- [ ] **Passo 2: o usuário roda a migração no Supabase**

Este projeto não aplica migração por linha de comando. Pedir ao usuário para
rodar o SQL no painel do Supabase e confirmar.

- [ ] **Passo 3: conferir que as colunas existem**

```bash
npx tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data, error } = await c.from('usuarios_dashboard').select('email,session_token,session_token_expira_em').limit(1)
console.log(error ? 'ERRO: ' + error.message : 'colunas ok: ' + JSON.stringify(data))
"
```

Esperado: `colunas ok: [...]`. Se der erro de coluna inexistente, a migração não
foi aplicada.

- [ ] **Passo 4: commit**

```bash
git add supabase/migrations/20260916000000_cracha_no_dashboard.sql
git commit -m "feat: usuarios_dashboard ganha as colunas de cracha"
```

---

### Tarefa 2: `lib/cracha.ts`, as regras de validade

**Arquivos:**
- Criar: `lib/cracha.ts`
- Criar: `lib/cracha.test.ts`

**Interfaces:**
- Produz: `gerarCracha(agoraMs?: number): { token: string; expiraEm: string }`,
  `crachaVencido(expiraEm: string | null | undefined, agoraMs?: number): boolean`,
  `precisaRenovar(expiraEm: string | null | undefined, agoraMs?: number): boolean`,
  `DIAS_DE_VALIDADE = 30`, `RENOVAR_QUANDO_FALTAR_DIAS = 15`.
- Consome: nada.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// lib/cracha.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarCracha, crachaVencido, precisaRenovar, DIAS_DE_VALIDADE } from './cracha'

const DIA = 24 * 60 * 60 * 1000

test('o cracha gerado tem texto aleatorio longo e validade de 30 dias', () => {
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  const c = gerarCracha(agora)
  assert.equal(c.token.length, 64, 'sao 32 bytes em hexadecimal')
  assert.match(c.token, /^[0-9a-f]{64}$/)
  assert.equal(c.expiraEm, new Date(agora + DIAS_DE_VALIDADE * DIA).toISOString())
})

test('dois crachas gerados NUNCA sao iguais', () => {
  // Se repetissem, uma pessoa entraria na conta de outra.
  const vistos = new Set<string>()
  for (let i = 0; i < 500; i++) vistos.add(gerarCracha().token)
  assert.equal(vistos.size, 500)
})

test('cracha sem validade conta como vencido', () => {
  // Linha antiga, de antes desta mudanca. Na duvida, recusa.
  assert.equal(crachaVencido(null), true)
  assert.equal(crachaVencido(undefined), true)
  assert.equal(crachaVencido(''), true)
})

test('FRONTEIRA: no instante EXATO do vencimento, o cracha ja nao vale', () => {
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  const expira = new Date(agora).toISOString()
  assert.equal(crachaVencido(expira, agora), true, 'vencer no mesmo instante e vencido')
  assert.equal(crachaVencido(new Date(agora + 1000).toISOString(), agora), false, 'um segundo a mais ainda vale')
})

test('precisaRenovar so quando falta menos de 15 dias', () => {
  // Evita escrever no banco a cada acao: na pratica uma escrita a cada ~15 dias.
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  assert.equal(precisaRenovar(new Date(agora + 20 * DIA).toISOString(), agora), false)
  assert.equal(precisaRenovar(new Date(agora + 10 * DIA).toISOString(), agora), true)
  assert.equal(precisaRenovar(new Date(agora + 15 * DIA + 1000).toISOString(), agora), false, 'faltando mais de 15 dias, nao renova')
})

test('cracha ja vencido NAO pede renovacao - pede login', () => {
  const agora = new Date('2026-09-16T12:00:00.000Z').getTime()
  assert.equal(precisaRenovar(new Date(agora - DIA).toISOString(), agora), false)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/cracha.test.ts`
Esperado: FALHA com "Cannot find module './cracha'".

- [ ] **Passo 3: escrever a implementação mínima**

```ts
// lib/cracha.ts
//
// SEM `import from 'crypto'`. Isto NAO e preferencia de estilo.
//
// Provado rodando em 15/09/2026: com `import * as crypto from 'crypto'`, o
// `npm run build` PASSA e o servidor devolve **HTTP 500 em toda rota de API**,
// com "The edge runtime does not support Node.js 'crypto' module". O middleware
// roda no runtime Edge, que nao tem os modulos do Node - e como o build nao
// executa o middleware, ele nao avisa nada.
//
// `globalThis.crypto.getRandomValues` e Web Crypto: existe no Edge E no Node
// 18+. Testado nos dois, com o mesmo resultado de 64 caracteres hexadecimais.

// A validade do cracha, e quando renova-la.
//
// Os numeros sao os mesmos que `lib/terapeutas-auth.ts` ja usa em producao
// desde 19/08/2026, e o motivo esta la: uma validade fixa de 7 dias fazia o
// Pedro voltar a digitar senha toda semana, que era exatamente o que a feature
// existia para evitar. Janela DESLIZANTE: cada uso empurra a validade para a
// frente, e o cracha so morre depois de 30 dias sem nenhum uso - que e o caso
// em que expirar protege mesmo (maquina perdida, pessoa desligada).
export const DIAS_DE_VALIDADE = 30
export const RENOVAR_QUANDO_FALTAR_DIAS = 15

const DIA_MS = 24 * 60 * 60 * 1000

/** A data em que um cracha emitido agora vence. Usada tambem na renovacao. */
export function novaValidade(agoraMs: number = Date.now()): string {
  return new Date(agoraMs + DIAS_DE_VALIDADE * DIA_MS).toISOString()
}

/** `agoraMs` existe para o teste poder fixar o instante. Ninguem passa. */
export function gerarCracha(agoraMs: number = Date.now()): { token: string; expiraEm: string } {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return {
    token: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
    expiraEm: novaValidade(agoraMs),
  }
}

/** Sem validade gravada, conta como vencido: na duvida, recusa. */
export function crachaVencido(expiraEm: string | null | undefined, agoraMs: number = Date.now()): boolean {
  if (!expiraEm) return true
  const t = new Date(expiraEm).getTime()
  if (Number.isNaN(t)) return true
  return t <= agoraMs
}

/** Renova so quando falta pouco, para nao escrever no banco a cada acao. */
export function precisaRenovar(expiraEm: string | null | undefined, agoraMs: number = Date.now()): boolean {
  if (!expiraEm) return false
  const t = new Date(expiraEm).getTime()
  if (Number.isNaN(t)) return false
  const falta = t - agoraMs
  return falta > 0 && falta < RENOVAR_QUANDO_FALTAR_DIAS * DIA_MS
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test lib/cracha.test.ts`
Esperado: PASSA, 6 testes.

- [ ] **Passo 5: rodar a suíte inteira, o tipo e o pré-voo**

```bash
npx tsc --noEmit && npm test && npm run preflight
```
Esperado: 0 falhas, 0 achado grave.

- [ ] **Passo 6: commit**

```bash
git add lib/cracha.ts lib/cracha.test.ts
git commit -m "feat: lib/cracha.ts com as regras de validade do cracha"
```

---

### Tarefa 2A: `lib/cabecalhos-da-identidade.ts`, os nomes dos cabeçalhos

**Arquivos:**
- Criar: `lib/cabecalhos-da-identidade.ts`

**Interfaces:**
- Produz: `CABECALHO_DO_CRACHA = 'x-spr-cracha'` e `CABECALHOS_DA_IDENTIDADE`.

**Por que um módulo só para isto.** Os mesmos nomes são usados no navegador
(`lib/cracha-no-fetch.ts`), no middleware (runtime Edge) e nas rotas (runtime
Node). Se morarem dentro do módulo do navegador, o middleware precisa importar
código de navegador - e foi importando o módulo errado que o middleware quebrou
no teste desta revisão. Um módulo sem nenhuma dependência não quebra em runtime
nenhum.

- [ ] **Passo 1: criar o arquivo**

```ts
// lib/cabecalhos-da-identidade.ts
//
// Os nomes dos cabecalhos, e nada mais. Sem import nenhum, de proposito: este
// arquivo e lido pelo navegador, pelo middleware (Edge) e pelas rotas (Node).
// Qualquer dependencia aqui vira dependencia nos tres.

/** Onde o navegador manda o cracha. */
export const CABECALHO_DO_CRACHA = 'x-spr-cracha'

/**
 * Onde o middleware escreve QUEM esta chamando.
 *
 * O middleware APAGA estes cabecalhos antes de escrever. Sem isso, quem chama
 * mandaria `x-spr-quem-tipo: dashboard:admin` na mao e viraria admin.
 */
export const CABECALHOS_DA_IDENTIDADE = {
  tipo: 'x-spr-quem-tipo',
  id: 'x-spr-quem-id',
  terapeutaId: 'x-spr-quem-terapeuta-id',
  email: 'x-spr-quem-email',
} as const
```

- [ ] **Passo 2: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add lib/cabecalhos-da-identidade.ts
git commit -m "feat: os nomes dos cabecalhos num modulo sem dependencia"
```

---

### Tarefa 3: o login do DRE emite crachá

**Arquivos:**
- Modificar: `lib/dashboard-auth.ts`
- Modificar: `app/api/dashboard-usuarios/login/route.ts`

**Interfaces:**
- Consome: `gerarCracha` de `lib/cracha.ts`.
- Produz: `verificarSenhaDashboard` passa a devolver também `token` dentro de
  `usuario`; a rota de login passa a devolver `token` no JSON.

- [ ] **Passo 1: emitir o crachá no `verificarSenhaDashboard`**

Em `lib/dashboard-auth.ts`, depois de achar o usuário e antes do `return`:

```ts
  // Emite o cracha no login. Falha ao gravar NAO derruba o login: a pessoa
  // entra e as telas seguem funcionando como antes - so nao ganha cracha desta
  // vez. Derrubar aqui trocaria um problema pequeno por ninguem conseguir
  // entrar.
  const { token, expiraEm } = gerarCracha()
  const { error: erroToken } = await client
    .from('usuarios_dashboard')
    .update({ session_token: token, session_token_expira_em: expiraEm })
    .eq('id', data.id)
  if (erroToken) console.error('[dashboard-auth] cracha nao gravado:', erroToken.message)

  return {
    valido: true,
    usuario: { ...(data as { id: string; nome: string; email: string; role: string }), token: erroToken ? null : token },
  }
```

E o tipo de retorno passa a ser:

```ts
): Promise<{ valido: boolean; usuario?: { id: string; nome: string; email: string; role: string; token: string | null } }> {
```

com o import no topo do arquivo:

```ts
import { gerarCracha } from './cracha'
```

- [ ] **Passo 2: a rota de login devolve o crachá**

Em `app/api/dashboard-usuarios/login/route.ts`, no `return` de sucesso:

```ts
    return NextResponse.json({
      email: usuario.email,
      name: usuario.nome,
      role: usuario.role,
      token: usuario.token,
    })
```

- [ ] **Passo 3: provar rodando que o login devolve crachá**

```bash
npm run dev > /tmp/dev.log 2>&1 &
until grep -q "Ready in" /tmp/dev.log; do sleep 1; done
curl -s -X POST http://localhost:3000/api/dashboard-usuarios/login \
  -H "Content-Type: application/json" \
  -d '{"email":"SEU_EMAIL","senha":"SUA_SENHA"}' | head -c 300
```

Esperado: o JSON com `email`, `name`, `role` e um `token` de 64 caracteres
hexadecimais. **Pedir a senha ao usuário; não inventar nem procurar no código.**

- [ ] **Passo 4: provar que nada mais mudou**

```bash
npx tsc --noEmit && npm test && npm run preflight
```
Esperado: 0 falhas. Nenhuma tela muda: ninguém ainda lê esse `token`.

- [ ] **Passo 5: commit**

```bash
git add lib/dashboard-auth.ts app/api/dashboard-usuarios/login/route.ts
git commit -m "feat: o login do DRE passa a emitir cracha"
```

---

## FASE 2 - as telas mandam o crachá (sistema idêntico ao de hoje)

### Tarefa 4: `lib/cracha-no-fetch.ts`, o embrulho do navegador

**Arquivos:**
- Criar: `lib/cracha-no-fetch.ts`
- Criar: `lib/cracha-no-fetch.test.ts`
- Modificar: `contexts/AppContext.tsx`

**Interfaces:**
- Produz: `CABECALHO_DO_CRACHA = 'x-spr-cracha'`,
  `fetchComCracha(fetchOriginal, lerCracha): typeof fetch`,
  `instalarCrachaNoFetch(): void`.
- Consome: nada de tarefas anteriores.

**Por que embrulho e não editar as chamadas.** São 55 chamadas a `/api/` em 11
arquivos. Editar as 55 é 55 chances de esquecer uma - e a que faltasse só
apareceria como tela quebrada depois da fase 3. O projeto já usa este padrão em
`lib/fetch-com-retry.ts`, ligado em `lib/supabase.ts:28`.

- [ ] **Passo 1: escrever o teste que falha**

```ts
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

test('NAO anexa o cracha em endereco de FORA - o cracha nao pode vazar', () => {
  // Uma chamada para outro site levaria a credencial junto.
  const testar = async (url: string) => {
    let vista: Headers | null = null
    const falso = async (_e: RequestInfo | URL, init?: RequestInit) => {
      vista = new Headers(init?.headers); return respostaVazia()
    }
    await fetchComCracha(falso as typeof fetch, () => 'abc123')(url)
    return vista!.get(CABECALHO_DO_CRACHA)
  }
  return Promise.all([
    testar('https://outro-site.com/api/x').then(v => assert.equal(v, null)),
    testar('https://graph.facebook.com/v21.0/me').then(v => assert.equal(v, null)),
  ])
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
  await f(new URL('http://localhost:3000/api/x'))
  assert.equal(vista!.get(CABECALHO_DO_CRACHA), 'abc')
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/cracha-no-fetch.test.ts`
Esperado: FALHA com "Cannot find module './cracha-no-fetch'".

- [ ] **Passo 3: escrever a implementação**

```ts
// lib/cracha-no-fetch.ts
//
// Anexa o cracha em toda chamada que a tela faz para /api/.
//
// POR QUE EMBRULHO, e nao editar as chamadas: sao 55 chamadas a `/api/` em 11
// arquivos. Editar as 55 e 55 chances de esquecer uma, e a esquecida so
// apareceria como tela quebrada depois que o middleware passasse a exigir.
// Mesmo padrao de `lib/fetch-com-retry.ts`, que ja embrulha o fetch do Supabase.

import { CABECALHO_DO_CRACHA } from './cabecalhos-da-identidade'
export { CABECALHO_DO_CRACHA }

const CHAVE_DRE = 'spr_session'
const CHAVE_TERAPEUTAS = 'terapeutas_session'

/** O cracha guardado no navegador, de qualquer uma das duas areas de login. */
export function crachaGuardado(): string | null {
  if (typeof window === 'undefined') return null
  for (const chave of [CHAVE_DRE, CHAVE_TERAPEUTAS]) {
    try {
      const cru = window.localStorage.getItem(chave)
      if (!cru) continue
      const s = JSON.parse(cru) as { token?: string } | null
      if (s && typeof s.token === 'string' && s.token) return s.token
    } catch { /* sessao corrompida nao derruba a chamada */ }
  }
  return null
}

/** So chamada para o proprio sistema leva o cracha junto. */
function ehChamadaDaCasa(entrada: RequestInfo | URL): boolean {
  const url = typeof entrada === 'string' ? entrada
    : entrada instanceof URL ? entrada.href
    : entrada.url
  if (url.startsWith('/api/')) return true
  if (typeof window === 'undefined') return false
  try {
    return new URL(url, window.location.origin).origin === window.location.origin
      && new URL(url, window.location.origin).pathname.startsWith('/api/')
  } catch { return false }
}

export function fetchComCracha(
  fetchOriginal: typeof fetch,
  lerCracha: () => string | null = crachaGuardado,
): typeof fetch {
  return async (entrada: RequestInfo | URL, init?: RequestInit) => {
    if (!ehChamadaDaCasa(entrada)) return fetchOriginal(entrada, init)
    const cracha = lerCracha()
    if (!cracha) return fetchOriginal(entrada, init)
    const cabecalhos = new Headers(init?.headers)
    cabecalhos.set(CABECALHO_DO_CRACHA, cracha)
    return fetchOriginal(entrada, { ...init, headers: cabecalhos })
  }
}

let instalado = false

/** Instala o embrulho uma vez so, no navegador. */
export function instalarCrachaNoFetch(): void {
  if (typeof window === 'undefined' || instalado) return
  instalado = true
  window.fetch = fetchComCracha(window.fetch.bind(window))
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test lib/cracha-no-fetch.test.ts`
Esperado: PASSA, 6 testes.

- [ ] **Passo 5: ligar no AppProvider**

Em `contexts/AppContext.tsx`, dentro do componente `AppProvider`, junto dos
outros efeitos de montagem:

```ts
  // Instala o embrulho do fetch uma vez, antes de qualquer tela chamar a API.
  useEffect(() => { instalarCrachaNoFetch() }, [])
```

com o import no topo:

```ts
import { instalarCrachaNoFetch } from '@/lib/cracha-no-fetch'
```

- [ ] **Passo 6: guardar o crachá no login das duas áreas**

**NÃO é na tela de login.** Verificado em 15/09/2026: a sessão do DRE é gravada
em `lib/auth.ts:44`, dentro de `persistSession`, e quem chama é
`loginDashboardUser` (`lib/auth.ts:67`), que faz:

```ts
  const user = await res.json() as User
  persistSession(user)
```

Como `persistSession` grava o objeto inteiro, **basta o `token` existir no tipo
`User`** e ele passa a ser gravado sozinho. Em `types/index.ts`:

```ts
export interface User {
  email: string
  name: string
  role: UserRole
  projetoId?: string
  /** O cracha emitido no login. Opcional porque sessao antiga, de antes desta
   *  mudanca, nao tem - e quem cair nesse caso e mandado para o login pela
   *  Tarefa 5A. */
  token?: string | null
}
```

Nenhuma linha de `app/login/page.tsx` muda.

O módulo de terapeutas já grava `token` em `terapeutas_session`
(`app/api/terapeutas/login/route.ts:70` devolve, e a tela guarda) - conferir e
não mexer se já estiver lá.

- [ ] **Passo 7: provar rodando que a chamada sai com o crachá**

Com o `npm run dev` rodando, abrir o sistema no navegador, fazer login, abrir as
Ferramentas do Desenvolvedor na aba Rede, clicar em qualquer tela e conferir que
as chamadas para `/api/` levam o cabeçalho `x-spr-cracha`.

**Nada pode ter parado de funcionar:** as rotas ainda não exigem nada.

- [ ] **Passo 8: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add lib/cracha-no-fetch.ts lib/cracha-no-fetch.test.ts contexts/AppContext.tsx types/index.ts
git commit -m "feat: as telas passam a mandar o cracha em toda chamada de API"
```

---

## FASE 3 - o middleware exige (a única fase que pode quebrar algo)

> **ANTES DE QUALQUER TAREFA DESTA FASE, ler a Tarefa 5A.** Ela é o que impede
> que todo mundo fique trancado para fora no dia em que isto subir.

### Tarefa 5A: a sessão antiga, sem crachá

**O problema, e ele é certo, não é hipótese.** Quando a fase 3 subir, Denise,
Pedro, os quatro comerciais e o Reinaldo vão estar com sessão gravada no
navegador de ANTES da fase 1 - ou seja, **sem crachá**. O embrulho do fetch não
acha token nenhum, não manda cabeçalho, o middleware recusa com 401, e a tela
mostra erro sem explicar nada. **Todos ficam trancados para fora ao mesmo
tempo**, e a primeira notícia disso seria você recebendo mensagem deles.

**A correção:** a tela trata 401 mandando a pessoa para o login certo, com uma
frase que explica. Sem isto, o 401 vira "erro" genérico no meio da tela.

**Arquivos:**
- Modificar: `lib/cracha-no-fetch.ts`
- Modificar: `lib/cracha-no-fetch.test.ts`

**Interfaces:**
- Produz: `fetchComCracha` passa a aceitar um terceiro parâmetro
  `aoPerderSessao?: (motivo: string) => void`, chamado quando a resposta for 401.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `lib/cracha-no-fetch.test.ts`:

```ts
test('resposta 401 avisa que a sessao acabou', async () => {
  // Quem esta logado desde ANTES do cracha existir cai exatamente aqui: sem
  // este aviso, a tela mostra "erro" e a pessoa nao sabe que e so entrar de novo.
  let motivoRecebido: string | null = null
  const falso = async () => new Response(JSON.stringify({ motivo: 'vencido' }), { status: 401 })
  const f = fetchComCracha(falso as unknown as typeof fetch, () => 'abc', m => { motivoRecebido = m })
  const r = await f('/api/sales')
  assert.equal(r.status, 401, 'a resposta continua chegando na tela')
  assert.equal(motivoRecebido, 'vencido')
})

test('401 de chamada para FORA nao dispara o aviso', async () => {
  // Um 401 do Facebook nao significa que a sessao do SPR acabou.
  let chamou = false
  const falso = async () => new Response('{}', { status: 401 })
  await fetchComCracha(falso as unknown as typeof fetch, () => 'abc', () => { chamou = true })(
    'https://graph.facebook.com/v21.0/me')
  assert.equal(chamou, false)
})

test('resposta normal nao dispara o aviso', async () => {
  let chamou = false
  const falso = async () => new Response('{}', { status: 200 })
  await fetchComCracha(falso as unknown as typeof fetch, () => 'abc', () => { chamou = true })('/api/sales')
  assert.equal(chamou, false)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/cracha-no-fetch.test.ts`
Esperado: FALHA - `fetchComCracha` ainda não aceita o terceiro parâmetro.

- [ ] **Passo 3: implementar**

Em `lib/cracha-no-fetch.ts`, trocar a assinatura e o corpo de `fetchComCracha`:

```ts
export function fetchComCracha(
  fetchOriginal: typeof fetch,
  lerCracha: () => string | null = crachaGuardado,
  aoPerderSessao?: (motivo: string) => void,
): typeof fetch {
  return async (entrada: RequestInfo | URL, init?: RequestInit) => {
    if (!ehChamadaDaCasa(entrada)) return fetchOriginal(entrada, init)
    const cracha = lerCracha()
    const cabecalhos = new Headers(init?.headers)
    if (cracha) cabecalhos.set(CABECALHO_DO_CRACHA, cracha)
    const r = await fetchOriginal(entrada, { ...init, headers: cabecalhos })

    // 401 do PROPRIO sistema significa sessao perdida. Quem estava logado desde
    // antes do cracha existir cai aqui, e precisa ser mandado para o login com
    // uma frase que explique - nao para uma tela de erro generica.
    if (r.status === 401 && aoPerderSessao) {
      let motivo = 'sem_cracha'
      try { motivo = ((await r.clone().json()) as { motivo?: string }).motivo ?? motivo } catch { /* sem corpo */ }
      aoPerderSessao(motivo)
    }
    return r
  }
}
```

E `instalarCrachaNoFetch` passa a mandar a pessoa para o login certo:

```ts
export function instalarCrachaNoFetch(): void {
  if (typeof window === 'undefined' || instalado) return
  instalado = true
  window.fetch = fetchComCracha(window.fetch.bind(window), crachaGuardado, () => {
    // Limpa a sessao velha: deixada la, a tela de login voltaria a achar que a
    // pessoa esta logada e o ciclo se repetiria.
    try {
      window.localStorage.removeItem(CHAVE_DRE)
      window.localStorage.removeItem(CHAVE_TERAPEUTAS)
    } catch { /* navegador sem storage nao impede o redirecionamento */ }
    const ehModuloDeTerapeutas = window.location.pathname.startsWith('/terapeutas')
    const destino = ehModuloDeTerapeutas ? '/terapeutas/login' : '/login'
    if (window.location.pathname !== destino) {
      window.location.href = `${destino}?sessao=expirada`
    }
  })
}
```

- [ ] **Passo 4: a tela de login explica**

Em `app/login/page.tsx` e `app/terapeutas/login/page.tsx`, quando a URL tiver
`?sessao=expirada`, mostrar acima do formulário:

```tsx
{useSearchParams().get('sessao') === 'expirada' && (
  <p className="text-sm text-amber-400 mb-4">
    Sua sessão expirou. Entre de novo para continuar.
  </p>
)}
```

- [ ] **Passo 5: provar rodando, simulando a sessão antiga**

Com o `npm run dev` rodando e o middleware já no lugar (Tarefa 6), no navegador:

1. Entrar normalmente no sistema.
2. Abrir o Console e apagar o crachá da sessão, simulando quem entrou antes:
   `const s = JSON.parse(localStorage.getItem('spr_session')); delete s.token; localStorage.setItem('spr_session', JSON.stringify(s))`
3. Recarregar a página.

Esperado: a pessoa cai na tela de login com a frase "Sua sessão expirou", **não**
numa tela de erro.

- [ ] **Passo 6: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add lib/cracha-no-fetch.ts lib/cracha-no-fetch.test.ts app/login/page.tsx app/terapeutas/login/page.tsx
git commit -m "fix: sessao antiga sem cracha cai no login com explicacao, nao em erro"
```

---


### Tarefa 5: `lib/rotas-abertas.ts`, a lista de exceção

**Arquivos:**
- Criar: `lib/rotas-abertas.ts`
- Criar: `lib/rotas-abertas.test.ts`

**Interfaces:**
- Produz: `ROTAS_ABERTAS: string[]`, `ehRotaAberta(caminho: string): boolean`.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// lib/rotas-abertas.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehRotaAberta, ROTAS_ABERTAS } from './rotas-abertas'

test('as SETE rotas que nao podem exigir cracha estao abertas', () => {
  // Exigir cracha nos dois webhooks PARA A ENTRADA DE VENDAS EM SILENCIO:
  // a Hubla e a Kiwify nao tem login, e nenhum erro apareceria em tela.
  for (const r of [
    '/api/webhooks/hubla',
    '/api/webhooks/kiwify',
    '/api/whatsapp/pendentes-vespera',
    '/api/whatsapp/pendentes-30min',
    '/api/whatsapp/marcar-enviado',
    '/api/dashboard-usuarios/login',
    '/api/terapeutas/login',
  ]) {
    assert.equal(ehRotaAberta(r), true, `${r} tem de ficar aberta`)
  }
  assert.equal(ROTAS_ABERTAS.length, 7, 'sao exatamente sete, nem mais nem menos')
})

test('as rotas que DEVEM exigir cracha nao estao na lista', () => {
  for (const r of [
    '/api/terapeutas/dashboard',
    '/api/terapeutas/admin/usuarios',
    '/api/terapeutas/admin/terapeutas',
    '/api/closings',
    '/api/sales',
    '/api/costs',
    '/api/cashflow',
    '/api/dashboard-usuarios',
  ]) {
    assert.equal(ehRotaAberta(r), false, `${r} NAO pode ficar aberta`)
  }
})

test('ARMADILHA: /api/dashboard-usuarios NAO pode pegar carona no /login', () => {
  // `dashboard-usuarios/login` e aberta; `dashboard-usuarios` cria e altera
  // usuario do DRE. Se a comparacao fosse por prefixo, a segunda entraria junto.
  assert.equal(ehRotaAberta('/api/dashboard-usuarios/login'), true)
  assert.equal(ehRotaAberta('/api/dashboard-usuarios'), false)
  assert.equal(ehRotaAberta('/api/dashboard-usuarios/qualquer-coisa'), false)
})

test('barra no fim nao muda o resultado', () => {
  assert.equal(ehRotaAberta('/api/webhooks/hubla/'), true)
  assert.equal(ehRotaAberta('/api/terapeutas/dashboard/'), false)
})

test('endereco com parametro continua sendo a mesma rota', () => {
  assert.equal(ehRotaAberta('/api/whatsapp/pendentes-30min'), true)
  assert.equal(ehRotaAberta('/api/terapeutas/dashboard'), false)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/rotas-abertas.test.ts`
Esperado: FALHA com "Cannot find module './rotas-abertas'".

- [ ] **Passo 3: escrever a implementação**

```ts
// lib/rotas-abertas.ts
//
// As rotas que NAO exigem cracha, e o motivo de cada uma.
//
// Esta lista e uma RESTRICAO DE SEGURANCA ao contrario: tirar uma daqui nao
// deixa o sistema mais seguro, deixa quebrado. Os dois webhooks sao a Hubla e a
// Kiwify chamando o sistema para avisar de venda nova - eles nao tem login. Se
// passarem a exigir cracha, AS VENDAS PARAM DE ENTRAR EM SILENCIO: nenhum erro
// aparece em tela, e a falta so seria notada dias depois.

export const ROTAS_ABERTAS = [
  '/api/webhooks/hubla',              // a Hubla avisando de venda nova
  '/api/webhooks/kiwify',             // a Kiwify avisando de venda nova
  '/api/whatsapp/pendentes-vespera',  // cron; ja confere x-whatsapp-cron-secret
  '/api/whatsapp/pendentes-30min',    // cron; idem
  '/api/whatsapp/marcar-enviado',     // cron; idem
  '/api/dashboard-usuarios/login',    // e o proprio login do DRE
  '/api/terapeutas/login',            // e o proprio login do modulo de terapeutas
]

/**
 * Comparacao EXATA, nunca por prefixo.
 *
 * Por prefixo, `/api/dashboard-usuarios/login` (aberta) abriria tambem
 * `/api/dashboard-usuarios`, que cria e altera usuario do DRE.
 */
export function ehRotaAberta(caminho: string): boolean {
  const limpo = caminho.split('?')[0].replace(/\/+$/, '')
  return ROTAS_ABERTAS.includes(limpo)
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test lib/rotas-abertas.test.ts`
Esperado: PASSA, 5 testes.

- [ ] **Passo 5: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add lib/rotas-abertas.ts lib/rotas-abertas.test.ts
git commit -m "feat: a lista das sete rotas que nao exigem cracha"
```

---

### Tarefa 6: o `middleware.ts`

**Arquivos:**
- Criar: `middleware.ts` (na raiz do projeto)

**Interfaces:**
- Consome: `ehRotaAberta` de `lib/rotas-abertas.ts`, `CABECALHO_DO_CRACHA` de
  `lib/cracha-no-fetch.ts`, `crachaVencido` e `precisaRenovar` de `lib/cracha.ts`.
- Produz: os cabeçalhos `x-spr-quem-tipo`, `x-spr-quem-id`,
  `x-spr-quem-terapeuta-id` e `x-spr-quem-email`, que a Tarefa 8 lê.

- [ ] **Passo 1: escrever o middleware**

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ehRotaAberta } from '@/lib/rotas-abertas'
import { CABECALHO_DO_CRACHA } from '@/lib/cabecalhos-da-identidade'
import { crachaVencido, precisaRenovar, novaValidade } from '@/lib/cracha'
import { CABECALHOS_DA_IDENTIDADE } from '@/lib/cabecalhos-da-identidade'

// A porta de entrada de TODA rota de API.
//
// Antes disto, cada rota decidia sozinha se pedia alguma coisa - e a maioria nao
// pedia nada. Espalhado, basta esquecer uma rota para o furo continuar; aqui, o
// padrao e recusar, e a excecao e uma lista curta e testada.
//
// O que ele entrega para a rota: QUEM esta chamando, em cabecalhos que o proprio
// middleware escreve. A rota passa a usar isso no lugar do que o navegador
// mandou.

function recusar(motivo: 'sem_cracha' | 'vencido') {
  return NextResponse.json({
    error: motivo === 'vencido'
      ? 'Sua sessão expirou. Entre de novo.'
      : 'Você precisa entrar no sistema para fazer isso.',
    motivo,
  }, { status: 401 })
}

export async function middleware(req: NextRequest) {
  const caminho = req.nextUrl.pathname
  if (!caminho.startsWith('/api/')) return NextResponse.next()
  if (ehRotaAberta(caminho)) return NextResponse.next()

  const cracha = req.headers.get(CABECALHO_DO_CRACHA)
  if (!cracha) return recusar('sem_cracha')

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Procura nas DUAS areas de login. Sao tabelas independentes e nao se falam.
  const { data: doSistema } = await client
    .from('usuarios_sistema')
    .select('id,email,tipo,terapeuta_id,ativo,session_token_expira_em')
    .eq('session_token', cracha).eq('ativo', true).maybeSingle()

  const { data: doDashboard } = doSistema ? { data: null } : await client
    .from('usuarios_dashboard')
    .select('id,email,role,ativo,session_token_expira_em')
    .eq('session_token', cracha).eq('ativo', true).maybeSingle()

  const achado = doSistema ?? doDashboard
  if (!achado) return recusar('sem_cracha')

  const expiraEm = (achado as { session_token_expira_em: string | null }).session_token_expira_em
  if (crachaVencido(expiraEm)) return recusar('vencido')

  // Janela deslizante: enquanto a pessoa usa, o cracha nao vence.
  if (precisaRenovar(expiraEm)) {
    const tabela = doSistema ? 'usuarios_sistema' : 'usuarios_dashboard'
    const nova = novaValidade()
    const { error } = await client.from(tabela)
      .update({ session_token_expira_em: nova }).eq('session_token', cracha)
    // Falha aqui NAO invalida a chamada: a pessoa ja esta autenticada.
    if (error) console.error('[middleware] validade nao renovada:', error.message)
  }

  const cabecalhos = new Headers(req.headers)
  // Apaga o que veio de fora ANTES de escrever: sem isto, quem chama forjaria a
  // identidade mandando o cabecalho direto e viraria admin.
  for (const c of Object.values(CABECALHOS_DA_IDENTIDADE)) cabecalhos.delete(c)

  if (doSistema) {
    const u = doSistema as { id: string; email: string; tipo: string; terapeuta_id: string | null }
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.tipo, `sistema:${u.tipo}`)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.id, u.id)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.email, u.email)
    if (u.terapeuta_id) cabecalhos.set(CABECALHOS_DA_IDENTIDADE.terapeutaId, u.terapeuta_id)
  } else {
    const u = doDashboard as unknown as { id: string; email: string; role: string }
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.tipo, `dashboard:${u.role}`)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.id, u.id)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.email, u.email)
  }

  return NextResponse.next({ request: { headers: cabecalhos } })
}

// So roda em /api/. Sem isto, toda pagina passaria por aqui a toa.
export const config = { matcher: '/api/:path*' }
```

- [ ] **Passo 2: conferir que o middleware roda mesmo**

O Next 16 roda middleware no runtime Edge por padrão. A consulta ao Supabase
usa `fetch`, que existe lá. Subir o servidor e conferir:

```bash
npm run dev > /tmp/dev.log 2>&1 &
until grep -q "Ready in" /tmp/dev.log; do sleep 1; done
curl -s -o /dev/null -w "sem cracha: HTTP %{http_code}\n" http://localhost:3000/api/sales
grep -i "error\|middleware" /tmp/dev.log | head -5
```

Esperado: `sem cracha: HTTP 401` e nenhum erro no log.

**Se aparecer erro de runtime** (algum módulo não suportado no Edge),
acrescentar ao `middleware.ts`:

```ts
export const config = { matcher: '/api/:path*', runtime: 'nodejs' }
```

e repetir a conferência.

- [ ] **Passo 3: provar que as SETE rotas abertas continuam abertas**

```bash
for r in /api/webhooks/hubla /api/webhooks/kiwify; do
  curl -s -o /dev/null -w "$r POST sem cracha: HTTP %{http_code}\n" \
    -X POST -H "Content-Type: application/json" -d '{}' "http://localhost:3000$r"
done
for r in /api/whatsapp/pendentes-vespera /api/whatsapp/pendentes-30min; do
  curl -s -o /dev/null -w "$r GET sem cracha: HTTP %{http_code}\n" "http://localhost:3000$r"
done
```

Esperado: **nenhum 401**. Os webhooks devem responder o que já respondiam a um
corpo vazio, e as rotas de cron devem responder o que já respondiam sem o
segredo. **Qualquer 401 aqui é falha grave: significa que a entrada de vendas
vai parar.**

- [ ] **Passo 4: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add middleware.ts
git commit -m "feat: middleware confere o cracha antes de toda rota de API"
```

---

### Tarefa 7: `scripts/provar-acesso.ts`, a prova executável

**Arquivos:**
- Criar: `scripts/provar-acesso.ts`
- Modificar: `package.json` (um script novo)

**Interfaces:**
- Consome: o servidor rodando em `http://localhost:3000`.
- Produz: o comando `npm run provar-acesso`.

**Por que isto existe.** Teste que lê código não prova acesso. Esta é a única
forma de responder "a Denise consegue ver o faturamento do Pedro?" com um fato.

- [ ] **Passo 1: escrever o script**

```ts
// scripts/provar-acesso.ts
//
// PROVA DE ACESSO: faz as chamadas de verdade e confere a resposta.
//
// Existe porque teste que le codigo nao prova acesso. Em 15/09/2026 quatro
// afirmacoes minhas tiradas de leitura de codigo estavam erradas, e todas as
// que sairam de execucao estavam certas.
//
// Roda contra o servidor local. NAO cria, NAO altera e NAO apaga nada: onde
// precisa provar rota de escrita, manda corpo invalido de proposito - se a
// resposta for 400 de validacao em vez de 401, esta provado que nao ha guarda,
// e nada foi gravado.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE_DA_PROVA ?? 'http://localhost:3000'
const CABECALHO = 'x-spr-cracha'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} | ${nome} | esperado ${esperado}, obtido ${obtido}`)
}

async function status(caminho: string, cracha?: string, metodo = 'GET', corpo?: string): Promise<number> {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(cracha ? { [CABECALHO]: cracha } : {}),
    },
    ...(corpo ? { body: corpo } : {}),
  })
  return r.status
}

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('\n=== SEM CRACHA: tem de recusar ===')
  for (const r of ['/api/terapeutas/dashboard', '/api/closings', '/api/sales', '/api/costs', '/api/cashflow']) {
    conferir(`${r} sem cracha`, await status(r), 401)
  }
  conferir('POST /api/terapeutas/admin/usuarios sem cracha',
    await status('/api/terapeutas/admin/usuarios', undefined, 'POST', '{}'), 401)

  console.log('\n=== AS SETE ROTAS ABERTAS: nao podem recusar ===')
  for (const r of ['/api/whatsapp/pendentes-vespera', '/api/whatsapp/pendentes-30min']) {
    const s = await status(r)
    conferir(`${r} continua aberta (nao 401)`, s === 401, false)
  }
  for (const r of ['/api/webhooks/hubla', '/api/webhooks/kiwify']) {
    const s = await status(r, undefined, 'POST', '{}')
    conferir(`${r} continua aberta (nao 401)`, s === 401, false)
  }

  console.log('\n=== COM CRACHA DE TERAPEUTA: so o dela ===')
  const { data: denise } = await c.from('usuarios_sistema')
    .select('session_token,terapeuta_id').eq('tipo', 'terapeuta')
    .ilike('nome', '%denise%').maybeSingle()
  const crachaDenise = (denise as { session_token: string | null } | null)?.session_token
  if (!crachaDenise) {
    console.log('PULADO | a Denise precisa ter entrado uma vez para existir cracha dela')
  } else {
    const r = await fetch(`${BASE}/api/terapeutas/dashboard?datePreset=all&terapeutaId=all`,
      { headers: { [CABECALHO]: crachaDenise } })
    conferir('dashboard com cracha da Denise responde', r.status, 200)
    const j = await r.json() as { por_terapeuta?: { nome: string }[] }
    const nomes = (j.por_terapeuta ?? []).map(t => t.nome)
    conferir('pedindo terapeutaId=all, vem SO a Denise', nomes.length, 1)
    conferir('e o nome e o dela', (nomes[0] ?? '').toLowerCase().includes('denise'), true)
  }

  console.log(`\n${falhas === 0 ? 'TUDO PROVADO' : `${falhas} FALHA(S)`}\n`)
  process.exit(falhas === 0 ? 0 : 1)
}
main()
```

- [ ] **Passo 2: acrescentar o script ao `package.json`**

Na seção `"scripts"`, depois de `"mutacao"`:

```json
    "provar-acesso": "tsx scripts/provar-acesso.ts"
```

- [ ] **Passo 3: rodar a prova**

```bash
npm run dev > /tmp/dev.log 2>&1 &
until grep -q "Ready in" /tmp/dev.log; do sleep 1; done
npm run provar-acesso
```

Esperado nesta altura: as provas de "sem crachá" passam (401), as de rota aberta
passam, e a de terapeuta ainda **falha** - a regra dela só entra na Tarefa 9.

- [ ] **Passo 4: commit**

```bash
git add scripts/provar-acesso.ts package.json
git commit -m "test: prova de acesso executavel, que chama e confere a resposta"
```

---

## FASE 4 - as rotas usam a identidade

### Tarefa 8: `lib/identidade-da-chamada.ts`, as regras

**Arquivos:**
- Criar: `lib/identidade-da-chamada.ts`
- Criar: `lib/identidade-da-chamada.test.ts`

**Interfaces:**
- Consome: os cabeçalhos que a Tarefa 6 escreve.
- Produz: `type Identidade`, `lerIdentidade(req: Request): Identidade | null`,
  `terapeutaIdQueValeu(id: Identidade, pedido: string | null): string`,
  `podeAdministrar(id: Identidade): boolean`,
  `deveEsconderDivisaoDeSocios(id: Identidade): boolean`.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// lib/identidade-da-chamada.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerIdentidade, terapeutaIdQueValeu, podeAdministrar, deveEsconderDivisaoDeSocios,
  type Identidade,
} from './identidade-da-chamada'

import { CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'

const req = (cabecalhos: Record<string, string>) =>
  new Request('https://x/api/y', { headers: cabecalhos })

test('o teste usa os MESMOS nomes de cabecalho que o middleware escreve', () => {
  // Trava a ligacao entre os dois lados. Sem isto, o teste poderia passar com
  // um nome que o middleware nao escreve, e a identidade sumiria em producao.
  assert.equal(CABECALHOS_DA_IDENTIDADE.tipo, 'x-spr-quem-tipo')
  assert.equal(CABECALHOS_DA_IDENTIDADE.id, 'x-spr-quem-id')
  assert.equal(CABECALHOS_DA_IDENTIDADE.email, 'x-spr-quem-email')
  assert.equal(CABECALHOS_DA_IDENTIDADE.terapeutaId, 'x-spr-quem-terapeuta-id')
})

const ID_DENISE = 'c3d598b0-2e43-4376-9492-9176169befe5'
const ID_PEDRO = 'f5b18738-fe04-43e0-a6ac-d15768cf196c'

const terapeuta = (terapeutaId: string): Identidade =>
  ({ area: 'sistema', papel: 'terapeuta', id: 'u1', email: 'a@b.c', terapeutaId })
const comercial: Identidade = { area: 'sistema', papel: 'comercial', id: 'u2', email: 'a@b.c', terapeutaId: null }
const adminSistema: Identidade = { area: 'sistema', papel: 'admin', id: 'u3', email: 'a@b.c', terapeutaId: null }
const adminDre: Identidade = { area: 'dashboard', papel: 'admin', id: 'u4', email: 'a@b.c', terapeutaId: null }
const socio: Identidade = { area: 'dashboard', papel: 'socio', id: 'u5', email: 'a@b.c', terapeutaId: null }

test('sem os cabecalhos do middleware, nao ha identidade', () => {
  assert.equal(lerIdentidade(req({})), null)
})

test('le a identidade que o middleware escreveu', () => {
  const i = lerIdentidade(req({
    'x-spr-quem-tipo': 'sistema:terapeuta',
    'x-spr-quem-id': 'u1',
    'x-spr-quem-email': 'denise@x.com',
    'x-spr-quem-terapeuta-id': ID_DENISE,
  }))
  assert.deepEqual(i, { area: 'sistema', papel: 'terapeuta', id: 'u1', email: 'denise@x.com', terapeutaId: ID_DENISE })
})

test('CRITICO: terapeuta pedindo "all" recebe o proprio, nao todos', () => {
  // E o furo que motivou o trabalho inteiro: hoje a rota obedece o parametro do
  // cliente, e a Denise pedindo all recebe o faturamento do Pedro.
  assert.equal(terapeutaIdQueValeu(terapeuta(ID_DENISE), 'all'), ID_DENISE)
})

test('CRITICO: terapeuta pedindo o id de OUTRA recebe o proprio', () => {
  assert.equal(terapeutaIdQueValeu(terapeuta(ID_DENISE), ID_PEDRO), ID_DENISE)
})

test('terapeuta sem pedir nada recebe o proprio', () => {
  assert.equal(terapeutaIdQueValeu(terapeuta(ID_DENISE), null), ID_DENISE)
})

test('admin e comercial continuam podendo pedir qualquer um, inclusive all', () => {
  // O comercial agenda para as duas terapeutas: restringir aqui quebraria o dia
  // a dia dele.
  assert.equal(terapeutaIdQueValeu(adminSistema, 'all'), 'all')
  assert.equal(terapeutaIdQueValeu(comercial, ID_PEDRO), ID_PEDRO)
  assert.equal(terapeutaIdQueValeu(adminDre, 'all'), 'all')
})

test('o socio do DRE nao e restringido no modulo de terapeutas', () => {
  // Decisao do usuario: ele fica exatamente com a visualizacao de hoje.
  assert.equal(terapeutaIdQueValeu(socio, 'all'), 'all')
})

test('so admin administra: comercial e terapeuta NAO', () => {
  assert.equal(podeAdministrar(adminSistema), true)
  assert.equal(podeAdministrar(adminDre), true)
  assert.equal(podeAdministrar(comercial), false)
  assert.equal(podeAdministrar(terapeuta(ID_DENISE)), false)
  assert.equal(podeAdministrar(socio), false)
})

test('a divisao entre socios some SO para o socio', () => {
  assert.equal(deveEsconderDivisaoDeSocios(socio), true)
  assert.equal(deveEsconderDivisaoDeSocios(adminDre), false)
  assert.equal(deveEsconderDivisaoDeSocios(adminSistema), false)
  assert.equal(deveEsconderDivisaoDeSocios(comercial), false)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/identidade-da-chamada.test.ts`
Esperado: FALHA com "Cannot find module './identidade-da-chamada'".

- [ ] **Passo 3: escrever a implementação**

```ts
// lib/identidade-da-chamada.ts
//
// QUEM esta chamando, e o que essa pessoa pode.
//
// A identidade vem dos cabecalhos que o `middleware.ts` escreve - e que ele
// APAGA antes de escrever, justamente para ninguem forjar mandando o cabecalho
// direto.
//
// As regras vivem aqui, puras e com teste proprio, e nao espalhadas nas rotas:
// espalhadas, cada rota vira uma chance de escrever a regra um pouco diferente.

import { CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'

export type Identidade = {
  /** `sistema` = modulo de terapeutas; `dashboard` = DRE financeiro. */
  area: 'sistema' | 'dashboard'
  /** `sistema`: admin | comercial | terapeuta. `dashboard`: admin | socio | gestor | financeiro. */
  papel: string
  id: string
  email: string
  /** So terapeuta tem. E o `terapeuta_id` dela. */
  terapeutaId: string | null
}

export function lerIdentidade(req: Request): Identidade | null {
  // Os nomes vem da constante, nunca escritos a mao aqui: o middleware escreve
  // e esta funcao le, e se os dois textos divergirem a identidade some sem
  // erro nenhum - toda rota passaria a recusar, ou pior, a nao restringir.
  const tipo = req.headers.get(CABECALHOS_DA_IDENTIDADE.tipo)
  const id = req.headers.get(CABECALHOS_DA_IDENTIDADE.id)
  if (!tipo || !id) return null
  const [area, papel] = tipo.split(':')
  if (area !== 'sistema' && area !== 'dashboard') return null
  if (!papel) return null
  return {
    area,
    papel,
    id,
    email: req.headers.get(CABECALHOS_DA_IDENTIDADE.email) ?? '',
    terapeutaId: req.headers.get(CABECALHOS_DA_IDENTIDADE.terapeutaId),
  }
}

/**
 * O `terapeuta_id` que vale para esta chamada.
 *
 * Para TERAPEUTA, o parametro do cliente e ignorado: vale o dela. E o furo que
 * motivou o trabalho - hoje a rota obedece o parametro, e a Denise pedindo
 * `all` recebe o faturamento do Pedro.
 *
 * Para todos os outros o parametro vale. O comercial agenda para as duas
 * terapeutas, e o socio do DRE fica com a visualizacao de hoje por decisao do
 * usuario.
 */
export function terapeutaIdQueValeu(id: Identidade, pedido: string | null): string {
  if (id.area === 'sistema' && id.papel === 'terapeuta' && id.terapeutaId) return id.terapeutaId
  return pedido ?? 'all'
}

/** Criar usuario, trocar senha, mudar percentual de comissao. So admin. */
export function podeAdministrar(id: Identidade): boolean {
  return id.papel === 'admin'
}

/** A divisao entre socios some para o socio - a regra ja existia na tela. */
export function deveEsconderDivisaoDeSocios(id: Identidade): boolean {
  return id.area === 'dashboard' && id.papel === 'socio'
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test lib/identidade-da-chamada.test.ts`
Esperado: PASSA, 9 testes.

- [ ] **Passo 5: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add lib/identidade-da-chamada.ts lib/identidade-da-chamada.test.ts
git commit -m "feat: as regras de quem pode o que, puras e testadas"
```

---

### Tarefa 9: a rota do dashboard usa a identidade

**Arquivos:**
- Modificar: `app/api/terapeutas/dashboard/route.ts:139`

**Interfaces:**
- Consome: `lerIdentidade` e `terapeutaIdQueValeu` de `lib/identidade-da-chamada.ts`.

- [ ] **Passo 1: trocar a linha que confia no cliente**

Em `app/api/terapeutas/dashboard/route.ts`, trocar:

```ts
    const terapeutaId = searchParams.get('terapeutaId') ?? 'all'
```

por:

```ts
    // NAO confia no parametro: quem manda e a identidade que o middleware
    // conferiu. Terapeuta recebe o proprio `terapeuta_id`, sempre - antes disto,
    // pedindo `terapeutaId=all` ela recebia o faturamento das duas.
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    const terapeutaId = terapeutaIdQueValeu(quem, searchParams.get('terapeutaId'))
```

com o import no topo:

```ts
import { lerIdentidade, terapeutaIdQueValeu } from '@/lib/identidade-da-chamada'
```

- [ ] **Passo 2: provar rodando**

```bash
npm run dev > /tmp/dev.log 2>&1 &
until grep -q "Ready in" /tmp/dev.log; do sleep 1; done
npm run provar-acesso
```

Esperado: a prova "pedindo terapeutaId=all, vem SO a Denise" passa agora.

**Se a Denise nunca entrou no sistema**, a prova pula esse bloco. Nesse caso,
pedir ao usuário que ela entre uma vez, ou gerar um crachá para ela direto no
banco só para a prova, e apagar depois.

- [ ] **Passo 3: conferir que o admin continua vendo as duas**

```bash
npx tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data } = await c.from('usuarios_sistema').select('session_token').eq('tipo','admin').maybeSingle()
const t = (data as any)?.session_token
if (!t) { console.log('admin sem cracha: entre uma vez no sistema'); process.exit(0) }
const r = await fetch('http://localhost:3000/api/terapeutas/dashboard?datePreset=all&terapeutaId=all', { headers: { 'x-spr-cracha': t } })
const j = await r.json()
console.log('HTTP', r.status, '| terapeutas devolvidos:', (j.por_terapeuta ?? []).length, '(esperado 2)')
"
```

Esperado: `HTTP 200 | terapeutas devolvidos: 2`.

- [ ] **Passo 4: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add app/api/terapeutas/dashboard/route.ts
git commit -m "fix: a rota do dashboard decide pela identidade, nao pelo parametro"
```

---

### Tarefa 10: `GET /api/closings` esconde a divisão do sócio

**Arquivos:**
- Modificar: `app/api/closings/route.ts:4-13`

**Interfaces:**
- Consome: `lerIdentidade` e `deveEsconderDivisaoDeSocios` de
  `lib/identidade-da-chamada.ts`.

- [ ] **Passo 1: escrever o teste da função que limpa**

Acrescentar em `lib/identidade-da-chamada.test.ts`:

```ts
import { semDivisaoDeSocios } from './identidade-da-chamada'

test('semDivisaoDeSocios tira os valores e mantem o resto do fechamento', () => {
  const fechamentos = [{
    id: 'close_1', lucroReal: 5863.44, faturamentoBruto: 90000,
    socios: [
      { nome: 'SPR DIGITAL LTDA', valor: 2931.72, repasse_final: 2931.72 },
      { nome: 'Pedro Roncada', valor: 2931.72, repasse_final: 2931.72 },
    ],
  }]
  const limpo = semDivisaoDeSocios(fechamentos)
  assert.equal(limpo[0].id, 'close_1', 'o resto do fechamento continua la')
  assert.equal(limpo[0].lucroReal, 5863.44, 'o lucro real ele ve - so a divisao some')
  assert.deepEqual(limpo[0].socios, [], 'a divisao entre socios sai')
})

test('semDivisaoDeSocios nao quebra com fechamento sem socios', () => {
  assert.deepEqual(semDivisaoDeSocios([{ id: 'x' }]), [{ id: 'x', socios: [] }])
})

test('semDivisaoDeSocios NAO altera o original', () => {
  // Se alterasse, o mesmo objeto voltaria vazio para o admin na chamada seguinte.
  const original = [{ id: 'c', socios: [{ nome: 'A', valor: 1 }] }]
  semDivisaoDeSocios(original)
  assert.equal(original[0].socios.length, 1)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/identidade-da-chamada.test.ts`
Esperado: FALHA, `semDivisaoDeSocios` não existe.

- [ ] **Passo 3: escrever a função**

Acrescentar em `lib/identidade-da-chamada.ts`:

```ts
/**
 * O fechamento sem a divisao entre socios.
 *
 * Copia em vez de alterar: mexer no objeto original faria o proximo pedido, de
 * um admin, receber a lista ja esvaziada.
 */
export function semDivisaoDeSocios<T extends { socios?: unknown[] }>(fechamentos: T[]): T[] {
  return fechamentos.map(f => ({ ...f, socios: [] }))
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test lib/identidade-da-chamada.test.ts`
Esperado: PASSA, 12 testes.

- [ ] **Passo 5: ligar na rota**

Em `app/api/closings/route.ts`, no `GET`:

```ts
    const closings = await getClosings(projectId)
    // A tela ja escondia a divisao do socio (`podeVerRepasse` em
    // app/fechamentos/page.tsx:240). Esconder so na tela nao adianta: o dado
    // vinha inteiro por aqui, e bastava abrir o endereco no navegador.
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    return NextResponse.json(deveEsconderDivisaoDeSocios(quem) ? semDivisaoDeSocios(closings) : closings)
```

com o import:

```ts
import { lerIdentidade, deveEsconderDivisaoDeSocios, semDivisaoDeSocios } from '@/lib/identidade-da-chamada'
```

- [ ] **Passo 6: provar rodando, com o crachá do sócio**

```bash
npx tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data } = await c.from('usuarios_dashboard').select('session_token,nome').eq('role','socio').maybeSingle()
const t = (data as any)?.session_token
if (!t) { console.log('socio sem cracha: pedir para ele entrar uma vez'); process.exit(0) }
const r = await fetch('http://localhost:3000/api/closings?projectId=proj_1', { headers: { 'x-spr-cracha': t } })
const j = await r.json()
console.log('HTTP', r.status, '| fechamentos:', j.length, '| socios no primeiro:', (j[0]?.socios ?? []).length, '(esperado 0)')
console.log('lucro real ainda visivel:', j[0]?.lucroReal)
"
```

Esperado: `socios no primeiro: 0` e o lucro real ainda visível.

- [ ] **Passo 7: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add app/api/closings/route.ts lib/identidade-da-chamada.ts lib/identidade-da-chamada.test.ts
git commit -m "fix: a divisao entre socios some da resposta para o socio, nao so da tela"
```

---

### Tarefa 11: as rotas de administração exigem admin

**Arquivos:**
- Modificar: `app/api/terapeutas/admin/usuarios/route.ts`
- Modificar: `app/api/terapeutas/admin/terapeutas/route.ts`
- Modificar: `app/api/dashboard-usuarios/route.ts`

**Interfaces:**
- Consome: `lerIdentidade` e `podeAdministrar` de `lib/identidade-da-chamada.ts`.

- [ ] **Passo 1: dar `req` aos `GET`, que hoje não recebem**

Verificado em 15/09/2026: nos três arquivos o `GET` é
`export async function GET()`, **sem parâmetro**. Usar `lerIdentidade(req)` ali
não compila. Antes de qualquer outra coisa, trocar as três assinaturas:

```ts
export async function GET(req: NextRequest) {
```

Conferir que `NextRequest` já está importado no topo de cada arquivo (os outros
métodos já usam).

- [ ] **Passo 2: acrescentar a guarda nos três arquivos**

Em CADA método exportado (`GET`, `POST`, `PUT`, `PATCH`) dos três arquivos, como
primeira coisa dentro da função:

```ts
  // Criar usuario, trocar senha e mudar percentual de comissao sao coisas de
  // admin. O menu do comercial ja nao oferece o caminho (components/Header.tsx:34),
  // mas a rota aceitava qualquer chamada - inclusive de quem nunca teve acesso.
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeAdministrar(quem)) {
    return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
  }
```

com o import no topo de cada um:

```ts
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'
```

- [ ] **Passo 3: acrescentar as provas ao `scripts/provar-acesso.ts`**

Antes do `console.log` final:

```ts
  console.log('\n=== COM CRACHA DE COMERCIAL: administracao recusada ===')
  const { data: com } = await c.from('usuarios_sistema')
    .select('session_token,nome').eq('tipo', 'comercial')
    .not('session_token', 'is', null).limit(1).maybeSingle()
  const crachaComercial = (com as { session_token: string | null } | null)?.session_token
  if (!crachaComercial) {
    console.log('PULADO | nenhum comercial entrou ainda, entao nao ha cracha para provar')
  } else {
    conferir('POST admin/usuarios com cracha de comercial',
      await status('/api/terapeutas/admin/usuarios', crachaComercial, 'POST', '{}'), 403)
    conferir('PATCH admin/terapeutas com cracha de comercial',
      await status('/api/terapeutas/admin/terapeutas', crachaComercial, 'PATCH', '{}'), 403)
    conferir('o comercial continua vendo o dashboard',
      await status('/api/terapeutas/dashboard', crachaComercial), 200)
  }
```

- [ ] **Passo 4: rodar a prova completa**

```bash
npm run dev > /tmp/dev.log 2>&1 &
until grep -q "Ready in" /tmp/dev.log; do sleep 1; done
npm run provar-acesso
```

Esperado: `TUDO PROVADO`, sem nenhuma falha.

- [ ] **Passo 5: a conferência final, obrigatória antes de publicar**

As duas restrições globais, provadas:

```bash
# 1. As sete rotas abertas continuam abertas
npm run provar-acesso | grep -A 6 "ROTAS ABERTAS"

# 2. O socio ve tudo igual: entrar no sistema como socio e conferir na tela que
#    nada mudou de aparencia, e que a Divisao entre Socios continua escondida.
```

- [ ] **Passo 6: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight && npm run build
git add app/api/terapeutas/admin/usuarios/route.ts app/api/terapeutas/admin/terapeutas/route.ts app/api/dashboard-usuarios/route.ts scripts/provar-acesso.ts
git commit -m "fix: as rotas de administracao passam a exigir admin"
```

---

### Tarefa 12: as rotas de dinheiro do DRE exigem quem pode editar

**Achado na segunda passada da revisão.** A spec diz, na tabela da seção 5, que
o sócio *"não edita caixa, DRE nem fechamento"* - e nenhuma tarefa fazia isso
valer. Sem esta tarefa, ele continua podendo criar fechamento e apagar custo
chamando a rota, mesmo com todo o resto pronto.

**Arquivos:**
- Modificar: `lib/identidade-da-chamada.ts` e `lib/identidade-da-chamada.test.ts`
- Modificar: `app/api/closings/route.ts` (POST)
- Modificar: `app/api/costs/route.ts` (POST, PUT, DELETE)
- Modificar: `app/api/cashflow/route.ts` (POST)

**Interfaces:**
- Produz: `podeEditarFechamento(id)`, `podeEditarCaixa(id)`, `podeEditarCustos(id)`.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `lib/identidade-da-chamada.test.ts`:

```ts
import { podeEditarFechamento, podeEditarCaixa, podeEditarCustos } from './identidade-da-chamada'

const financeiro: Identidade = { area: 'dashboard', papel: 'financeiro', id: 'u6', email: 'a@b.c', terapeutaId: null }

test('as regras de edicao copiam EXATAMENTE o que a tela ja faz hoje', () => {
  // app/fechamentos/page.tsx:237 e app/caixa/page.tsx:55 -> canEdit = admin
  assert.equal(podeEditarFechamento(adminDre), true)
  assert.equal(podeEditarFechamento(socio), false)
  assert.equal(podeEditarCaixa(adminDre), true)
  assert.equal(podeEditarCaixa(socio), false)
  assert.equal(podeEditarCaixa(financeiro), false, 'a tela do caixa so libera admin')

  // app/dre/page.tsx:61 -> canEdit = admin || financeiro
  assert.equal(podeEditarCustos(adminDre), true)
  assert.equal(podeEditarCustos(financeiro), true)
  assert.equal(podeEditarCustos(socio), false)
})

test('usuario do modulo de terapeutas nao edita dinheiro do DRE', () => {
  // Sao duas areas separadas. Comercial nao mexe em fechamento da empresa.
  assert.equal(podeEditarFechamento(comercial), false)
  assert.equal(podeEditarCaixa(comercial), false)
  assert.equal(podeEditarCustos(terapeuta(ID_DENISE)), false)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/identidade-da-chamada.test.ts`
Esperado: FALHA, as três funções não existem.

- [ ] **Passo 3: escrever as regras**

Acrescentar em `lib/identidade-da-chamada.ts`:

```ts
/**
 * As tres regras abaixo COPIAM o que as telas ja fazem, sem inventar nada:
 *
 *   app/fechamentos/page.tsx:237  canEdit = role === 'admin'
 *   app/caixa/page.tsx:55         canEdit = role === 'admin'
 *   app/dre/page.tsx:61           canEdit = role === 'admin' || 'financeiro'
 *
 * Todas exigem area `dashboard`: o DRE e o modulo de terapeutas sao sistemas
 * separados, e comercial nao mexe em dinheiro da empresa.
 */
const ehDoDre = (id: Identidade) => id.area === 'dashboard'

export function podeEditarFechamento(id: Identidade): boolean {
  return ehDoDre(id) && id.papel === 'admin'
}

export function podeEditarCaixa(id: Identidade): boolean {
  return ehDoDre(id) && id.papel === 'admin'
}

export function podeEditarCustos(id: Identidade): boolean {
  return ehDoDre(id) && (id.papel === 'admin' || id.papel === 'financeiro')
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test lib/identidade-da-chamada.test.ts`
Esperado: PASSA.

- [ ] **Passo 5: ligar nas quatro rotas**

Em cada método de escrita, como primeira coisa dentro da função. Exemplo do
`POST` de `app/api/closings/route.ts`:

```ts
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeEditarFechamento(quem)) {
    return NextResponse.json({ error: 'Você não tem permissão para confirmar fechamento.' }, { status: 403 })
  }
```

Trocando a função e a frase conforme a rota: `podeEditarCaixa` em
`cashflow` POST ("lançar no caixa"), e `podeEditarCustos` em `costs`
POST/PUT/DELETE ("alterar custos").

**Conferir a assinatura de cada método antes:** se algum não receber `req`,
acrescentar `req: NextRequest` como na Tarefa 11.

- [ ] **Passo 6: acrescentar a prova**

Em `scripts/provar-acesso.ts`, antes do `console.log` final:

```ts
  console.log('\n=== COM CRACHA DE SOCIO: le tudo, nao edita dinheiro ===')
  const { data: soc } = await c.from('usuarios_dashboard')
    .select('session_token').eq('role', 'socio').not('session_token', 'is', null).maybeSingle()
  const crachaSocio = (soc as { session_token: string | null } | null)?.session_token
  if (!crachaSocio) {
    console.log('PULADO | o socio precisa ter entrado uma vez')
  } else {
    conferir('socio LE fechamentos', await status('/api/closings?projectId=proj_1', crachaSocio), 200)
    conferir('socio NAO cria fechamento',
      await status('/api/closings', crachaSocio, 'POST', '{}'), 403)
    conferir('socio NAO lanca no caixa',
      await status('/api/cashflow', crachaSocio, 'POST', '{}'), 403)
    conferir('socio NAO apaga custo',
      await status('/api/costs', crachaSocio, 'DELETE', '{}'), 403)
  }
```

- [ ] **Passo 7: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight
git add lib/identidade-da-chamada.ts lib/identidade-da-chamada.test.ts app/api/closings/route.ts app/api/costs/route.ts app/api/cashflow/route.ts scripts/provar-acesso.ts
git commit -m "fix: as rotas de dinheiro do DRE exigem quem pode editar"
```

---

### Tarefa 13: a terapeuta só age nas próprias sessões

**Achado na segunda passada da revisão.** A spec diz que a terapeuta fica no
próprio `terapeuta_id` *"para ver e para agir"*. A Tarefa 9 resolveu o ver. O
agir não tinha tarefa nenhuma: a Denise, com o crachá dela, ainda conseguiria
remarcar ou concluir uma sessão do Pedro chamando a rota com o `sessao_id` dele.

**Arquivos:**
- Criar: `lib/sessao-do-terapeuta.ts`
- Criar: `lib/sessao-do-terapeuta.test.ts`
- Modificar: `app/api/terapeutas/sessoes/remarcar/route.ts`,
  `app/api/terapeutas/sessoes/confirmar/route.ts`,
  `app/api/terapeutas/sessoes/route.ts` (PATCH)

**Interfaces:**
- Produz: `podeAgirNaSessao(quem: Identidade, terapeutaIdDaSessao: string | null): boolean`.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// lib/sessao-do-terapeuta.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { podeAgirNaSessao } from './sessao-do-terapeuta'
import type { Identidade } from './identidade-da-chamada'

const ID_DENISE = 'c3d598b0-2e43-4376-9492-9176169befe5'
const ID_PEDRO = 'f5b18738-fe04-43e0-a6ac-d15768cf196c'

const denise: Identidade = { area: 'sistema', papel: 'terapeuta', id: 'u1', email: 'd@x.com', terapeutaId: ID_DENISE }
const comercial: Identidade = { area: 'sistema', papel: 'comercial', id: 'u2', email: 'c@x.com', terapeutaId: null }
const adminSistema: Identidade = { area: 'sistema', papel: 'admin', id: 'u3', email: 'a@x.com', terapeutaId: null }
const socio: Identidade = { area: 'dashboard', papel: 'socio', id: 'u5', email: 's@x.com', terapeutaId: null }

test('a terapeuta age na PROPRIA sessao', () => {
  assert.equal(podeAgirNaSessao(denise, ID_DENISE), true)
})

test('CRITICO: a terapeuta NAO age na sessao de outra', () => {
  assert.equal(podeAgirNaSessao(denise, ID_PEDRO), false)
})

test('comercial e admin agem em qualquer sessao', () => {
  // O comercial agenda e remarca para as duas: e o trabalho dele.
  assert.equal(podeAgirNaSessao(comercial, ID_PEDRO), true)
  assert.equal(podeAgirNaSessao(adminSistema, ID_DENISE), true)
})

test('o socio do DRE nao e restringido - fica como hoje', () => {
  assert.equal(podeAgirNaSessao(socio, ID_PEDRO), true)
})

test('sessao sem terapeuta definido NAO e liberada para terapeuta', () => {
  // Dado incompleto nao pode virar porta: na duvida, recusa.
  assert.equal(podeAgirNaSessao(denise, null), false)
  assert.equal(podeAgirNaSessao(comercial, null), true, 'para o comercial segue liberado')
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test lib/sessao-do-terapeuta.test.ts`
Esperado: FALHA com "Cannot find module './sessao-do-terapeuta'".

- [ ] **Passo 3: escrever a implementação**

```ts
// lib/sessao-do-terapeuta.ts
import type { Identidade } from './identidade-da-chamada'

/**
 * Esta pessoa pode agir NESTA sessao?
 *
 * So restringe TERAPEUTA. Comercial e admin agendam e remarcam para as duas -
 * e o trabalho deles - e o socio do DRE fica com o acesso de hoje, por decisao
 * do usuario.
 *
 * Sessao sem `terapeuta_id` definido NAO libera terapeuta: dado incompleto nao
 * pode virar porta.
 */
export function podeAgirNaSessao(quem: Identidade, terapeutaIdDaSessao: string | null): boolean {
  if (quem.area !== 'sistema' || quem.papel !== 'terapeuta') return true
  if (!quem.terapeutaId || !terapeutaIdDaSessao) return false
  return quem.terapeutaId === terapeutaIdDaSessao
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test lib/sessao-do-terapeuta.test.ts`
Esperado: PASSA, 5 testes.

- [ ] **Passo 5: ligar nas três rotas de ação**

Em cada uma, depois de a rota já ter buscado a sessão no banco (todas buscam,
para validar) e antes de qualquer escrita:

```ts
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeAgirNaSessao(quem, (sessao as { terapeuta_id: string | null }).terapeuta_id)) {
    return NextResponse.json({ error: 'Esta sessão não é sua.' }, { status: 403 })
  }
```

**Conferir, em cada rota, que o `select` da sessão traz `terapeuta_id`.** Se não
trouxer, acrescentar ao `select` - sem o campo, a guarda recebe `undefined` e
recusa toda ação da terapeuta.

- [ ] **Passo 6: provar rodando**

Em `scripts/provar-acesso.ts`, antes do `console.log` final:

```ts
  console.log('\n=== COM CRACHA DE TERAPEUTA: nao age na sessao de outra ===')
  if (!crachaDenise) {
    console.log('PULADO | a Denise precisa ter entrado uma vez')
  } else {
    const { data: doPedro } = await c.from('sessoes')
      .select('id,terapeuta_id').neq('terapeuta_id', (denise as { terapeuta_id: string }).terapeuta_id)
      .limit(1).maybeSingle()
    const idDoPedro = (doPedro as { id: string } | null)?.id
    if (!idDoPedro) {
      console.log('PULADO | nenhuma sessao de outro terapeuta no banco')
    } else {
      conferir('Denise NAO confirma sessao do Pedro',
        await status('/api/terapeutas/sessoes/confirmar', crachaDenise, 'POST',
          JSON.stringify({ sessao_id: idDoPedro })), 403)
    }
  }
```

**Esta prova não altera nada:** a recusa acontece antes de qualquer escrita. Se
vier 200 em vez de 403, a guarda não está no lugar certo - **e nesse caso uma
sessão real foi alterada**, o que precisa ser desfeito na hora.

- [ ] **Passo 7: rodar tudo e commitar**

```bash
npx tsc --noEmit && npm test && npm run preflight && npm run build
git add lib/sessao-do-terapeuta.ts lib/sessao-do-terapeuta.test.ts app/api/terapeutas/sessoes/remarcar/route.ts app/api/terapeutas/sessoes/confirmar/route.ts app/api/terapeutas/sessoes/route.ts scripts/provar-acesso.ts
git commit -m "fix: a terapeuta so age nas proprias sessoes"
```

---

## Depois do plano

- [ ] Atualizar `spr-digital.md` com um item novo no histórico, na redundância
      que o usuário pede: o que foi provado por execução antes e depois, as
      quatro fases, e as duas restrições.
- [ ] Rodar `npm run mutacao` nos quatro módulos novos (`cracha`,
      `rotas-abertas`, `cracha-no-fetch`, `identidade-da-chamada`) e cobrir o
      que sobreviver.
