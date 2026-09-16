// scripts/provar-acesso.ts
//
// PROVA DE ACESSO: faz as chamadas de verdade e confere a resposta.
//
// Existe porque teste que le codigo nao prova acesso. Em 15/09/2026 quatro
// afirmacoes tiradas de leitura de codigo estavam erradas, e todas as que
// sairam de execucao estavam certas.
//
// Roda contra o servidor local. NAO cria, NAO altera e NAO apaga nada: onde
// precisa provar rota de escrita, manda corpo invalido de proposito - se a
// resposta for 400 de validacao em vez de 401, esta provado que nao ha guarda,
// e nada foi gravado. Isso vale tanto rodando contra producao (.env.local, o
// padrao) quanto contra o espelho de teste (env sobrepostas na hora de chamar).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE_DA_PROVA ?? 'http://localhost:3000'
const CABECALHO = 'x-spr-cracha'
// Segredo compartilhado das 3 rotas de cron do WhatsApp (verificarSecretCron
// em lib/whatsapp-pendentes.ts). Nao tem relacao com qual banco esta por
// tras do servidor - e o mesmo segredo em producao e no espelho.
const SEGREDO_CRON = process.env.WHATSAPP_CRON_SECRET

let falhas = 0
let pulados = 0

function conferir(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} | ${nome} | esperado ${esperado}, obtido ${obtido}`)
}

/**
 * Prova que nao pode rodar agora.
 *
 * Contada de proposito: sem isto, a saida diria "TUDO PROVADO" tendo pulado
 * justamente a prova que importa, e o `exit 0` viraria um selo falso.
 */
function pular(nome: string, porque: string) {
  pulados++
  console.log(`PULADO | ${nome} | ${porque}`)
}

async function status(
  caminho: string,
  cracha?: string,
  metodo = 'GET',
  corpo?: string,
  extra?: Record<string, string>,
): Promise<number> {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(cracha ? { [CABECALHO]: cracha } : {}),
      ...(extra ?? {}),
    },
    ...(corpo ? { body: corpo } : {}),
  })
  return r.status
}

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('\n=== SEM CRACHA: rotas fechadas tem de recusar (401) ===')
  for (const r of ['/api/terapeutas/dashboard', '/api/closings', '/api/sales', '/api/costs', '/api/cashflow']) {
    conferir(`${r} sem cracha`, await status(r), 401)
  }
  conferir('POST /api/terapeutas/admin/usuarios sem cracha',
    await status('/api/terapeutas/admin/usuarios', undefined, 'POST', '{}'), 401)

  console.log('\n=== AS SETE ROTAS ABERTAS: nao podem recusar por falta de cracha ===')

  // Hubla e Kiwify: nenhum segredo de webhook esta configurado neste ambiente
  // (HUBLA_WEBHOOK_SECRET / KIWIFY_WEBHOOK_TOKEN ausentes), entao os dois
  // aceitam qualquer corpo. Corpo '{}' cai no ramo "sem campo event/order
  // reconhecido" - responde 200 e no maximo grava uma linha de LOG de
  // webhook (nao uma venda). O que importa aqui e so confirmar que NAO e o
  // middleware quem bloqueia por falta de cracha.
  for (const r of ['/api/webhooks/hubla', '/api/webhooks/kiwify']) {
    const s = await status(r, undefined, 'POST', '{}')
    conferir(`${r} continua aberta (nao 401)`, s === 401, false)
  }

  // As 3 rotas de cron (pendentes-vespera, pendentes-30min, marcar-enviado)
  // tem GUARDA PROPRIA (x-whatsapp-cron-secret), separada do cracha. Sem o
  // segredo elas mesmas devolvem 401 - o que pareceria "bloqueada" sem provar
  // nada sobre o middleware. Por isso a prova manda o segredo real (lido do
  // .env.local, o mesmo dos dois lados) e so confere que a rota nao esta
  // fechada por falta de CRACHA.
  if (!SEGREDO_CRON) {
    pular('as 3 rotas de cron do WhatsApp continuam abertas',
      'WHATSAPP_CRON_SECRET nao esta definido neste ambiente - sem ele nao da para separar "bloqueado pelo middleware" de "bloqueado pela guarda propria da rota"')
  } else {
    for (const r of ['/api/whatsapp/pendentes-vespera', '/api/whatsapp/pendentes-30min']) {
      const s = await status(r, undefined, 'GET', undefined, { 'x-whatsapp-cron-secret': SEGREDO_CRON })
      conferir(`${r} continua aberta (nao 401)`, s === 401, false)
    }
    // Corpo sem sessao_id/tipo: a rota recusa na validacao (400) antes de
    // gravar qualquer coisa.
    const s = await status('/api/whatsapp/marcar-enviado', undefined, 'POST', '{}', { 'x-whatsapp-cron-secret': SEGREDO_CRON })
    conferir('/api/whatsapp/marcar-enviado continua aberta (nao 401)', s === 401, false)
  }

  // Os dois logins: corpo sem email/senha cai na validacao (400) antes de
  // qualquer consulta - nada e lido nem gravado.
  for (const r of ['/api/dashboard-usuarios/login', '/api/terapeutas/login']) {
    const s = await status(r, undefined, 'POST', '{}')
    conferir(`${r} continua aberta (nao 401)`, s === 401, false)
  }

  console.log('\n=== CRACHA VALIDO: tem de passar pelo middleware ===')

  // Admin do DRE (usuarios_dashboard). O login nao devolve o cracha no corpo
  // da resposta (app/api/dashboard-usuarios/login/route.ts so devolve
  // email/name/role) - por isso o cracha e lido direto do banco, do mesmo
  // jeito que o proprio middleware o consultaria.
  const loginAdmin = await status('/api/dashboard-usuarios/login', undefined, 'POST',
    JSON.stringify({ email: 'admindre-teste@espelho.local', senha: 'teste123' }))
  conferir('login do admin de teste responde 200', loginAdmin, 200)

  const { data: admin } = await c.from('usuarios_dashboard')
    .select('session_token').eq('email', 'admindre-teste@espelho.local').maybeSingle()
  const crachaAdmin = (admin as { session_token: string | null } | null)?.session_token
  if (!crachaAdmin) {
    pular('rota fechada com cracha de admin', 'o login nao gravou session_token - ver lib/dashboard-auth.ts')
  } else {
    const s = await status('/api/closings', crachaAdmin)
    conferir('/api/closings com cracha de admin nao recusa', s === 401, false)
  }

  // Terapeuta (usuarios_sistema). Este login JA devolve o cracha no proprio
  // corpo da resposta (app/api/terapeutas/login/route.ts), sem precisar
  // consultar o banco à parte.
  const rLoginTerapeuta = await fetch(`${BASE}/api/terapeutas/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'terapeuta-teste@espelho.local', senha: 'teste123' }),
  })
  conferir('login do terapeuta de teste responde 200', rLoginTerapeuta.status, 200)
  const jLoginTerapeuta = await rLoginTerapeuta.json() as { usuario?: { token?: string } }
  const crachaTerapeuta = jLoginTerapeuta.usuario?.token
  if (!crachaTerapeuta) {
    pular('rota fechada com cracha de terapeuta', 'o login nao devolveu token - ver app/api/terapeutas/login/route.ts')
  } else {
    const s = await status('/api/terapeutas/dashboard', crachaTerapeuta)
    conferir('/api/terapeutas/dashboard com cracha de terapeuta nao recusa', s === 401, false)
  }

  console.log('\n=== REGRAS POR PAPEL: ainda nao existem ===')
  // O middleware (Tarefa 6, ja no ar) so autentica: confirma QUEM esta
  // chamando e entrega a identidade. Ele NAO decide o que cada papel pode
  // ver - isso e a Fase 4 (Tarefas 8-14), que ainda nao foi feita. Rodar
  // estas provas agora daria FALHA (nao PULADO) contra o codigo de hoje, que
  // e o comportamento certo para o estagio atual do plano - so nao e o que
  // esta sendo verificado aqui.
  pular('terapeuta ve so as proprias sessoes/vendas no dashboard (a pergunta "a Denise consegue ver o faturamento do Pedro?")',
    'a rota ainda nao filtra pela identidade que o middleware entrega - entra na Tarefa 9')
  pular('socio nao ve a divisao entre socios em GET /api/closings',
    'a regra por papel entra na Tarefa 10')

  if (falhas > 0) {
    console.log(`\n${falhas} FALHA(S)\n`)
    process.exit(1)
  }
  if (pulados > 0) {
    console.log(`\nNADA FALHOU, MAS ${pulados} PROVA(S) FORAM PULADAS - isto NAO e "tudo provado".`)
    console.log('Resolva o que falta (em geral: a regra por papel ainda nao foi implementada, ou a pessoa precisa ter entrado uma vez) e rode de novo.\n')
    process.exit(2)
  }
  console.log('\nTUDO PROVADO\n')
  process.exit(0)
}
main()
