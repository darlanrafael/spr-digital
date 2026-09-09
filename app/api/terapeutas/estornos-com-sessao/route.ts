import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { alertasDeEstornoComSessao, ESTORNOS_DE_PLATAFORMA, type VendaParaAlerta, type SessaoParaAlerta } from '@/lib/estorno-com-sessao'

// Vendas estornadas NA PLATAFORMA que ainda têm sessão futura marcada.
//
// Existe porque o estorno vindo de fora (o cliente pede reembolso na
// Hubla/Kiwify, ou dá chargeback dias depois) só trocava o `status` da venda: a
// sessão continuava marcada, o convite do Google ativo, o lembrete saindo, e
// ninguém era avisado. O caminho de dentro - reembolso pedido pela tela e
// aprovado pelo CEO - já cancela tudo; este é o buraco do de fora.
//
// A decisão de QUEM alerta vive em lib/estorno-com-sessao.ts, com os dois
// filtros que nasceram de casos reais: lançamento manual não conta, e paciente
// com outra venda aprovada não conta.
export async function GET(req: NextRequest) {
  try {
    const client = getSupabaseAdmin()

    // Mesma checagem do GET de pacotes: a lista traz nome, e-mail e produto de
    // paciente. Ver o comentário lá sobre o que ela protege e o que não.
    const email = (req.nextUrl.searchParams.get('usuario_email') ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Informe o usuário.' }, { status: 401 })
    const { data: quem } = await client
      .from('usuarios_sistema').select('id').ilike('email', email).eq('ativo', true).maybeSingle()
    if (!quem) return NextResponse.json({ error: 'Usuário não autorizado.' }, { status: 401 })

    const agoraISO = new Date().toISOString()

    // Só as sessões FUTURAS ativas interessam - é o filtro mais restritivo, e
    // deixa a consulta pequena mesmo com 600+ sessões na tabela.
    const { data: futuras, error: sErr } = await client
      .from('sessoes').select('id,sale_id,data_agendada,status')
      .gt('data_agendada', agoraISO).in('status', ['agendada', 'pendente'])
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

    const saleIds = [...new Set((futuras ?? []).map(s => (s as { sale_id: string }).sale_id))]
    if (saleIds.length === 0) return NextResponse.json({ alertas: [] })

    // As vendas dessas sessões, mais TODAS as vendas dos mesmos pacientes: sem
    // as outras, a regra não consegue saber que o paciente pagou de novo por
    // outro meio, e a Cris Polonine viraria alarme falso.
    const COLUNAS = 'id,nome,email,produto,status,valor_pago_cliente,data_reembolso'
    const vendasDasSessoes: VendaParaAlerta[] = []
    for (let i = 0; i < saleIds.length; i += 200) {
      const { data } = await client.from('sales').select(COLUNAS).in('id', saleIds.slice(i, i + 200))
      vendasDasSessoes.push(...((data ?? []) as unknown as VendaParaAlerta[]))
    }
    const emails = [...new Set(vendasDasSessoes.map(v => v.email).filter(Boolean) as string[])]
    const todasDoPaciente: VendaParaAlerta[] = []
    for (let i = 0; i < emails.length; i += 100) {
      const { data } = await client.from('sales').select(COLUNAS).in('email', emails.slice(i, i + 100))
      todasDoPaciente.push(...((data ?? []) as unknown as VendaParaAlerta[]))
    }
    const porId = new Map<string, VendaParaAlerta>()
    for (const v of [...vendasDasSessoes, ...todasDoPaciente]) porId.set(v.id, v)

    const alertas = alertasDeEstornoComSessao({
      vendas: [...porId.values()],
      sessoes: (futuras ?? []) as unknown as SessaoParaAlerta[],
      agoraISO,
    })

    return NextResponse.json({ alertas, statusConsiderados: ESTORNOS_DE_PLATAFORMA })
  } catch (err) {
    console.error('[estornos-com-sessao GET]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
