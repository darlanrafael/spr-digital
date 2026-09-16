// lib/decisao-do-middleware.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'
import {
  contaEncontrada,
  decidirAcesso,
  construirCabecalhosDeIdentidade,
  type RegistroSistema,
  type RegistroDashboard,
} from './decisao-do-middleware'

// ─────────────────────────── contaEncontrada ───────────────────────────

test('contaEncontrada: nada em nenhuma tabela = null', () => {
  assert.equal(contaEncontrada(null, null), null)
})

test('contaEncontrada: usuarios_sistema mapeia tipo, id, email e terapeutaId', () => {
  const registro: RegistroSistema = {
    id: 'u1', email: 'pedro@x.com', tipo: 'terapeuta',
    terapeuta_id: 'ter-1', session_token_expira_em: '2026-10-01T00:00:00.000Z',
  }
  const achado = contaEncontrada(registro, null)
  assert.deepEqual(achado, {
    conta: { origem: 'sistema', id: 'u1', email: 'pedro@x.com', tipo: 'terapeuta', terapeutaId: 'ter-1' },
    expiraEm: '2026-10-01T00:00:00.000Z',
  })
})

test('contaEncontrada: socio em usuarios_sistema tem terapeutaId null', () => {
  const registro: RegistroSistema = {
    id: 'u2', email: 'socio@x.com', tipo: 'socio',
    terapeuta_id: null, session_token_expira_em: null,
  }
  const achado = contaEncontrada(registro, null)
  assert.equal(achado?.conta.origem, 'sistema')
  assert.equal((achado?.conta as { terapeutaId: string | null }).terapeutaId, null)
})

test('contaEncontrada: usuarios_dashboard mapeia role, id e email, sem terapeutaId', () => {
  const registro: RegistroDashboard = {
    id: 'd1', email: 'admin@x.com', role: 'admin', session_token_expira_em: '2026-10-01T00:00:00.000Z',
  }
  const achado = contaEncontrada(null, registro)
  assert.deepEqual(achado, {
    conta: { origem: 'dashboard', id: 'd1', email: 'admin@x.com', role: 'admin' },
    expiraEm: '2026-10-01T00:00:00.000Z',
  })
  assert.ok(!('terapeutaId' in achado!.conta), 'conta de dashboard nunca tem terapeutaId')
})

test('contaEncontrada: as duas tabelas preenchidas (nao deveria acontecer) prioriza usuarios_sistema', () => {
  const sistema: RegistroSistema = { id: 's', email: 's@x.com', tipo: 'socio', terapeuta_id: null, session_token_expira_em: null }
  const dashboard: RegistroDashboard = { id: 'd', email: 'd@x.com', role: 'admin', session_token_expira_em: null }
  const achado = contaEncontrada(sistema, dashboard)
  assert.equal(achado?.conta.origem, 'sistema')
})

// ─────────────────────────── decidirAcesso ───────────────────────────

test('decidirAcesso: sem achado = recusado sem_cracha', () => {
  assert.deepEqual(decidirAcesso(null, true), { tipo: 'recusado', motivo: 'sem_cracha' })
  // mesmo que "vencido" venha false, sem achado a recusa e por falta de cracha,
  // nao por vencimento - a mensagem certa para quem nunca logou.
  assert.deepEqual(decidirAcesso(null, false), { tipo: 'recusado', motivo: 'sem_cracha' })
})

test('decidirAcesso: achado + vencido = recusado vencido', () => {
  const achado = { conta: { origem: 'dashboard' as const, id: 'd', email: 'd@x.com', role: 'admin' }, expiraEm: '2020-01-01T00:00:00.000Z' }
  assert.deepEqual(decidirAcesso(achado, true), { tipo: 'recusado', motivo: 'vencido' })
})

test('decidirAcesso: achado + nao vencido = autorizado com a conta certa', () => {
  const conta = { origem: 'dashboard' as const, id: 'd', email: 'd@x.com', role: 'admin' }
  const achado = { conta, expiraEm: '2099-01-01T00:00:00.000Z' }
  assert.deepEqual(decidirAcesso(achado, false), { tipo: 'autorizado', conta })
})

// ───────────────────── construirCabecalhosDeIdentidade ─────────────────────
//
// O teste que importa mais do arquivo inteiro: prova que cabecalho forjado
// mandado por quem chama NUNCA sobrevive, mesmo quando a conta real nao tem
// valor para por no lugar (terapeutaId null) - o caso em que "so sobrescrever"
// nao bastaria, porque nao ha com o que sobrescrever.

test('FORJA E APAGADA: dashboard nao escreve terapeutaId, e o forjado desaparece', () => {
  const entrada = new Headers({
    [CABECALHOS_DA_IDENTIDADE.tipo]: 'dashboard:admin',
    [CABECALHOS_DA_IDENTIDADE.id]: 'forjado-id',
    [CABECALHOS_DA_IDENTIDADE.email]: 'forjado@atacante.com',
    [CABECALHOS_DA_IDENTIDADE.terapeutaId]: 'forjado-terapeuta',
  })
  const conta = { origem: 'dashboard' as const, id: 'real-id', email: 'real@x.com', role: 'socio' }
  const saida = construirCabecalhosDeIdentidade(entrada, conta)

  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.tipo), 'dashboard:socio')
  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.id), 'real-id')
  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.email), 'real@x.com')
  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.terapeutaId), null, 'forjado tem de desaparecer, nao so ser sobrescrito')
})

test('FORJA E APAGADA: sistema com terapeutaId real sobrescreve o forjado', () => {
  const entrada = new Headers({
    [CABECALHOS_DA_IDENTIDADE.tipo]: 'sistema:admin',
    [CABECALHOS_DA_IDENTIDADE.id]: 'forjado-id',
    [CABECALHOS_DA_IDENTIDADE.email]: 'forjado@atacante.com',
    [CABECALHOS_DA_IDENTIDADE.terapeutaId]: 'terapeuta-forjado',
  })
  const conta = { origem: 'sistema' as const, id: 'real-id', email: 'pedro@x.com', tipo: 'terapeuta', terapeutaId: 'ter-real' }
  const saida = construirCabecalhosDeIdentidade(entrada, conta)

  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.tipo), 'sistema:terapeuta')
  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.id), 'real-id')
  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.email), 'pedro@x.com')
  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.terapeutaId), 'ter-real')
})

test('FORJA E APAGADA: socio (sistema, sem terapeutaId) apaga o forjado sem repor nada', () => {
  const entrada = new Headers({ [CABECALHOS_DA_IDENTIDADE.terapeutaId]: 'nao-deveria-sobreviver' })
  const conta = { origem: 'sistema' as const, id: 'socio-id', email: 'socio@x.com', tipo: 'socio', terapeutaId: null }
  const saida = construirCabecalhosDeIdentidade(entrada, conta)
  assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.terapeutaId), null)
})

test('cabecalhos que NAO sao de identidade passam intactos', () => {
  const entrada = new Headers({ 'content-type': 'application/json', 'x-outro-cabecalho': 'valor' })
  const conta = { origem: 'dashboard' as const, id: 'd', email: 'd@x.com', role: 'admin' }
  const saida = construirCabecalhosDeIdentidade(entrada, conta)
  assert.equal(saida.get('content-type'), 'application/json')
  assert.equal(saida.get('x-outro-cabecalho'), 'valor')
})

test('a entrada original NAO e mutada - construirCabecalhosDeIdentidade devolve um Headers novo', () => {
  const entrada = new Headers({ [CABECALHOS_DA_IDENTIDADE.tipo]: 'dashboard:admin' })
  const conta = { origem: 'dashboard' as const, id: 'd', email: 'd@x.com', role: 'socio' }
  construirCabecalhosDeIdentidade(entrada, conta)
  assert.equal(entrada.get(CABECALHOS_DA_IDENTIDADE.tipo), 'dashboard:admin', 'objeto de entrada continua com o valor forjado - so a copia foi limpa')
})

test('FUZZING: nenhuma combinacao de forja nos 4 cabecalhos sobrevive, para varias contas', () => {
  const combinacoes = [
    { origem: 'dashboard' as const, id: 'd1', email: 'd1@x.com', role: 'admin' },
    { origem: 'dashboard' as const, id: 'd2', email: 'd2@x.com', role: 'socio' },
    { origem: 'sistema' as const, id: 's1', email: 's1@x.com', tipo: 'terapeuta', terapeutaId: 'ter-9' },
    { origem: 'sistema' as const, id: 's2', email: 's2@x.com', tipo: 'socio', terapeutaId: null },
  ]
  const valoresForjados = ['sistema:admin', 'dashboard:admin', '', 'null', 'undefined', '<script>x</script>']

  for (const conta of combinacoes) {
    for (const forjado of valoresForjados) {
      const entrada = new Headers()
      for (const c of Object.values(CABECALHOS_DA_IDENTIDADE)) entrada.set(c, forjado)
      const saida = construirCabecalhosDeIdentidade(entrada, conta)

      const tipoEsperado = conta.origem === 'sistema' ? `sistema:${conta.tipo}` : `dashboard:${conta.role}`
      assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.tipo), tipoEsperado)
      assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.id), conta.id)
      assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.email), conta.email)
      const terapeutaIdReal = conta.origem === 'sistema' ? conta.terapeutaId : null
      assert.equal(saida.get(CABECALHOS_DA_IDENTIDADE.terapeutaId), terapeutaIdReal)
    }
  }
})
