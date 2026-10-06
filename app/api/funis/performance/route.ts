import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'
import {
  getAccountIds, getCampanhasComInsights, getAdsComInsights, getAdsDiariosComInsights,
} from '@/lib/meta'
import {
  normalizarAd, adsDoFunil, agregarFunil, metricasDoCriativo, serieDiaria, type AdInsight,
} from '@/lib/funis/meta-funil'

export const dynamic = 'force-dynamic'

type FunilRow = { id: string; nome: string; termos_campanha: string[] | null }

// Cache curto em memória: a Meta é lenta (5 contas), então guardamos o resultado
// por período por 2 min. Navegar entre funis/períodos repetidos fica instantâneo.
const TTL = 120_000
const cache = new Map<string, { t: number; v: unknown }>()
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < TTL) return hit.v as T
  const v = await fn()
  cache.set(key, { t: Date.now(), v })
  return v
}

export async function GET(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeAdministrar(quem)) return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })

  try {
    const sp = req.nextUrl.searchParams
    const dateStart = sp.get('dateStart') ?? ''
    const dateEnd = sp.get('dateEnd') ?? ''
    const datePreset = sp.get('datePreset') ?? ''
    const funilId = sp.get('funilId')
    if (!datePreset && (!dateStart || !dateEnd)) {
      return NextResponse.json({ error: 'datePreset ou dateStart+dateEnd são obrigatórios' }, { status: 400 })
    }
    const preset = datePreset || undefined
    const periodo = `${datePreset}|${dateStart}|${dateEnd}`

    const { data, error } = await getSupabaseAdmin().from('funis').select('id,nome,termos_campanha')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const funis = (data ?? []) as FunilRow[]

    const metaDisponivel = !!process.env.META_ACCESS_TOKEN
    const aviso = metaDisponivel ? null : 'Os dados da Meta estão indisponíveis no momento. Verifique a conexão/token.'
    const contas = getAccountIds()
    const temTermos = funis.some(f => (f.termos_campanha ?? []).length > 0)

    // Totais (visão geral e cabeçalho do detalhe) vêm das campanhas, cacheadas por período.
    const campanhas: AdInsight[] = !temTermos ? [] : await cached(`camps|${periodo}`, async () =>
      (await Promise.all(contas.map(a => getCampanhasComInsights(a, dateStart, dateEnd, preset)))).flat().map(normalizarAd),
    )
    const agregadoDe = (f: FunilRow) => agregarFunil(adsDoFunil(campanhas, f.termos_campanha ?? []))

    if (!funilId) {
      return NextResponse.json({
        funis: funis.map(f => ({
          id: f.id, nome: f.nome, organico: (f.termos_campanha ?? []).length === 0, ...agregadoDe(f),
        })),
        aviso,
      })
    }

    const funil = funis.find(f => f.id === funilId)
    if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
    const termos = funil.termos_campanha ?? []

    let criativos: ReturnType<typeof metricasDoCriativo>[] = []
    let cadencia: ReturnType<typeof serieDiaria> = []
    if (termos.length > 0) {
      const det = await cached(`det|${funilId}|${periodo}`, async () => {
        const [ads, diarios] = await Promise.all([
          Promise.all(contas.map(a => getAdsComInsights(a, dateStart, dateEnd, termos, preset))),
          Promise.all(contas.map(a => getAdsDiariosComInsights(a, dateStart, dateEnd, termos, preset))),
        ])
        return {
          criativos: ads.flat().map(normalizarAd).map(metricasDoCriativo).sort((a, b) => b.spend - a.spend),
          cadencia: serieDiaria(diarios.flat()),
        }
      })
      criativos = det.criativos
      cadencia = det.cadencia
    }
    return NextResponse.json({
      funil: { id: funil.id, nome: funil.nome, organico: termos.length === 0, ...agregadoDe(funil) },
      criativos,
      cadencia,
      aviso,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro inesperado' }, { status: 500 })
  }
}
