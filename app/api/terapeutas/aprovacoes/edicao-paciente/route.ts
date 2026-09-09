import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'

// A fila de trocas de paciente esperando decisao do CEO, e a decisao.
//
// Regra do usuario (09/09/2026): o comercial pede com motivo escrito, o CEO
// aprova, e SO ENTAO os dados mudam. Enquanto espera, o prontuario continua
// com os dados antigos.
export async function GET(req: NextRequest) {
  try {
    const client = getSupabaseAdmin()
    const email = (req.nextUrl.searchParams.get('usuario_email') ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Informe o usuário.' }, { status: 401 })
    const { data: quem } = await client
      .from('usuarios_sistema').select('id').ilike('email', email).eq('ativo', true).maybeSingle()
    if (!quem) return NextResponse.json({ error: 'Usuário não autorizado.' }, { status: 401 })

    const { data, error } = await client
      .from('solicitacoes_edicao_paciente').select('*')
      .order('created_at', { ascending: false }).limit(100)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const linhas = (data ?? []) as Record<string, unknown>[]
    const pendentes = linhas.filter(s => s.status === 'pendente')

    // Quantas sessoes vao mudar de nome junto. E o tamanho do que o CEO esta
    // aprovando: nao e so a linha da venda.
    const comContexto = []
    for (const s of pendentes) {
      const { count } = await client.from('sessoes').select('*', { count: 'exact', head: true }).eq('sale_id', String(s.sale_id))
      comContexto.push({ ...s, sessoes_afetadas: count ?? 0 })
    }

    return NextResponse.json({
      pendentes: comContexto,
      historico: linhas.filter(s => s.status !== 'pendente').slice(0, 30),
    })
  } catch (err) {
    console.error('[aprovacoes/edicao-paciente GET]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { solicitacao_id, acao, justificativa, usuario_email, senha, token } = body as {
    solicitacao_id: string
    acao: 'aprovar' | 'rejeitar'
    justificativa?: string
    usuario_email: string
    senha?: string
    token?: string
  }
  if (!solicitacao_id || !acao || !usuario_email || (!senha && !token)) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }
  if (acao === 'rejeitar' && (justificativa ?? '').trim().length < 10) {
    return NextResponse.json({ error: 'Escreva o motivo da recusa (mínimo 10 letras).' }, { status: 400 })
  }

  try {
    const acesso = await verificarAcesso({ usuario_email, senha, token })
    if (!acesso.valido) {
      const { error, status } = erroAcesso(acesso)
      return NextResponse.json({ error }, { status })
    }
    const usuario = acesso.usuario as Record<string, unknown> | undefined
    const nomeUsuario = (usuario?.nome as string) ?? usuario_email

    const client = getSupabaseAdmin()
    const { data: sol, error: solErr } = await client
      .from('solicitacoes_edicao_paciente').select('*').eq('id', solicitacao_id).single()
    if (solErr || !sol) return NextResponse.json({ error: 'Solicitação não encontrada' }, { status: 404 })

    const s = sol as Record<string, unknown>
    // Idempotencia: aprovar duas vezes sobrescreveria de novo, e a segunda vez
    // gravaria "antes" ja alterado - o rastro do original se perderia.
    if (s.status !== 'pendente') {
      return NextResponse.json({
        error: `Esta solicitação já foi ${s.status === 'aprovado' ? 'aprovada' : 'rejeitada'} por ${s.decidido_por_nome ?? 'alguém'}.`,
      }, { status: 409 })
    }

    if (acao === 'rejeitar') {
      const { error } = await client.from('solicitacoes_edicao_paciente').update({
        status: 'rejeitado', decidido_por_nome: nomeUsuario, decidido_por_email: usuario_email,
        decidido_em: new Date().toISOString(), justificativa_decisao: justificativa,
      }).eq('id', solicitacao_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      // Nada foi alterado, entao rejeitar nao desfaz nada. Mas o prontuario
      // precisa registrar que alguem TENTOU trocar e foi recusado.
      await client.from('ocorrencias_prontuario').insert({
        sale_id: String(s.sale_id), tipo: 'nota',
        titulo: 'Troca de paciente recusada',
        descricao: `${s.solicitado_por_nome} pediu para trocar os dados deste prontuário de "${s.nome_atual}" para "${s.nome_novo}". Motivo alegado: ${s.motivo}. RECUSADO por ${nomeUsuario}: ${justificativa}`,
        criado_por_nome: nomeUsuario, criado_por_tipo: (usuario?.tipo as string) ?? 'admin',
        criado_por_email: usuario_email,
      })
      return NextResponse.json({ success: true, acao: 'rejeitado' })
    }

    // APROVADO: agora sim os dados mudam.
    const { error: upErr } = await client.from('sales').update({
      nome: String(s.nome_novo).trim(),
      email: String(s.email_novo).trim(),
      telefone: (s.telefone_novo as string) ?? null,
    }).eq('id', String(s.sale_id))
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    // As sessoes guardam a propria copia. Sem propagar, a correcao fica presa
    // na venda e o Overview, a agenda e o lembrete seguem com o nome antigo.
    const { error: sessErr, count: sessoesAtualizadas } = await client
      .from('sessoes')
      .update({ paciente_nome: String(s.nome_novo).trim(), paciente_email: String(s.email_novo).trim() }, { count: 'exact' })
      .eq('sale_id', String(s.sale_id))
    if (sessErr) {
      return NextResponse.json({
        error: `A venda foi corrigida, mas as sessões não: ${sessErr.message}. O Overview vai continuar com o nome antigo.`,
      }, { status: 500 })
    }

    // A nota no PRONTUARIO, com o maximo de detalhe - pedido explicito do
    // usuario ("registre uma ocorrencia e detalhe ao maximo"). O log e
    // auditoria; o prontuario e o que o terapeuta le antes de atender.
    const compradoEm = s.data_compra
      ? new Date(new Date(String(s.data_compra)).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10).split('-').reverse().join('/')
      : '?'
    await client.from('ocorrencias_prontuario').insert({
      sale_id: String(s.sale_id), tipo: 'nota',
      titulo: 'Dados do paciente alterados (aprovado)',
      descricao:
        `Os dados deste prontuário passaram a ser de "${s.nome_novo}" (${s.email_novo}${s.telefone_novo ? `, ${s.telefone_novo}` : ''}). ` +
        `ANTES eram de "${s.nome_atual}" (${s.email_atual}${s.telefone_atual ? `, ${s.telefone_atual}` : ''}). ` +
        `A COMPRA foi feita por "${s.nome_atual}" (${s.email_atual}): ${s.produto ?? 'produto não informado'}, ` +
        `${s.valor_pago_cliente ? `R$ ${Number(s.valor_pago_cliente).toLocaleString('pt-BR')}` : 'valor não informado'}, ` +
        `plataforma ${s.plataforma ?? '?'}, em ${compradoEm}. ` +
        `${sessoesAtualizadas ?? 0} ${sessoesAtualizadas === 1 ? 'sessão recebeu' : 'sessões receberam'} o nome novo. ` +
        `Motivo informado por ${s.solicitado_por_nome}: ${s.motivo}. ` +
        `Aprovado por ${nomeUsuario}${justificativa ? `: ${justificativa}` : '.'}`,
      dados_extras: {
        antes: { nome: s.nome_atual, email: s.email_atual, telefone: s.telefone_atual },
        depois: { nome: s.nome_novo, email: s.email_novo, telefone: s.telefone_novo },
        compra: { produto: s.produto, plataforma: s.plataforma, valor: s.valor_pago_cliente, data: s.data_compra },
        motivo: s.motivo, solicitado_por: s.solicitado_por_nome, aprovado_por: nomeUsuario,
      },
      criado_por_nome: nomeUsuario, criado_por_tipo: (usuario?.tipo as string) ?? 'admin',
      criado_por_email: usuario_email,
    })

    const { error: finErr } = await client.from('solicitacoes_edicao_paciente').update({
      status: 'aprovado', decidido_por_nome: nomeUsuario, decidido_por_email: usuario_email,
      decidido_em: new Date().toISOString(), justificativa_decisao: justificativa ?? null,
      sessoes_atualizadas: sessoesAtualizadas ?? 0,
    }).eq('id', solicitacao_id)
    if (finErr) {
      return NextResponse.json({
        error: `Os dados foram alterados, mas a solicitação não foi marcada como aprovada: ${finErr.message}. NÃO aprove de novo.`,
      }, { status: 500 })
    }

    await registrarAtividade({
      usuario_nome: nomeUsuario, usuario_tipo: (usuario?.tipo as string) ?? 'admin',
      tipo_acao: 'paciente_editado', sale_id: String(s.sale_id),
      descricao: `Troca de paciente APROVADA: ${s.nome_atual} → ${s.nome_novo} (${sessoesAtualizadas ?? 0} sessões atualizadas). Motivo: ${s.motivo}`,
      dados_anteriores: { nome: s.nome_atual, email: s.email_atual, telefone: s.telefone_atual },
      dados_novos: { nome: s.nome_novo, email: s.email_novo },
    })

    return NextResponse.json({ success: true, acao: 'aprovado', sessoes_atualizadas: sessoesAtualizadas ?? 0 })
  } catch (err) {
    console.error('[aprovacoes/edicao-paciente PATCH]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
