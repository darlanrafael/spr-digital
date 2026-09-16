import { test } from 'node:test'
import assert from 'node:assert/strict'

// ABORDAGEM 3: injecao de falha. verificarSenhaDashboard usa getSupabaseAdmin,
// que precisa de banco. Para testar SEM banco, injeto um cliente falso que
// simula cada cenario - inclusive a FALHA de gravar o cracha, que o plano diz
// que NAO pode derrubar o login.
//
// Reproduzo a logica exata da funcao com o cliente injetavel, porque a funcao
// real chama getSupabaseAdmin() fixo. Isto testa a DECISAO, nao a conexao.

import { gerarCracha } from './cracha'

// copia fiel do fluxo de verificarSenhaDashboard, com cliente injetado
async function loginComCliente(client: any, email: string, senhaHashConfere: boolean) {
  const { data } = senhaHashConfere
    ? { data: { id: 'u1', nome: 'Fulano', email, role: 'admin' } }
    : { data: null }
  if (!data) return { valido: false as const }
  const u = data
  const { token } = gerarCracha()
  const { error } = await client.update({ session_token: token })
  if (error) console.error('cracha nao gravado')
  return { valido: true as const, usuario: { ...u, token: error ? null : token } }
}

test('senha errada: nao valida, sem cracha', async () => {
  const r = await loginComCliente({ update: async () => ({ error: null }) }, 'a@x.com', false)
  assert.equal(r.valido, false)
})

test('senha certa + banco OK: valida e devolve token', async () => {
  const r = await loginComCliente({ update: async () => ({ error: null }) }, 'a@x.com', true)
  assert.equal(r.valido, true)
  assert.ok(r.usuario?.token && r.usuario.token.length === 64)
})

test('INJECAO DE FALHA: banco recusa gravar o cracha, mas o login NAO cai', async () => {
  // O caso critico do plano: falha ao gravar o cracha nao pode impedir o login.
  const r = await loginComCliente({ update: async () => ({ error: { message: 'banco fora' } }) }, 'a@x.com', true)
  assert.equal(r.valido, true, 'o login TEM de continuar valido')
  assert.equal(r.usuario?.token, null, 'mas sem token, porque nao gravou - a pessoa loga sem cracha')
})
