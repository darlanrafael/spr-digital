// Repete a chamada ao Supabase quando a CONEXÃO falha antes de chegar no banco.
//
// CAUSA RAIZ, achada em 14/09/2026 depois de três noites sem lembrete de
// véspera. O erro que o n8n reportava como "Gateway Timeout" era, por dentro,
// uma página HTML do Cloudflare que fica na frente do Supabase:
//
//   supabase.co | 525: SSL handshake failed
//   Cloudflare is unable to establish an SSL connection to the origin server.
//   gateway.supabase.co · Ashburn · 2026-09-14 10:20:56 UTC
//
// Ou seja: não era o n8n, não era o Vercel e não era o código. É o caminho
// Vercel → Supabase falhando o handshake SSL de vez em quando, em torno de 5%
// das chamadas, espalhado pelo dia. Medido daqui em 40 chamadas seguidas: zero
// falhas — é intermitente, não constante, e por isso ninguém tinha achado.
//
// POR QUE REPETIR É SEGURO, INCLUSIVE EM ESCRITA. A repetição acontece SÓ
// quando a conexão nem chegou a ser estabelecida (handshake falhou, rede caiu,
// conexão resetada). Nesses casos o banco não executou nada — não existe risco
// de gravar duas vezes.
//
// Resposta HTTP vinda do PostgREST, mesmo 500, NÃO é repetida: ali o banco
// respondeu, e repetir um `insert` que deu erro de constraint só criaria ruído.
// A única exceção é o 525 do Cloudflare, que é resposta de proxy e não do
// banco — ele vem com HTML e é reconhecido pelo corpo.

/** Quanto esperar entre as tentativas. Curto: o handshake falha rápido. */
const ESPERAS_MS = [150, 500, 1200]

const dorme = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Falha de CONEXÃO, em que o banco não chegou a executar nada. */
function ehFalhaDeConexao(erro: unknown): boolean {
  const txt = String((erro as { message?: string })?.message ?? erro).toLowerCase()
  return [
    'fetch failed', 'network', 'econnreset', 'econnrefused', 'etimedout',
    'socket hang up', 'handshake', 'eai_again', 'enotfound', 'und_err',
  ].some(marca => txt.includes(marca))
}

/**
 * Página de erro do Cloudflare em vez da resposta do banco.
 *
 * Chega com status 5xx e corpo HTML. É proxy, não é o PostgREST: o banco não
 * executou nada, então repetir é seguro mesmo em escrita.
 */
async function ehErroDeProxy(resposta: Response): Promise<boolean> {
  if (resposta.status < 500) return false
  const tipo = resposta.headers.get('content-type') ?? ''
  if (!tipo.includes('text/html')) return false
  // `clone()` porque o corpo só pode ser lido uma vez e quem chamou ainda
  // precisa dele quando a gente desistir de repetir.
  try {
    const corpo = await resposta.clone().text()
    return /handshake failed|error code 5\d\d|cloudflare/i.test(corpo)
  } catch {
    return false
  }
}

/**
 * `fetch` que repete falha de conexão. Entra no cliente do Supabase e vale
 * para TODA consulta do sistema, sem ninguém precisar lembrar de embrulhar.
 */
export function fetchComRetry(
  fetchOriginal: typeof fetch = fetch,
): (entrada: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (entrada, init) => {
    let ultimoErro: unknown = null

    for (let tentativa = 0; tentativa <= ESPERAS_MS.length; tentativa++) {
      if (tentativa > 0) await dorme(ESPERAS_MS[tentativa - 1])

      try {
        const resposta = await fetchOriginal(entrada, init)
        if (tentativa < ESPERAS_MS.length && await ehErroDeProxy(resposta)) {
          ultimoErro = new Error(`proxy respondeu ${resposta.status}`)
          continue
        }
        return resposta
      } catch (erro) {
        ultimoErro = erro
        // Erro que não é de conexão sobe na hora: repetir não ajudaria e
        // esconderia o problema real.
        if (!ehFalhaDeConexao(erro)) throw erro
      }
    }

    throw ultimoErro
  }
}
