import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade, inferirNumeroSessoes, calcularComissao, brasiliaLocalToISO } from '@/lib/terapeutas-auth'
import { criarEventoComMeet } from '@/lib/google-meet'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sale_id, terapeuta_id, data_primeira_sessao, numero_sessoes, datas_sessoes, usuario_email, senha } = body as {
    sale_id: string
    terapeuta_id: string
    data_primeira_sessao: string
    numero_sessoes?: number
    datas_sessoes?: string[]
    usuario_email: string
    senha: string
  }

  if (!sale_id || !terapeuta_id || !data_primeira_sessao || !usuario_email || !senha) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  try {
  const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
  if (!valido) return NextResponse.json({ error: 'Senha inválida' }, { status: 401 })

  const client = getSupabaseAdmin()

  const { data: sale, error: saleErr } = await client
    .from('sales').select('id,nome,email,produto,valor_liquido').eq('id', sale_id).single()
  if (saleErr || !sale) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })

  const { data: terapeuta, error: terapErr } = await client
    .from('terapeutas').select('id,percentual_comissao').eq('id', terapeuta_id).single()
  if (terapErr || !terapeuta) return NextResponse.json({ error: 'Terapeuta não encontrado' }, { status: 404 })

  // O nome do produto nem sempre indica o pacote real (ex: "Mentoria Particular -
  // Pedro | Denise" é usado pra pacotes de 1/2/4/8 sessões sem diferenciação no
  // nome), então a tela de agendamento permite sobrescrever o valor inferido.
  const numSessoes = numero_sessoes && numero_sessoes > 0
    ? Math.floor(numero_sessoes)
    : inferirNumeroSessoes(sale.produto as string)
  const { comissao_por_sessao } = calcularComissao({
    valor_liquido: sale.valor_liquido as number,
    percentual: terapeuta.percentual_comissao as number,
    numero_sessoes: numSessoes,
  })

  // Deletar sessões existentes que ainda não foram entregues (reagendamento total)
  await client.from('sessoes').delete()
    .eq('sale_id', sale_id)
    .in('status', ['pendente', 'agendada', 'remarcada'])

  // brasiliaLocalToISO trata o input como horário de Brasília (UTC-3, sem
  // horário de verão) — new Date(string sem timezone) direto é ambíguo e
  // depende do TZ do runtime do servidor, causando horários errados.
  // Regra padrão: 7 em 7 dias a partir da primeira. `datas_sessoes` (opcional,
  // um datetime-local por sessão) deixa o comercial corrigir pontualmente uma
  // sessão que sai da regra — sem mudar como as demais são calculadas.
  const primeiraDataMs = new Date(brasiliaLocalToISO(data_primeira_sessao)).getTime()
  const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000
  const datasExplicitas = datas_sessoes && datas_sessoes.length === numSessoes
    ? datas_sessoes.map(d => new Date(brasiliaLocalToISO(d)).toISOString())
    : null
  const sessoes = Array.from({ length: numSessoes }, (_, i) => {
    return {
      sale_id,
      terapeuta_id,
      numero_sessao: i + 1,
      total_sessoes: numSessoes,
      status: 'agendada',
      status_consulta: 'aguardando',
      data_agendada: datasExplicitas ? datasExplicitas[i] : new Date(primeiraDataMs + i * SETE_DIAS_MS).toISOString(),
      link_meet: null,
      comissao_valor: comissao_por_sessao,
      comissao_paga: false,
      paciente_nome: sale.nome as string,
      paciente_email: sale.email as string,
      agendado_por: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
      vendedor_nome: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
      vendedor_email: usuario_email,
    }
  })

  const { error: insertErr } = await client.from('sessoes').insert(sessoes)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Link do Meet — não trava o agendamento se a API do Google falhar (ver
  // lib/google-meet.ts: sem credenciais configuradas, isso é um no-op).
  for (const s of sessoes) {
    const evento = await criarEventoComMeet({
      titulo: `Sessão — ${s.paciente_nome}`,
      inicioISO: s.data_agendada,
      fimISO: new Date(new Date(s.data_agendada).getTime() + 60 * 60 * 1000).toISOString(),
    })
    if (evento) {
      await client.from('sessoes')
        .update({ link_meet: evento.meetLink, google_event_id: evento.eventId })
        .eq('sale_id', sale_id).eq('numero_sessao', s.numero_sessao)
    }
  }

  await registrarAtividade({
    usuario_nome: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
    usuario_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial',
    tipo_acao: 'agendamento',
    sale_id,
    descricao: `${numSessoes} sessões agendadas para ${sale.nome} — primeira em ${new Date(primeiraDataMs).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    dados_novos: { numSessoes, data_primeira_sessao, terapeuta_id, comissao_por_sessao },
  })

  return NextResponse.json({ success: true, sessoes_criadas: numSessoes })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
