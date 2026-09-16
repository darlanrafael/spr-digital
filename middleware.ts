// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ehRotaAberta } from '@/lib/rotas-abertas'
import { CABECALHO_DO_CRACHA, CABECALHOS_DA_IDENTIDADE } from '@/lib/cabecalhos-da-identidade'
import { crachaVencido, precisaRenovar, novaValidade } from '@/lib/cracha'
import {
  contaEncontrada,
  decidirAcesso,
  construirCabecalhosDeIdentidade,
  type RegistroSistema,
  type RegistroDashboard,
} from '@/lib/decisao-do-middleware'

// A porta de entrada de TODA rota de API.
//
// Antes disto, cada rota decidia sozinha se pedia alguma coisa - e a maioria
// nao pedia nada. Espalhado, basta esquecer uma rota para o furo continuar;
// aqui, o padrao e recusar, e a excecao e uma lista curta e testada
// (lib/rotas-abertas.ts).
//
// O que ele entrega para a rota: QUEM esta chamando, em cabecalhos que o
// proprio middleware escreve. A rota passa a usar isso no lugar do que o
// navegador mandou.
//
// A decisao (quem foi achado, se venceu, o que escrever) mora em
// lib/decisao-do-middleware.ts - SEM IO, por isso testavel sem banco e sem
// servidor. Aqui fica so o IO: ler o cabecalho, consultar o Supabase, e
// devolver a resposta certa.

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

  const achado = contaEncontrada(doSistema as RegistroSistema | null, doDashboard as RegistroDashboard | null)
  const decisao = decidirAcesso(achado, crachaVencido(achado?.expiraEm))
  if (decisao.tipo === 'recusado') return recusar(decisao.motivo)

  // Janela deslizante: enquanto a pessoa usa, o cracha nao vence.
  if (precisaRenovar(achado!.expiraEm)) {
    const tabela = doSistema ? 'usuarios_sistema' : 'usuarios_dashboard'
    const nova = novaValidade()
    const { error } = await client.from(tabela)
      .update({ session_token_expira_em: nova }).eq('session_token', cracha)
    // Falha aqui NAO invalida a chamada: a pessoa ja esta autenticada.
    if (error) console.error('[middleware] validade nao renovada:', error.message)
  }

  // Apaga o que veio de fora ANTES de escrever: sem isto, quem chama forjaria
  // a identidade mandando o cabecalho direto e viraria admin.
  const cabecalhos = construirCabecalhosDeIdentidade(req.headers, decisao.conta)
  return NextResponse.next({ request: { headers: cabecalhos } })
}

// So roda em /api/. Sem isto, toda pagina passaria por aqui a toa.
export const config = { matcher: '/api/:path*' }
