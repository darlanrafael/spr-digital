import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'
import {
  getAccountIds, getCampanhasComInsights, getAdsComInsights, getAdsDiariosComInsights,
} from '@/lib/meta'
import {
  normalizarAd, adsDoFunil, agregarFunil, metricasDoCriativo, serieDiaria,
} from '@/lib/funis/meta-funil'

export const dynamic = 'force-dynamic'

type FunilRow = { id: string; nome: string; termos_campanha: string[] | null }

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

    const { data, error } = await getSupabaseAdmin().from('funis').select('id,nome,termos_campanha')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const funis = (data ?? []) as FunilRow[]

    const contas = getAccountIds()
    const campanhasCruas = (await Promise.all(
      contas.map(a => getCampanhasComInsights(a, dateStart, dateEnd, preset)),
    )).flat()
    const campanhas = campanhasCruas.map(normalizarAd)
    const agregadoDe = (f: FunilRow) => agregarFunil(adsDoFunil(campanhas, f.termos_campanha ?? []))

    if (!funilId) {
      return NextResponse.json({
        funis: funis.map(f => ({
          id: f.id, nome: f.nome, organico: (f.termos_campanha ?? []).length === 0, ...agregadoDe(f),
        })),
      })
    }

    const funil = funis.find(f => f.id === funilId)
    if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
    const termos = funil.termos_campanha ?? []

    let criativos: ReturnType<typeof metricasDoCriativo>[] = []
    let cadencia: ReturnType<typeof serieDiaria> = []
    if (termos.length > 0) {
      const [ads, diarios] = await Promise.all([
        Promise.all(contas.map(a => getAdsComInsights(a, dateStart, dateEnd, termos, preset))),
        Promise.all(contas.map(a => getAdsDiariosComInsights(a, dateStart, dateEnd, termos, preset))),
      ])
      criativos = ads.flat().map(normalizarAd).map(metricasDoCriativo).sort((a, b) => b.spend - a.spend)
      cadencia = serieDiaria(diarios.flat())
    }
    return NextResponse.json({
      funil: { id: funil.id, nome: funil.nome, organico: termos.length === 0, ...agregadoDe(funil) },
      criativos,
      cadencia,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro inesperado' }, { status: 500 })
  }
}
