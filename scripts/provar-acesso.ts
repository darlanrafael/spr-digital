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
  const jLoginTerapeuta = await rLoginTerapeuta.json() as { usuario?: { token?: string; terapeuta_id?: string | null } }
  const crachaTerapeuta = jLoginTerapeuta.usuario?.token ?? null
  const terapeutaIdDoLogado = jLoginTerapeuta.usuario?.terapeuta_id ?? null
  if (!crachaTerapeuta) {
    pular('rota fechada com cracha de terapeuta', 'o login nao devolveu token - ver app/api/terapeutas/login/route.ts')
  } else {
    const s = await status('/api/terapeutas/dashboard', crachaTerapeuta)
    conferir('/api/terapeutas/dashboard com cracha de terapeuta nao recusa', s === 401, false)
  }

  // Admin do MODULO DE TERAPEUTAS (usuarios_sistema, tipo=admin) - o CEO
  // real. Diferente do crachaAdmin acima (usuarios_dashboard, admin do DRE):
  // as 3 rotas de aprovacao (Tarefa A) autenticam por
  // verificarSenhaUsuario/verificarAcesso, que consultam usuarios_sistema -
  // um admin so do dashboard nao tem senha la e cairia em 401 "Senha
  // incorreta" antes de chegar na guarda desta tarefa.
  const rLoginAdminSistema = await fetch(`${BASE}/api/terapeutas/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin-teste@espelho.local', senha: 'teste123' }),
  })
  const jLoginAdminSistema = await rLoginAdminSistema.json() as { usuario?: { token?: string } }
  const crachaAdminSistema = jLoginAdminSistema.usuario?.token ?? null

  console.log('\n=== REGRAS POR PAPEL: a Tarefa 9 liga a rota do dashboard na identidade ===')
  // A prova abaixo e REAL - faz a chamada e confere a resposta. A Tarefa 9
  // trocou `const terapeutaId = searchParams.get('terapeutaId') ?? 'all'` por
  // `terapeutaIdQueValeu(quem, ...)` (lib/identidade-da-chamada.ts): para
  // quem e terapeuta, o `terapeuta_id` da identidade decide SEMPRE, o
  // parametro e ignorado - antes, `?terapeutaId=all` dava a ela o
  // faturamento de todo mundo.
  //
  // O QUE ESTE BLOCO NAO CONSEGUE PROVAR, e por que: `por_terapeuta`
  // (app/api/terapeutas/dashboard/route.ts, "6. Stats por terapeuta") mapeia
  // SEMPRE a lista inteira de terapeutas ativos, sem filtrar pelo
  // `terapeutaId` decidido - isso e anterior a Tarefa 9 e nao mudou (o
  // filtro entra DEPOIS, zerando os campos de quem nao e o `terapeutaId`
  // decidido, nao removendo a linha). No espelho, os dois cadastros de teste
  // se chamam "TESTE Pedro" e "TESTE Terapeuta Denise": o primeiro nome
  // (usado por `nomesTerapeutas`/`termosDeProduto` para filtrar `sales` por
  // `produto ilike %nome%`) vira "teste" pros dois, e nenhum produto de venda
  // real contem "teste" - a venda de R$5000 do Pedro (produto "Mentoria
  // Particular - Pedro") nunca entra na consulta, para NINGUEM, admin
  // incluso, com ou sem a Tarefa 9. Resultado: a resposta de
  // `/api/terapeutas/dashboard?terapeutaId=all` e byte a byte IDENTICA para
  // o cracha do admin e o da terapeuta neste espelho - confirmado comparando
  // as duas respostas completas, nao so `por_terapeuta`. Isto e um defeito
  // separado (nome de teste com prefixo comum quebra o casamento por
  // primeiro-nome), non relacionado a Tarefa 9, e fora do escopo dela.
  //
  // A prova de que o SERVIDOR decide certo (ignora o parametro pra
  // terapeuta, obedece pro admin) foi feita chamando as duas rotas e
  // observando o valor de `terapeutaId` que o handler calcula - documentada
  // com a saida real em task-9-report.md. Aqui fica so o que da pra provar
  // por HTTP com os dados atuais do espelho: as duas chamadas respondem 200
  // e o formato da lista bate.

  type RespostaDashboard = { por_terapeuta?: { id: string; nome: string }[] }

  if (!crachaAdmin || !crachaTerapeuta) {
    pular('terapeutaId=all: admin e terapeuta recebem 200 com o mesmo formato de lista',
      'precisa de cracha valido de admin E de terapeuta para comparar as duas respostas')
  } else {
    const [rAdmin, rTerapeuta] = await Promise.all([
      fetch(`${BASE}/api/terapeutas/dashboard?terapeutaId=all`, { headers: { [CABECALHO]: crachaAdmin } }),
      fetch(`${BASE}/api/terapeutas/dashboard?terapeutaId=all`, { headers: { [CABECALHO]: crachaTerapeuta } }),
    ])
    conferir('terapeutaId=all com cracha de ADMIN responde 200', rAdmin.status, 200)
    conferir('terapeutaId=all com cracha de TERAPEUTA responde 200', rTerapeuta.status, 200)
    const [jAdmin, jTerapeuta] = await Promise.all([
      rAdmin.json() as Promise<RespostaDashboard>,
      rTerapeuta.json() as Promise<RespostaDashboard>,
    ])
    const totalAdmin = jAdmin.por_terapeuta?.length ?? 0
    // Depois da Tarefa 9B, por_terapeuta RESPEITA o terapeutaId decidido: o admin
    // ve TODAS as terapeutas, a terapeuta ve SO ELA. Com os dois cadastros de
    // teste do espelho (Denise e Pedro), o admin ve 2 e a terapeuta ve 1.
    conferir('ADMIN pedindo all ve mais de uma terapeuta (o espelho tem 2)',
      totalAdmin >= 2, true)
    conferir('TERAPEUTA pedindo all ve SO ELA (por_terapeuta com 1 linha) - o furo da 9B fechado',
      jTerapeuta.por_terapeuta?.length, 1)
    const nomeUnico = jTerapeuta.por_terapeuta?.[0]?.nome ?? ''
    conferir('e a unica linha e a propria terapeuta (Denise), nao outra',
      nomeUnico.toLowerCase().includes('denise'), true)
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
  // mesma sessao). A Tarefa 9 ligou uma rota real na identidade
  // (/api/terapeutas/dashboard), mas neste espelho ela nao serve de rota de
  // eco para esta prova especifica: com ou sem o cabecalho forjado, e com ou
  // sem cracha de admin, a resposta desta rota sai IDENTICA (ver o bloco
  // anterior - defeito de casamento de produto, fora do escopo da Tarefa 9,
  // deixa `sessoes`/`sales` vazios pra qualquer `terapeutaId`). Uma
  // comparacao "com forjado" x "sem forjado" bateria igual mesmo se o
  // forjado tivesse vencido, o que provaria menos que nada. Continua sem
  // rota de eco permanente para isto.
  pular('cracha valido + x-spr-quem-tipo forjado por cima: o forjado nao pode vencer',
    'a rota real da Tarefa 9 existe, mas sua resposta neste espelho nao muda com terapeutaId nenhum (defeito de casamento de produto fora do escopo desta tarefa) - uma rota de eco continuaria sendo a unica forma de observar isto por HTTP; o apagamento do cabecalho forjado ja e provado por unidade nos testes "FORJA E APAGADA" de lib/decisao-do-middleware.test.ts')

  console.log('\n=== COM CRACHA DE COMERCIAL: administracao recusada ===')
  const { data: com } = await c.from('usuarios_sistema')
    .select('session_token,nome,email').eq('tipo', 'comercial')
    .not('session_token', 'is', null).limit(1).maybeSingle()
  const crachaComercial = (com as { session_token: string | null } | null)?.session_token
  const emailComercial = (com as { email: string | null } | null)?.email ?? ''
  if (!crachaComercial) {
    pular('administracao com cracha de comercial', 'nenhum comercial entrou ainda')
  } else {
    conferir('POST admin/usuarios com cracha de comercial',
      await status('/api/terapeutas/admin/usuarios', crachaComercial, 'POST', '{}'), 403)
    conferir('PATCH admin/terapeutas com cracha de comercial',
      await status('/api/terapeutas/admin/terapeutas', crachaComercial, 'PATCH', '{}'), 403)
    conferir('o comercial continua vendo o dashboard',
      await status('/api/terapeutas/dashboard', crachaComercial), 200)
  }

  console.log('\n=== DINHEIRO DO DRE: quem edita fechamento, caixa e custo (Tarefa 12) ===')
  // As tres rotas de escrita nao tinham guarda nenhuma - qualquer cracha
  // valido criava fechamento, lancava no caixa ou apagava custo, mesmo a
  // tela ja restringindo (canEdit em fechamentos/page.tsx, caixa/page.tsx,
  // dre/page.tsx). Corpo `{}` de proposito: se a guarda for a PRIMEIRA coisa
  // no metodo, a resposta para o socio e 403 antes de qualquer `req.json()`
  // de validacao rodar - nada e lido nem gravado. crachaAdmin e crachaSocio
  // ja vieram logados mais acima nesta mesma funcao.
  if (!crachaAdmin || !crachaSocio) {
    pular('dinheiro do DRE: socio recusado, admin passa da guarda',
      'precisa de cracha valido de admin E de socio (logados acima)')
  } else {
    conferir('POST /api/closings com cracha de socio: recusado (403)',
      await status('/api/closings', crachaSocio, 'POST', '{}'), 403)
    conferir('POST /api/closings com cracha de admin: passa da guarda (nao e 403)',
      (await status('/api/closings', crachaAdmin, 'POST', '{}')) === 403, false)

    conferir('POST /api/cashflow com cracha de socio: recusado (403)',
      await status('/api/cashflow', crachaSocio, 'POST', '{}'), 403)
    conferir('POST /api/cashflow com cracha de admin: passa da guarda (nao e 403)',
      (await status('/api/cashflow', crachaAdmin, 'POST', '{}')) === 403, false)

    conferir('DELETE /api/costs com cracha de socio: recusado (403)',
      await status('/api/costs', crachaSocio, 'DELETE', '{}'), 403)
    conferir('DELETE /api/costs com cracha de admin: passa da guarda (nao e 403)',
      (await status('/api/costs', crachaAdmin, 'DELETE', '{}')) === 403, false)
  }

  console.log('\n=== COM CRACHA DE TERAPEUTA: nao age na sessao de outra (Tarefa 13) ===')
  // A rota /confirmar tambem exige o par usuario_email+senha (ou token) do
  // esquema ANTIGO de acesso (verificarAcesso, lib/terapeutas-auth.ts) - o
  // cracha do middleware (x-spr-cracha) e uma camada A MAIS, nao substitui a
  // outra nestas rotas de sessao. Por isso o corpo manda senha de novo: sem
  // ela a rota recusaria em 401 ANTES de chegar na guarda nova, o que
  // pareceria (sem ser) a guarda funcionando.
  //
  // Corpo com sessao_id de OUTRO terapeuta de proposito: se a guarda estiver
  // no lugar certo, a recusa (403) acontece ANTES do update - nada e escrito.
  if (!crachaTerapeuta || !terapeutaIdDoLogado) {
    pular('Denise nao age em sessao de outro terapeuta',
      'a terapeuta de teste precisa ter entrado e ter terapeuta_id vinculado')
  } else {
    const { data: deOutraTerapeuta } = await c.from('sessoes')
      .select('id,terapeuta_id,status').neq('terapeuta_id', terapeutaIdDoLogado)
      .limit(1).maybeSingle()
    const alvo = deOutraTerapeuta as { id: string; status: string } | null
    if (!alvo) {
      pular('Denise nao age em sessao de outro terapeuta', 'nenhuma sessao de outro terapeuta no banco')
    } else {
      const { data: antesRaw } = await c.from('sessoes').select('status').eq('id', alvo.id).single()
      const statusAntes = (antesRaw as { status: string } | null)?.status
      conferir('Denise NAO confirma sessao de outro terapeuta (403)',
        await status('/api/terapeutas/sessoes/confirmar', crachaTerapeuta, 'POST', JSON.stringify({
          sessao_id: alvo.id,
          usuario_email: 'terapeuta-teste@espelho.local',
          senha: 'teste123',
        })), 403)
      const { data: depoisRaw } = await c.from('sessoes').select('status').eq('id', alvo.id).single()
      const statusDepois = (depoisRaw as { status: string } | null)?.status
      conferir('a sessao de outro terapeuta NAO foi alterada pela tentativa recusada',
        statusDepois, statusAntes)
    }
  }

  console.log('\n=== COM CRACHA DE TERAPEUTA: nao mexe em venda (Tarefa 14) ===')
  // PROVADO em producao em 15/09/2026 com a credencial real da Denise:
  // PATCH /api/sales respondeu 200 "success" (mudava o status de qualquer
  // venda - inclusive marcar como reembolsada uma que nao foi), e
  // converter-moeda passou pela permissao (404 so por id falso). A prova do
  // PATCH usa uma venda REAL do espelho (venda-diag-teste) para poder
  // conferir que o status NAO mudou - nao basta o 403, precisa provar que
  // nada foi escrito. converter-moeda usa id falso: nenhuma venda e tocada
  // de qualquer forma, o 403 tem de vir da guarda de identidade.
  const ID_VENDA_DIAG_TESTE = 'venda-diag-teste'
  if (!crachaTerapeuta) {
    pular('Denise nao mexe em venda', 'a Denise precisa ter entrado uma vez')
  } else {
    const { data: antesRaw } = await c.from('sales').select('status').eq('id', ID_VENDA_DIAG_TESTE).maybeSingle()
    const statusAntes = (antesRaw as { status: string } | null)?.status
    if (statusAntes === undefined) {
      pular('Denise NAO altera venda (era 200 antes)',
        `a venda ${ID_VENDA_DIAG_TESTE} nao existe neste ambiente - fixture do espelho`)
    } else {
      conferir('Denise NAO altera venda (era 200 antes)',
        await status('/api/sales', crachaTerapeuta, 'PATCH', JSON.stringify({ id: ID_VENDA_DIAG_TESTE, status: 'aprovada' })), 403)
      const { data: depoisRaw } = await c.from('sales').select('status').eq('id', ID_VENDA_DIAG_TESTE).maybeSingle()
      const statusDepois = (depoisRaw as { status: string } | null)?.status
      conferir('a venda NAO foi alterada pela tentativa recusada', statusDepois, statusAntes)
    }
    conferir('Denise NAO converte moeda (passava a permissao antes)',
      await status('/api/sales/converter-moeda', crachaTerapeuta, 'POST', JSON.stringify({ sale_id: 'x', cambio: 5, usuario_email: 'x' })), 403)
  }

  // Comercial trabalha com a venda: tem de passar da guarda de papel. ID
  // falso de proposito - o que importa aqui e so o codigo NAO ser 403; um
  // id inexistente nao casa nenhuma linha, entao nada e alterado.
  //
  // converter-moeda manda o EMAIL REAL do proprio comercial: a rota tem uma
  // camada extra e mais antiga (usuario_email precisa existir em
  // usuarios_sistema e estar ativo, ver comentario na rota) que roda DEPOIS
  // da guarda nova. Um e-mail falso cai nessa camada e devolve 403 pelo
  // motivo ERRADO, mascarando exatamente o que esta prova quer medir - se
  // isso acontecer, a prova mede a camada antiga, nao a guarda desta tarefa.
  if (!crachaComercial) {
    pular('comercial passa da guarda de venda', 'nenhum comercial entrou ainda')
  } else {
    conferir('comercial passa da guarda em PATCH /api/sales (nao e 403)',
      (await status('/api/sales', crachaComercial, 'PATCH', JSON.stringify({ id: 'x', status: 'aprovada' }))) === 403, false)
    if (!emailComercial) {
      pular('comercial passa da guarda em POST /api/sales/converter-moeda',
        'o comercial logado nao tem email cadastrado em usuarios_sistema')
    } else {
      conferir('comercial passa da guarda em POST /api/sales/converter-moeda (nao e 403)',
        (await status('/api/sales/converter-moeda', crachaComercial, 'POST',
          JSON.stringify({ sale_id: 'x', cambio: 5, usuario_email: emailComercial }))) === 403, false)
    }
  }

  console.log('\n=== COM CRACHA DE TERAPEUTA: nao age na AGENDA de outro terapeuta (Tarefa I2) ===')
  // A Tarefa 13 fechou sessao (confirmar/remarcar/PATCH). Estas 6 rotas
  // OPERACIONAIS continuavam sem confinar a terapeuta a propria agenda:
  // agendar, empurrar-seguintes, compromissos (POST/DELETE), lancamento-
  // manual, editar-paciente, e dois tipos dentro de POST /vendas
  // ('remarcacao' e 'orientacao_sessao' - o PRIMEIRO e o MESMO caminho de
  // escrita que /sessoes/remarcar, so que batido direto, contornando a
  // guarda da Tarefa 13 sem precisar de bug nenhum nela).
  //
  // '00000000-0000-0000-0000-000000000000' como terapeuta_id "de outro": nao
  // precisa de um segundo terapeuta real cadastrado neste ambiente para
  // provar a guarda - qualquer id que nao seja o da Denise prova a regra, e
  // um id que nao existe de verdade tambem garante que, se a guarda falhar,
  // a escrita real cai num erro de FK/nao encontrado em vez de gravar algo
  // com aparencia valida.
  const OUTRO_ID_INVENTADO = '00000000-0000-0000-0000-000000000000'
  if (!crachaTerapeuta || !terapeutaIdDoLogado) {
    pular('Denise nao age na agenda de outro terapeuta (I2)',
      'a terapeuta de teste precisa ter entrado e ter terapeuta_id vinculado')
  } else {
    // agendar: sale_id inventado de proposito - o 404 "Venda nao encontrada"
    // so pode vir DEPOIS da guarda, entao nada e gravado nos dois casos.
    conferir('Denise NAO agenda passando terapeuta_id de outro (403)',
      await status('/api/terapeutas/sessoes/agendar', crachaTerapeuta, 'POST', JSON.stringify({
        sale_id: 'prova-i2-nao-existe', terapeuta_id: OUTRO_ID_INVENTADO,
        data_primeira_sessao: '2099-01-01T10:00',
        usuario_email: 'terapeuta-teste@espelho.local', senha: 'teste123',
      })), 403)
    conferir('Denise agendando na PROPRIA agenda passa da guarda (nao e 403)',
      (await status('/api/terapeutas/sessoes/agendar', crachaTerapeuta, 'POST', JSON.stringify({
        sale_id: 'prova-i2-nao-existe', terapeuta_id: terapeutaIdDoLogado,
        data_primeira_sessao: '2099-01-01T10:00',
        usuario_email: 'terapeuta-teste@espelho.local', senha: 'teste123',
      }))) === 403, false)

    // compromissos POST: data em 2099 de proposito, titulo identificavel -
    // se a guarda falhasse isto criaria um registro visivel para limpar; no
    // caminho esperado (403 antes do insert) nada e gravado, conferido pela
    // contagem antes/depois.
    const { count: comprAntes } = await c.from('compromissos_terapeuta')
      .select('*', { count: 'exact', head: true }).eq('terapeuta_id', OUTRO_ID_INVENTADO)
    conferir('Denise NAO lanca compromisso na agenda de outro terapeuta (403)',
      await status('/api/terapeutas/compromissos', crachaTerapeuta, 'POST', JSON.stringify({
        terapeuta_id: OUTRO_ID_INVENTADO, titulo: 'PROVA I2 - nao deveria existir',
        inicio: '2099-01-01T10:00', fim: '2099-01-01T11:00',
        usuario_email: 'terapeuta-teste@espelho.local', senha: 'teste123',
      })), 403)
    const { count: comprDepois } = await c.from('compromissos_terapeuta')
      .select('*', { count: 'exact', head: true }).eq('terapeuta_id', OUTRO_ID_INVENTADO)
    conferir('nenhum compromisso foi criado pela tentativa recusada', comprDepois, comprAntes)

    // compromissos DELETE: precisa de um compromisso de OUTRO terapeuta real
    // ja existente no banco para tentar apagar.
    const { data: comprDeOutro } = await c.from('compromissos_terapeuta')
      .select('id').neq('terapeuta_id', terapeutaIdDoLogado).limit(1).maybeSingle()
    if (!comprDeOutro) {
      pular('Denise nao apaga compromisso de outro terapeuta (I2)',
        'nenhum compromisso de outro terapeuta no banco deste ambiente')
    } else {
      const idComprAlvo = (comprDeOutro as { id: string }).id
      conferir('Denise NAO apaga compromisso de outro terapeuta (403)',
        await status('/api/terapeutas/compromissos', crachaTerapeuta, 'DELETE', JSON.stringify({
          id: idComprAlvo, usuario_email: 'terapeuta-teste@espelho.local', senha: 'teste123',
        })), 403)
      const { data: aindaExiste } = await c.from('compromissos_terapeuta')
        .select('id').eq('id', idComprAlvo).maybeSingle()
      conferir('o compromisso de outro terapeuta continua existindo', !!aindaExiste, true)
    }

    // lancamento-manual: payload minimo, terapeuta_id de outro.
    conferir('Denise NAO lanca manual para outro terapeuta (403)',
      await status('/api/terapeutas/vendas/lancamento-manual', crachaTerapeuta, 'POST', JSON.stringify({
        terapeuta_id: OUTRO_ID_INVENTADO, nome: 'Prova I2', email: 'prova-i2@example.com',
        usuario_email: 'terapeuta-teste@espelho.local', senha: 'teste123',
      })), 403)

    // empurrar-seguintes, editar-paciente e vendas (remarcacao/orientacao_sessao)
    // precisam de uma sessao REAL de outro terapeuta para provar contra ela.
    const { data: deOutraSessao } = await c.from('sessoes')
      .select('id,sale_id,terapeuta_id,data_agendada').neq('terapeuta_id', terapeutaIdDoLogado)
      .limit(1).maybeSingle()
    const outra = deOutraSessao as { id: string; sale_id: string; data_agendada: string | null } | null
    if (!outra) {
      pular('Denise nao mexe em sessao/venda de outro terapeuta (empurrar/editar-paciente/vendas) (I2)',
        'nenhuma sessao de outro terapeuta no banco deste ambiente')
    } else {
      const { data: antesEmpurrar } = await c.from('sessoes').select('data_agendada').eq('id', outra.id).single()
      conferir('Denise NAO empurra as seguintes a partir de sessao de outro terapeuta (403)',
        await status('/api/terapeutas/sessoes/empurrar-seguintes', crachaTerapeuta, 'POST', JSON.stringify({
          sessao_id: outra.id, usuario_email: 'terapeuta-teste@espelho.local', senha: 'teste123',
        })), 403)
      const { data: depoisEmpurrar } = await c.from('sessoes').select('data_agendada').eq('id', outra.id).single()
      conferir('a sessao de outro terapeuta NAO mudou de data pela tentativa recusada',
        (depoisEmpurrar as { data_agendada: string | null } | null)?.data_agendada,
        (antesEmpurrar as { data_agendada: string | null } | null)?.data_agendada)

      // POST /vendas tipo=remarcacao: o MESMO update de sessoes que
      // /sessoes/remarcar faz, batido direto por outra porta.
      const { data: antesRemarcarV } = await c.from('sessoes').select('data_agendada,status').eq('id', outra.id).single()
      conferir('Denise NAO remarca sessao de outro terapeuta via /vendas tipo=remarcacao (403)',
        await status('/api/terapeutas/vendas', crachaTerapeuta, 'POST', JSON.stringify({
          sale_id: outra.sale_id, tipo: 'remarcacao', titulo: 'x', descricao: 'x',
          dados_extras: {
            sessao_id: outra.id, nova_data: '2099-01-01T10:00:00.000Z',
            data_anterior: outra.data_agendada, solicitado_por: 'x', motivo: 'x',
          },
          usuario_email: 'terapeuta-teste@espelho.local', usuario_nome: 'x', usuario_tipo: 'terapeuta',
          senha: 'teste123',
        })), 403)
      const { data: depoisRemarcarV } = await c.from('sessoes').select('data_agendada,status').eq('id', outra.id).single()
      conferir('a sessao de outro terapeuta NAO mudou pela tentativa recusada em /vendas (remarcacao)',
        JSON.stringify(depoisRemarcarV), JSON.stringify(antesRemarcarV))

      // POST /vendas tipo=orientacao_sessao
      const { data: antesOrient } = await c.from('ocorrencias_prontuario')
        .select('id').eq('sessao_id', outra.id).eq('tipo', 'orientacao_sessao').maybeSingle()
      conferir('Denise NAO grava orientacao em sessao de outro terapeuta (403)',
        await status('/api/terapeutas/vendas', crachaTerapeuta, 'POST', JSON.stringify({
          sale_id: outra.sale_id, sessao_id: outra.id, tipo: 'orientacao_sessao',
          titulo: 'ORIENTAÇÃO DA SESSÃO:', descricao: 'prova I2',
          usuario_email: 'terapeuta-teste@espelho.local', usuario_nome: 'x', usuario_tipo: 'terapeuta',
          senha: 'teste123',
        })), 403)
      const { data: depoisOrient } = await c.from('ocorrencias_prontuario')
        .select('id').eq('sessao_id', outra.id).eq('tipo', 'orientacao_sessao').maybeSingle()
      conferir('nenhuma orientacao foi criada pela tentativa recusada', !!depoisOrient, !!antesOrient)

      // editar-paciente: so prova exclusao de verdade se NENHUMA sessao da
      // venda achada for da propria Denise (a regra e "pelo menos uma sessao
      // sua nesta venda", nao "a venda inteira e sua" - pacote conjunto do
      // Diagnostico tem sessao dos dois na MESMA venda).
      const { data: sessoesDaVendaAlvo } = await c.from('sessoes')
        .select('terapeuta_id').eq('sale_id', outra.sale_id)
      const idsDaVendaAlvo = new Set(
        (sessoesDaVendaAlvo ?? []).map(s => (s as { terapeuta_id: string | null }).terapeuta_id)
      )
      if (idsDaVendaAlvo.has(terapeutaIdDoLogado)) {
        pular('Denise nao edita paciente de venda que nao e sua (I2)',
          'a venda achada tem sessao da propria Denise tambem (pacote conjunto) - nao serve para provar exclusao')
      } else {
        const { data: antesPac } = await c.from('sales').select('nome,email,telefone').eq('id', outra.sale_id).single()
        const ap = antesPac as { nome: string; email: string; telefone: string | null } | null
        conferir('Denise NAO edita paciente de venda que nao e sua (403)',
          await status('/api/terapeutas/vendas/editar-paciente', crachaTerapeuta, 'PUT', JSON.stringify({
            sale_id: outra.sale_id, nome: ap?.nome ?? 'x', email: ap?.email ?? 'x@x.com',
            telefone: ap?.telefone ?? '',
            usuario_email: 'terapeuta-teste@espelho.local', usuario_nome: 'x', usuario_tipo: 'terapeuta',
            senha: 'teste123',
          })), 403)
        const { data: depoisPac } = await c.from('sales').select('nome,email,telefone').eq('id', outra.sale_id).single()
        conferir('os dados do paciente NAO mudaram pela tentativa recusada',
          JSON.stringify(depoisPac), JSON.stringify(antesPac))
      }
    }
  }

  // Comercial passa da guarda de agenda em qualquer terapeuta - e o trabalho
  // dele. Senha teste123 vale so no espelho (mesma limitacao ja documentada
  // acima para PATCH /api/sales e converter-moeda): rodando contra producao,
  // sem a senha real do comercial, a camada ANTIGA (verificarAcesso) recusa
  // antes desta guarda nova rodar - o "nao e 403" ainda passa (vira 401), so
  // que sem exercitar de fato o codigo desta tarefa. Documentado, nao
  // escondido.
  if (!crachaComercial) {
    pular('comercial passa da guarda de agenda (I2)', 'nenhum comercial entrou ainda')
  } else {
    conferir('comercial passa da guarda em compromissos POST (nao e 403)',
      (await status('/api/terapeutas/compromissos', crachaComercial, 'POST', JSON.stringify({
        terapeuta_id: OUTRO_ID_INVENTADO, titulo: 'x', inicio: '2099-01-01T10:00', fim: '2099-01-01T11:00',
        usuario_email: emailComercial || 'x', senha: 'teste123',
      }))) === 403, false)
    conferir('comercial passa da guarda em agendar (nao e 403)',
      (await status('/api/terapeutas/sessoes/agendar', crachaComercial, 'POST', JSON.stringify({
        sale_id: 'prova-i2-nao-existe', terapeuta_id: OUTRO_ID_INVENTADO,
        data_primeira_sessao: '2099-01-01T10:00',
        usuario_email: emailComercial || 'x', senha: 'teste123',
      }))) === 403, false)
  }

  console.log('\n=== COM CRACHA DE TERAPEUTA: nao aprova reembolso/lancamento-manual/edicao-paciente (Tarefa A) ===')
  // Achado na revisao final da branch (IMP-A, ver progress.md): as 3 rotas
  // de aprovacao do CEO validavam SO senha/token, sem conferir papel.
  // Encadeado com solicitacoes_reembolso sem escopo (fechado na mesma
  // tarefa, em app/api/terapeutas/vendas/route.ts), uma terapeuta com a
  // PROPRIA senha criava uma solicitacao com sessoes_ids de outro paciente
  // e aprovava ela mesma - CANCELA sessao de qualquer paciente.
  //
  // Corpo com id INVENTADO de proposito: a guarda de admin fica logo apos a
  // checagem de senha/token existente, ANTES da busca da solicitacao no
  // banco - um id que nao existe prova a mesma coisa que um id real. Se a
  // guarda estivesse ausente ou depois da busca, o id inventado bateria em
  // "solicitacao nao encontrada" (404) em vez de 403, e teria provado o
  // contrario. A prova de que NADA E ALTERADO quando a terapeuta tenta
  // (guarda antes de qualquer escrita) foi feita contra uma solicitacao e
  // sessao REAIS no espelho - criadas e apagadas na mesma sessao - e fica
  // documentada em task-A-report.md; este script nao grava solicitacao
  // pendente nenhuma, entao nao ha fixture permanente para repetir esse
  // antes/depois aqui.
  const ID_SOLICITACAO_INVENTADA = '00000000-0000-0000-0000-000000000001'
  if (!crachaTerapeuta || !crachaAdminSistema) {
    pular('aprovacoes/lancamento-manual/edicao-paciente exigem admin (Tarefa A)',
      'precisa de cracha valido de terapeuta E do admin do modulo de terapeutas (usuarios_sistema)')
  } else {
    conferir('PATCH /api/terapeutas/aprovacoes com cracha de terapeuta: recusado (403)',
      await status('/api/terapeutas/aprovacoes', crachaTerapeuta, 'PATCH', JSON.stringify({
        id: ID_SOLICITACAO_INVENTADA, acao: 'aprovar',
        senha: 'teste123', usuario_nome: 'x', usuario_email: 'terapeuta-teste@espelho.local',
      })), 403)
    conferir('PATCH /api/terapeutas/aprovacoes com cracha de admin: passa da guarda (nao e 403)',
      (await status('/api/terapeutas/aprovacoes', crachaAdminSistema, 'PATCH', JSON.stringify({
        id: ID_SOLICITACAO_INVENTADA, acao: 'aprovar',
        senha: 'teste123', usuario_nome: 'x', usuario_email: 'admin-teste@espelho.local',
      }))) === 403, false)

    conferir('PATCH .../lancamento-manual com cracha de terapeuta: recusado (403)',
      await status('/api/terapeutas/aprovacoes/lancamento-manual', crachaTerapeuta, 'PATCH', JSON.stringify({
        solicitacao_id: ID_SOLICITACAO_INVENTADA, acao: 'aprovar',
        senha: 'teste123', usuario_email: 'terapeuta-teste@espelho.local',
      })), 403)
    conferir('PATCH .../lancamento-manual com cracha de admin: passa da guarda (nao e 403)',
      (await status('/api/terapeutas/aprovacoes/lancamento-manual', crachaAdminSistema, 'PATCH', JSON.stringify({
        solicitacao_id: ID_SOLICITACAO_INVENTADA, acao: 'aprovar',
        senha: 'teste123', usuario_email: 'admin-teste@espelho.local',
      }))) === 403, false)

    conferir('PATCH .../edicao-paciente com cracha de terapeuta: recusado (403)',
      await status('/api/terapeutas/aprovacoes/edicao-paciente', crachaTerapeuta, 'PATCH', JSON.stringify({
        solicitacao_id: ID_SOLICITACAO_INVENTADA, acao: 'aprovar',
        senha: 'teste123', usuario_email: 'terapeuta-teste@espelho.local',
      })), 403)
    conferir('PATCH .../edicao-paciente com cracha de admin: passa da guarda (nao e 403)',
      (await status('/api/terapeutas/aprovacoes/edicao-paciente', crachaAdminSistema, 'PATCH', JSON.stringify({
        solicitacao_id: ID_SOLICITACAO_INVENTADA, acao: 'aprovar',
        senha: 'teste123', usuario_email: 'admin-teste@espelho.local',
      }))) === 403, false)
  }

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
