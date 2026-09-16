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
import { ROTAS_ABERTAS } from '@/lib/rotas-abertas'
import { CABECALHO_DO_CRACHA, CABECALHOS_DA_IDENTIDADE } from '@/lib/cabecalhos-da-identidade'

const BASE = process.env.BASE_DA_PROVA ?? 'http://localhost:3000'
const CABECALHO = CABECALHO_DO_CRACHA
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

type SessaoTokenRow = { session_token: string | null }

/** Login no dashboard do DRE, e leitura do cracha direto do banco: a rota
 * (app/api/dashboard-usuarios/login/route.ts) so devolve email/name/role, o
 * cracha fica so gravado em `usuarios_dashboard` - por isso o cliente
 * Supabase e usado aqui do mesmo jeito que o middleware o consultaria. */
async function logarNoDashboard(
  c: ReturnType<typeof createClient>,
  email: string,
  senha: string,
): Promise<{ status: number; cracha: string | null }> {
  const s = await status('/api/dashboard-usuarios/login', undefined, 'POST', JSON.stringify({ email, senha }))
  const { data } = await c.from('usuarios_dashboard').select('session_token').eq('email', email).maybeSingle()
  return { status: s, cracha: (data as SessaoTokenRow | null)?.session_token ?? null }
}

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('\n=== SEM CRACHA: rotas fechadas tem de recusar (401) ===')
  for (const r of ['/api/terapeutas/dashboard', '/api/closings', '/api/sales', '/api/costs', '/api/cashflow']) {
    conferir(`${r} sem cracha`, await status(r), 401)
  }
  conferir('POST /api/terapeutas/admin/usuarios sem cracha',
    await status('/api/terapeutas/admin/usuarios', undefined, 'POST', '{}'), 401)

  console.log('\n=== AS ROTAS ABERTAS (lib/rotas-abertas.ts): nao podem recusar por falta de cracha ===')
  //
  // A fonte da lista e o proprio modulo de producao, nao uma copia colada
  // aqui: se alguem acrescentar uma 8a rota aberta, este script passa a
  // testa-la sozinho. O que muda de rota para rota e SO como chamar (metodo,
  // corpo, segredo proprio) - por isso a categorizacao abaixo, e um guarda no
  // final que reprova qualquer rota que caia fora das 3 categorias
  // conhecidas em vez de deixa-la passar batido.
  const ROTAS_DE_WEBHOOK = ROTAS_ABERTAS.filter(r => r.startsWith('/api/webhooks/'))
  const ROTAS_DE_CRON = ROTAS_ABERTAS.filter(r => r.startsWith('/api/whatsapp/'))
  const ROTAS_DE_LOGIN = ROTAS_ABERTAS.filter(r => r.endsWith('/login'))
  const SEM_CATEGORIA = ROTAS_ABERTAS.filter(r =>
    !ROTAS_DE_WEBHOOK.includes(r) && !ROTAS_DE_CRON.includes(r) && !ROTAS_DE_LOGIN.includes(r))
  for (const r of SEM_CATEGORIA) {
    // Rota nova em lib/rotas-abertas.ts que este script ainda nao sabe testar.
    // FALHA de proposito: silenciar uma rota aberta nova, em silencio, e
    // exatamente o buraco que este arquivo existe para fechar.
    conferir(`${r} tem categoria de prova conhecida (webhook/cron/login)`, false, true)
  }

  // Webhooks (Hubla/Kiwify): corpo '{}' cai no ramo "sem evento reconhecido" -
  // 200, no maximo grava uma linha de LOG de webhook (nunca uma venda). Se
  // algum dia um segredo for configurado neste ambiente, a propria rota
  // devolveria 401 por conta propria - o que se confundiria com o middleware
  // bloqueando por falta de cracha. Por isso a checagem de env em runtime
  // antes de chamar, no lugar de assumir que o segredo nunca vai existir.
  for (const r of ROTAS_DE_WEBHOOK) {
    if (r.includes('hubla') && process.env.HUBLA_WEBHOOK_SECRET) {
      pular(`${r} continua aberta`, 'HUBLA_WEBHOOK_SECRET esta configurado neste ambiente - sem mandar o valor certo a propria rota devolveria 401, o que pareceria (sem ser) o middleware bloqueando')
      continue
    }
    if (r.includes('kiwify') && process.env.KIWIFY_WEBHOOK_TOKEN) {
      pular(`${r} continua aberta`, 'KIWIFY_WEBHOOK_TOKEN esta configurado neste ambiente - mesmo motivo do Hubla')
      continue
    }
    const s = await status(r, undefined, 'POST', '{}')
    conferir(`${r} continua aberta (nao 401)`, s === 401, false)
  }

  // As rotas de cron do WhatsApp tem GUARDA PROPRIA (x-whatsapp-cron-secret),
  // separada do cracha. Sem o segredo elas mesmas devolvem 401 - o que
  // pareceria "bloqueada" sem provar nada sobre o middleware. Por isso a
  // prova manda o segredo real (lido do .env.local, o mesmo dos dois lados) e
  // so confere que a rota nao esta fechada por falta de CRACHA.
  if (!SEGREDO_CRON) {
    for (const r of ROTAS_DE_CRON) {
      pular(`${r} continua aberta`,
        'WHATSAPP_CRON_SECRET nao esta definido neste ambiente - sem ele nao da para separar "bloqueado pelo middleware" de "bloqueado pela guarda propria da rota"')
    }
  } else {
    for (const r of ROTAS_DE_CRON) {
      const ehEscrita = r.endsWith('/marcar-enviado')
      // marcar-enviado escreve: corpo sem sessao_id/tipo cai na validacao
      // (400) antes de gravar qualquer coisa. As outras duas sao leitura.
      const s = await status(r, undefined, ehEscrita ? 'POST' : 'GET', ehEscrita ? '{}' : undefined,
        { 'x-whatsapp-cron-secret': SEGREDO_CRON })
      conferir(`${r} continua aberta (nao 401)`, s === 401, false)
    }
  }

  // Os dois logins: corpo sem email/senha cai na validacao (400) antes de
  // qualquer consulta - nada e lido nem gravado.
  for (const r of ROTAS_DE_LOGIN) {
    const s = await status(r, undefined, 'POST', '{}')
    conferir(`${r} continua aberta (nao 401)`, s === 401, false)
  }

  console.log('\n=== CRACHA VALIDO: tem de passar pelo middleware ===')

  // Admin do DRE (usuarios_dashboard).
  const { status: loginAdminStatus, cracha: crachaAdmin } =
    await logarNoDashboard(c, 'admindre-teste@espelho.local', 'teste123')
  conferir('login do admin de teste responde 200', loginAdminStatus, 200)
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
  const crachaTerapeuta = jLoginTerapeuta.usuario?.token ?? null
  if (!crachaTerapeuta) {
    pular('rota fechada com cracha de terapeuta', 'o login nao devolveu token - ver app/api/terapeutas/login/route.ts')
  } else {
    const s = await status('/api/terapeutas/dashboard', crachaTerapeuta)
    conferir('/api/terapeutas/dashboard com cracha de terapeuta nao recusa', s === 401, false)
  }

  console.log('\n=== REGRAS POR PAPEL: o middleware (Tarefa 6) so autentica, ainda nao filtra ===')
  // As duas provas abaixo sao REAIS - fazem a chamada e conferem o numero -
  // mas o "esperado" de hoje e o comportamento SEM a regra, porque as
  // Tarefas 9 e 10 (que introduzem a regra) ainda nao existem. Quando cada
  // uma entrar, o `esperado` destes `conferir()` muda - e so ai a prova passa
  // a testar a regra de verdade, em vez do buraco dela.

  type RespostaDashboard = { por_terapeuta?: { id: string; nome: string }[] }

  // 9: a terapeuta ve TODO MUNDO no dashboard, nao so ela - ate a Tarefa 9
  // ligar a rota na identidade que o middleware ja entrega.
  if (!crachaAdmin || !crachaTerapeuta) {
    pular('terapeutaId=all com cracha de terapeuta devolve todo mundo (ainda)',
      'precisa de cracha valido de admin E de terapeuta para comparar as duas respostas')
  } else {
    const [rAdmin, rTerapeuta] = await Promise.all([
      fetch(`${BASE}/api/terapeutas/dashboard?terapeutaId=all`, { headers: { [CABECALHO]: crachaAdmin } }),
      fetch(`${BASE}/api/terapeutas/dashboard?terapeutaId=all`, { headers: { [CABECALHO]: crachaTerapeuta } }),
    ])
    const [jAdmin, jTerapeuta] = await Promise.all([
      rAdmin.json() as Promise<RespostaDashboard>,
      rTerapeuta.json() as Promise<RespostaDashboard>,
    ])
    const totalAdmin = jAdmin.por_terapeuta?.length ?? 0
    // HOJE (sem a Tarefa 9): a rota ignora quem esta chamando e so olha o
    // `terapeutaId=all` da query string - por isso o cracha da terapeuta
    // devolve os MESMOS `totalAdmin` terapeutas que o cracha do admin (1 no
    // espelho; todos os ativos em producao). QUANDO A TAREFA 9 EXISTIR: a
    // resposta da terapeuta tem que vir com EXATAMENTE 1 (so ela mesma) -
    // trocar o `esperado` abaixo de `totalAdmin` para `1`.
    conferir('hoje terapeutaId=all com cracha de terapeuta devolve os MESMOS terapeutas que o admin (Tarefa 9 vai restringir a 1, so ela)',
      jTerapeuta.por_terapeuta?.length, totalAdmin)
  }

  // 10: o socio ve a divisao entre socios em /api/closings - ate a Tarefa 10
  // esconde-la.
  const { status: loginSocioStatus, cracha: crachaSocio } =
    await logarNoDashboard(c, 'socio-teste@espelho.local', 'teste123')
  conferir('login do socio de teste responde 200', loginSocioStatus, 200)
  if (!crachaAdmin || !crachaSocio) {
    pular('socio ainda ve a divisao entre socios em /api/closings',
      'precisa de cracha valido de admin E de socio para comparar as duas respostas')
  } else {
    const [rAdmin, rSocio] = await Promise.all([
      fetch(`${BASE}/api/closings`, { headers: { [CABECALHO]: crachaAdmin } }),
      fetch(`${BASE}/api/closings`, { headers: { [CABECALHO]: crachaSocio } }),
    ])
    conferir('/api/closings com cracha de socio nao recusa', rSocio.status === 401, false)
    type ClosingComSocios = { socios?: unknown[] }
    const [closingsAdmin, closingsSocio] = await Promise.all([
      rAdmin.json() as Promise<ClosingComSocios[]>,
      rSocio.json() as Promise<ClosingComSocios[]>,
    ])
    if (closingsAdmin.length === 0) {
      // O espelho hoje nao tem NENHUM fechamento gravado (tabela vazia), e
      // este script nao grava dado de teste. Sem um fechamento de verdade
      // nao da para conferir se o campo `socios` vem redigido - o que da
      // para provar, mesmo assim, e que a rota nao distingue por identidade:
      // as duas respostas tem o mesmo tamanho. QUANDO HOUVER UM FECHAMENTO NO
      // ESPELHO E A TAREFA 10 EXISTIR: trocar esta checagem por
      // "closingsSocio[0].socios vazio/ausente E closingsAdmin[0].socios
      // continua cheio".
      conferir('sem fechamento no espelho: resposta de /api/closings tem o mesmo tamanho para admin e socio (hoje, sem filtro por papel)',
        closingsSocio.length, closingsAdmin.length)
    } else {
      // Ha fechamento de verdade (rodando contra producao, por exemplo): HOJE
      // o campo `socios` vem CHEIO tambem para o socio, porque a Tarefa 10
      // (que deve escondê-lo) ainda nao existe. QUANDO ELA ENTRAR: trocar o
      // `esperado` abaixo de `true` para `false`.
      const socioVeDivisaoHoje = (closingsSocio[0]?.socios?.length ?? 0) > 0
      conferir('hoje o socio AINDA VE a divisao entre socios no primeiro fechamento (Tarefa 10 vai escondê-la)',
        socioVeDivisaoHoje, true)
    }
  }

  console.log('\n=== FORJAR IDENTIDADE: cabecalho x-spr-quem-* mandado por fora nao pode valer ===')
  // Metade que da para provar de fora hoje, sem nenhum cracha: mandar os
  // cabecalhos de identidade forjados SOZINHOS continua caindo no mesmo 401
  // de sempre - forjar a identidade nao e um atalho para pular o cracha.
  const sForjadoSemCracha = await fetch(`${BASE}/api/closings`, {
    headers: {
      [CABECALHOS_DA_IDENTIDADE.tipo]: 'dashboard:admin',
      [CABECALHOS_DA_IDENTIDADE.id]: 'forjado',
    },
  }).then(r => r.status)
  conferir('x-spr-quem-tipo forjado SEM cracha ainda cai em 401', sForjadoSemCracha, 401)

  // A outra metade - cracha VALIDO de um papel comum + cabecalho de
  // identidade forjado por cima tentando virar admin - prova que o
  // middleware.ts APAGA o que veio de fora antes de escrever (comentario "Apaga
  // o que veio de fora ANTES de escrever" em middleware.ts). Isto foi provado
  // de forma EFEMERA na Tarefa 6 (rota de eco temporaria, criada e apagada na
  // mesma sessao). Prova-la nesta rede permanente, de fora, exigiria uma rota
  // so para ecoar os cabecalhos que o handler recebeu - uma superficie nova
  // so para teste, que este script nao decide sozinho criar. Fica provada de
  // verdade quando a Tarefa 9 ligar uma rota real na identidade: nesse ponto,
  // mandar x-spr-quem-tipo forjado por cima do cracha da TERAPEUTA e conferir
  // que a resposta continua sendo a dela (nao a de admin forjada) fecha esta
  // prova sem precisar de rota de eco nenhuma.
  pular('cracha valido + x-spr-quem-tipo forjado por cima: o forjado nao pode vencer',
    'sem rota que leia a identidade escrita pelo middleware (Tarefa 8/9) nao da para observar isto de fora; a rota de eco da Tarefa 6 foi efemera e removida de proposito')

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
