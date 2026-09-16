// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ehRotaAberta } from '@/lib/rotas-abertas'
import { CABECALHO_DO_CRACHA } from '@/lib/cabecalhos-da-identidade'
import { construirCabecalhosDeIdentidade } from '@/lib/decisao-do-middleware'
import { autenticarPeloCracha, type ClienteDeContas } from '@/lib/autenticacao-do-middleware'

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
// A consulta ao banco (achar a conta, decidir, renovar) mora em
// lib/autenticacao-do-middleware.ts, atras de um cliente injetavel - por isso
// testavel sem rede. A montagem dos cabecalhos mora em
// lib/decisao-do-middleware.ts, pura. Aqui fica so o resto do IO: ler o
// cabecalho e devolver a resposta certa.

function recusar(motivo: 'sem_cracha' | 'vencido') {
  return NextResponse.json({
    error: motivo === 'vencido'
      ? 'Sua sessão expirou. Entre de novo.'
      : 'Você precisa entrar no sistema para fazer isso.',
    motivo,
  }, { status: 401 })
}

// Falha de CONSULTA (banco fora do ar, rede, o 525 da Cloudflare que este
// sistema ja teve - lib/supabase.ts) NUNCA pode virar um 401 com `motivo`:
// lib/cracha-no-fetch.ts trata qualquer 401-com-motivo como sessao perdida e
// desloga a pessoa. Um soluco do banco nao pode deslogar todo mundo ao mesmo
// tempo - por isso 503, sem o campo `motivo`, para o cliente nao confundir
// "banco indisponivel agora" com "sua conta nao existe". A requisicao em si
// continua negada (fail-closed): so a ROTULAGEM muda.
function recusarIndisponivel() {
  return NextResponse.json({
    error: 'Não foi possível confirmar sua sessão agora. Tente de novo em instantes.',
  }, { status: 503 })
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

  const resultado = await autenticarPeloCracha(client as unknown as ClienteDeContas, cracha)
  if (resultado.tipo === 'falha_de_consulta') return recusarIndisponivel()
  if (resultado.tipo === 'recusado') return recusar(resultado.motivo)

  // Apaga o que veio de fora ANTES de escrever: sem isto, quem chama forjaria
  // a identidade mandando o cabecalho direto e viraria admin.
  const cabecalhos = construirCabecalhosDeIdentidade(req.headers, resultado.conta)
  return NextResponse.next({ request: { headers: cabecalhos } })
}

// So roda em /api/. Sem isto, toda pagina passaria por aqui a toa.
export const config = { matcher: '/api/:path*' }
