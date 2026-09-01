import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'
import { buscarConflitosMultiTerapeuta, mensagemConflito } from '@/lib/agenda-conflitos'
import { novasDatasSeguintes } from '@/lib/diagnostico-guiado'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sessao_id, usuario_email, senha, token } = body as {
    sessao_id: string
    usuario_email: string
    senha?: string
    token?: string
  }

  if (!sessao_id || !usuario_email || (!senha && !token)) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  const acesso = await verificarAcesso({ usuario_email, senha, token })
  const { valido, usuario } = acesso
  if (!valido) {
    const { error, status } = erroAcesso(acesso)
    return NextResponse.json({ error }, { status })
  }

  const client = getSupabaseAdmin()

  const { data: sessao, error: fetchErr } = await client
    .from('sessoes').select('*').eq('id', sessao_id).single()
  if (fetchErr || !sessao) return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })

  // Esta rota é a segunda decisão do fluxo: a sessão do meio já foi remarcada
  // e salva por /remarcar. Aqui só empurramos as que vêm DEPOIS dela no mesmo
  // pacote, ainda não entregues nem canceladas - sessão entregue é histórico,
  // não pode ser movida, e cancelada não existe mais pro paciente.
  const { data: seguintes, error: seguintesErr } = await client
    .from('sessoes').select('id,terapeuta_id,numero_sessao')
    .eq('sale_id', sessao.sale_id)
    .gt('numero_sessao', sessao.numero_sessao as number)
    .not('status', 'in', '(entregue,cancelada)')
    .order('numero_sessao', { ascending: true })
  if (seguintesErr) return NextResponse.json({ error: seguintesErr.message }, { status: 500 })

  if (!seguintes || seguintes.length === 0) {
    return NextResponse.json({ success: true, movidas: 0 })
  }

  const novasDatas = novasDatasSeguintes({
    baseISO: sessao.data_agendada as string,
    quantidade: seguintes.length,
  })

  // Tudo ou nada, igual ao agendar: checa a agenda de cada terapeuta ANTES de
  // mover qualquer sessão. ignorarSaleId evita que as próprias sessões do
  // pacote conflitem entre si (a seguinte ocupando o novo horário da outra).
  const conflitos = await buscarConflitosMultiTerapeuta({
    itens: seguintes.map((s, i) => ({
      terapeuta_id: s.terapeuta_id as string,
      dataISO: novasDatas[i],
    })),
    ignorarSaleId: sessao.sale_id as string,
  })
  if (conflitos.length > 0) {
    return NextResponse.json({ error: mensagemConflito(conflitos), conflitos }, { status: 409 })
  }

  for (let i = 0; i < seguintes.length; i++) {
    const { error: updateErr } = await client.from('sessoes')
      .update({ data_agendada: novasDatas[i], updated_at: new Date().toISOString() })
      .eq('id', seguintes[i].id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email
  const usuarioTipo = (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial'

  await registrarAtividade({
    usuario_nome: usuarioNome,
    usuario_tipo: usuarioTipo,
    tipo_acao: 'empurrar_seguintes',
    sessao_id,
    sale_id: sessao.sale_id as string,
    descricao: `${seguintes.length} sessão(ões) seguinte(s) de ${sessao.paciente_nome} empurradas para manter os 7 dias, a partir da sessão ${sessao.numero_sessao}`,
    dados_novos: { movidas: seguintes.length, novasDatas },
  })

  return NextResponse.json({ success: true, movidas: seguintes.length })
}
