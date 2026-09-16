// lib/autenticacao-do-middleware.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autenticarPeloCracha, type ClienteDeContas } from './autenticacao-do-middleware'
import { DIAS_DE_VALIDADE, RENOVAR_QUANDO_FALTAR_DIAS } from './cracha'

const AGORA = new Date('2026-09-16T12:00:00.000Z').getTime()
const DIA = 24 * 60 * 60 * 1000
const CRACHA = 'cracha-de-teste-123'

type LinhaFalsa = Record<string, unknown> | null
type ConfigDeTabela = { linha?: LinhaFalsa; erro?: string }

/**
 * Cliente Supabase falso, so com o que `autenticarPeloCracha` usa. Grava toda
 * chamada de `.eq(...)` e `.update(...)` para o teste poder confirmar O QUE
 * foi perguntado ao banco - nao so o que a funcao devolveu. E o jeito de
 * pegar uma regressao como "alguem removeu o `.eq('ativo', true)`": sem
 * gravar as chamadas, o teste so veria o resultado final e não notaria a
 * pergunta errada que levou la.
 */
function criarClienteFalso(config: { usuarios_sistema?: ConfigDeTabela; usuarios_dashboard?: ConfigDeTabela }) {
  const chamadasDeEq: { tabela: string; coluna: string; valor: unknown }[] = []
  const consultas: string[] = []
  const atualizacoes: { tabela: string; valores: Record<string, unknown>; cracha: unknown }[] = []

  function construirSelecao(tabela: string, cfg: ConfigDeTabela | undefined) {
    const builder = {
      eq(coluna: string, valor: unknown) {
        chamadasDeEq.push({ tabela, coluna, valor })
        return builder
      },
      async maybeSingle() {
        consultas.push(tabela)
        if (cfg?.erro) return { data: null, error: { message: cfg.erro } }
        return { data: cfg?.linha ?? null, error: null }
      },
    }
    return builder
  }

  const client: ClienteDeContas = {
    from(tabela: string) {
      return {
        select(_colunas: string) {
          return construirSelecao(tabela, config[tabela as 'usuarios_sistema' | 'usuarios_dashboard'])
        },
        update(valores: Record<string, unknown>) {
          return {
            async eq(_coluna: string, valor: unknown) {
              atualizacoes.push({ tabela, valores, cracha: valor })
              return { error: null }
            },
          }
        },
      }
    },
  }

  return { client, chamadasDeEq, consultas, atualizacoes }
}

// ─────────────────────── o filtro ativo=true e a ordem das tabelas ───────────────────────

test('a consulta a usuarios_sistema pergunta pelo session_token E pelo ativo=true', async () => {
  const { client, chamadasDeEq } = criarClienteFalso({ usuarios_sistema: { linha: null } })
  await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.ok(
    chamadasDeEq.some(c => c.tabela === 'usuarios_sistema' && c.coluna === 'ativo' && c.valor === true),
    'sem este filtro, uma conta DESATIVADA ainda logaria - regressao critica que este teste tem de pegar',
  )
  assert.ok(chamadasDeEq.some(c => c.tabela === 'usuarios_sistema' && c.coluna === 'session_token' && c.valor === CRACHA))
})

test('a consulta a usuarios_dashboard tambem pergunta pelo ativo=true', async () => {
  const { client, chamadasDeEq } = criarClienteFalso({
    usuarios_sistema: { linha: null },
    usuarios_dashboard: { linha: null },
  })
  await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.ok(chamadasDeEq.some(c => c.tabela === 'usuarios_dashboard' && c.coluna === 'ativo' && c.valor === true))
})

test('achando em usuarios_sistema, usuarios_dashboard NUNCA e consultado', async () => {
  const { client, consultas } = criarClienteFalso({
    usuarios_sistema: { linha: { id: 's1', email: 's@x.com', tipo: 'socio', terapeuta_id: null, ativo: true, session_token_expira_em: new Date(AGORA + 60 * DIA).toISOString() } },
  })
  await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(consultas, ['usuarios_sistema'], 'as duas tabelas sao independentes; achar na primeira dispensa a segunda')
})

test('nao achando em usuarios_sistema, consulta usuarios_dashboard - e acha la', async () => {
  const { client, consultas } = criarClienteFalso({
    usuarios_sistema: { linha: null },
    usuarios_dashboard: { linha: { id: 'd1', email: 'd@x.com', role: 'admin', ativo: true, session_token_expira_em: new Date(AGORA + 60 * DIA).toISOString() } },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(consultas, ['usuarios_sistema', 'usuarios_dashboard'])
  assert.equal(r.tipo, 'autorizado')
  assert.equal(r.tipo === 'autorizado' && r.conta.origem, 'dashboard')
})

// ───────────────────────── IMPORTANTE-1: falha de banco != conta inexistente ─────────────────────────

test('IMPORTANTE-1: erro na consulta a usuarios_sistema devolve falha_de_consulta, NUNCA recusado', async () => {
  // O caso do incidente real: 525 da Cloudflare entre Vercel e Supabase.
  // Rotular como "sem_cracha" faria o cliente (cracha-no-fetch.ts) tratar
  // como sessao perdida e deslogar todo mundo num soluco do banco.
  const { client } = criarClienteFalso({ usuarios_sistema: { erro: 'Cloudflare 525: connection reset' } })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(r, { tipo: 'falha_de_consulta' })
})

test('IMPORTANTE-1: erro so na consulta a usuarios_dashboard tambem devolve falha_de_consulta', async () => {
  const { client } = criarClienteFalso({
    usuarios_sistema: { linha: null },
    usuarios_dashboard: { erro: 'timeout' },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(r, { tipo: 'falha_de_consulta' })
})

test('IMPORTANTE-1: SEM erro e conta genuinamente inexistente (data null nas duas) e recusado sem_cracha - nao falha_de_consulta', async () => {
  const { client } = criarClienteFalso({
    usuarios_sistema: { linha: null },
    usuarios_dashboard: { linha: null },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(r, { tipo: 'recusado', motivo: 'sem_cracha' })
})

// ─────────────────────────────── vencimento ───────────────────────────────

test('cracha vencido: recusado vencido (mesmo sem erro nenhum de banco)', async () => {
  const { client } = criarClienteFalso({
    usuarios_sistema: { linha: { id: 's1', email: 's@x.com', tipo: 'socio', terapeuta_id: null, ativo: true, session_token_expira_em: new Date(AGORA - DIA).toISOString() } },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(r, { tipo: 'recusado', motivo: 'vencido' })
})

// ─────────────────────────────── renovacao (janela deslizante) ───────────────────────────────

test('cracha valido e longe do vencimento: autorizado e NAO renova (zero escrita no banco)', async () => {
  const { client, atualizacoes } = criarClienteFalso({
    usuarios_sistema: { linha: { id: 's1', email: 's@x.com', tipo: 'socio', terapeuta_id: null, ativo: true, session_token_expira_em: new Date(AGORA + 20 * DIA).toISOString() } },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.equal(r.tipo, 'autorizado')
  assert.deepEqual(atualizacoes, [], 'escrever no banco a cada chamada seria o problema que a janela deslizante existe para evitar')
})

test('cracha perto do vencimento (usuarios_sistema): autorizado E renova, gravando a nova validade certa', async () => {
  const expiraEm = new Date(AGORA + (RENOVAR_QUANDO_FALTAR_DIAS - 1) * DIA).toISOString()
  const { client, atualizacoes } = criarClienteFalso({
    usuarios_sistema: { linha: { id: 's1', email: 's@x.com', tipo: 'socio', terapeuta_id: null, ativo: true, session_token_expira_em: expiraEm } },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.equal(r.tipo, 'autorizado')
  assert.equal(atualizacoes.length, 1)
  assert.equal(atualizacoes[0].tabela, 'usuarios_sistema')
  assert.equal(atualizacoes[0].cracha, CRACHA)
  assert.equal(atualizacoes[0].valores.session_token_expira_em, new Date(AGORA + DIAS_DE_VALIDADE * DIA).toISOString())
})

test('cracha perto do vencimento (usuarios_dashboard): renova na tabela CERTA, nao na de sistema', async () => {
  const expiraEm = new Date(AGORA + (RENOVAR_QUANDO_FALTAR_DIAS - 1) * DIA).toISOString()
  const { client, atualizacoes } = criarClienteFalso({
    usuarios_sistema: { linha: null },
    usuarios_dashboard: { linha: { id: 'd1', email: 'd@x.com', role: 'admin', ativo: true, session_token_expira_em: expiraEm } },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.equal(r.tipo, 'autorizado')
  assert.equal(atualizacoes.length, 1)
  assert.equal(atualizacoes[0].tabela, 'usuarios_dashboard')
})

test('renovacao EXATAMENTE na fronteira (falta 15 dias): ainda NAO renova - mesma fronteira de lib/cracha.ts', async () => {
  const expiraEm = new Date(AGORA + RENOVAR_QUANDO_FALTAR_DIAS * DIA).toISOString()
  const { client, atualizacoes } = criarClienteFalso({
    usuarios_sistema: { linha: { id: 's1', email: 's@x.com', tipo: 'socio', terapeuta_id: null, ativo: true, session_token_expira_em: expiraEm } },
  })
  await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(atualizacoes, [])
})

test('falha ao GRAVAR a renovacao NAO derruba a autorizacao - a pessoa ja esta autenticada', async () => {
  const expiraEm = new Date(AGORA + (RENOVAR_QUANDO_FALTAR_DIAS - 1) * DIA).toISOString()
  const client: ClienteDeContas = {
    from(tabela: string) {
      return {
        select() {
          return {
            eq() { return this },
            async maybeSingle() {
              if (tabela === 'usuarios_sistema') {
                return { data: { id: 's1', email: 's@x.com', tipo: 'socio', terapeuta_id: null, ativo: true, session_token_expira_em: expiraEm }, error: null }
              }
              return { data: null, error: null }
            },
          }
        },
        update() {
          return { async eq() { return { error: { message: 'banco fora do ar na escrita' } } } }
        },
      }
    },
  }
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.equal(r.tipo, 'autorizado', 'falha ao renovar so significa que tenta de novo na proxima chamada')
})

// ────────────────────────────── conta autorizada tem os dados certos ──────────────────────────────

test('conta de usuarios_sistema autorizada traz tipo, id, email e terapeutaId certos', async () => {
  const { client } = criarClienteFalso({
    usuarios_sistema: { linha: { id: 'ter-1', email: 'pedro@x.com', tipo: 'terapeuta', terapeuta_id: 'ter-1', ativo: true, session_token_expira_em: new Date(AGORA + 20 * DIA).toISOString() } },
  })
  const r = await autenticarPeloCracha(client, CRACHA, AGORA)
  assert.deepEqual(r, {
    tipo: 'autorizado',
    conta: { origem: 'sistema', id: 'ter-1', email: 'pedro@x.com', tipo: 'terapeuta', terapeutaId: 'ter-1' },
  })
})
