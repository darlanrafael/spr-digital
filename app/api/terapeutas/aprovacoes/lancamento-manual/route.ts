import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso } from '@/lib/terapeutas-auth'
import { criarLancamentoManual, datasDoLancamento, type PayloadLancamentoManual } from '@/lib/criar-lancamento-manual'
import { buscarConflitosAgenda } from '@/lib/agenda-conflitos'

// A fila de lançamentos manuais esperando decisão do CEO, e a decisão em si.
//
// Regra do usuário (09/09/2026): o comercial pede, o CEO aprova, e SÓ ENTÃO o
// sistema cria venda, sessões, evento do Meet e prontuário. Ver a rota de
// lançar e lib/criar-lancamento-manual.ts.
export async function GET(req: NextRequest) {
  try {
    const client = getSupabaseAdmin()
    const email = (req.nextUrl.searchParams.get('usuario_email') ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Informe o usuário.' }, { status: 401 })
    const { data: quem } = await client
      .from('usuarios_sistema').select('id').ilike('email', email).eq('ativo', true).maybeSingle()
    if (!quem) return NextResponse.json({ error: 'Usuário não autorizado.' }, { status: 401 })

    const { data, error } = await client
      .from('solicitacoes_lancamento_manual').select('*')
      .order('created_at', { ascending: false }).limit(100)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const linhas = (data ?? []) as Record<string, unknown>[]
    const pendentes = linhas.filter(s => s.status === 'pendente')

    // Para cada pendente, o que o paciente JÁ TEM. É a informação que faltou
    // no caso da Joicy: a venda duplicada existia no sistema e ninguém viu.
    const comContexto = []
    for (const s of pendentes) {
      const emailPac = String(s.paciente_email ?? '').trim().toLowerCase()
      let jaTem: unknown[] = []
      if (emailPac) {
        const { data: v } = await client
          .from('sales').select('id,produto,valor_pago_cliente,data_hora,status').eq('email', emailPac)
        jaTem = []
        for (const venda of (v ?? []) as { id: string }[]) {
          const { count } = await client.from('sessoes').select('*', { count: 'exact', head: true }).eq('sale_id', venda.id)
          ;(jaTem as Record<string, unknown>[]).push({ ...venda, sessoes: count ?? 0 })
        }
      }
      comContexto.push({ ...s, vendas_que_ja_existem: jaTem })
    }

    return NextResponse.json({
      pendentes: comContexto,
      historico: linhas.filter(s => s.status !== 'pendente').slice(0, 30),
    })
  } catch (err) {
    console.error('[aprovacoes/lancamento-manual GET]', err)
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
      .from('solicitacoes_lancamento_manual').select('*').eq('id', solicitacao_id).single()
    if (solErr || !sol) return NextResponse.json({ error: 'Solicitação não encontrada' }, { status: 404 })

    const s = sol as Record<string, unknown>
    // Idempotência: aprovar duas vezes criaria dois pacotes para o mesmo
    // paciente, que é exatamente o problema que esta fila veio resolver.
    if (s.status !== 'pendente') {
      return NextResponse.json({
        error: `Esta solicitação já foi ${s.status === 'aprovado' ? 'aprovada' : 'rejeitada'} por ${s.decidido_por_nome ?? 'alguém'}.`,
      }, { status: 409 })
    }

    const reservas = (s.compromissos_reservados as string[] | null) ?? []

    if (acao === 'rejeitar') {
      // Nada foi criado, então rejeitar é só liberar os horários reservados.
      if (reservas.length > 0) await client.from('compromissos_terapeuta').delete().in('id', reservas)
      const { error } = await client.from('solicitacoes_lancamento_manual').update({
        status: 'rejeitado', decidido_por_nome: nomeUsuario, decidido_por_email: usuario_email,
        decidido_em: new Date().toISOString(), justificativa_decisao: justificativa,
        compromissos_reservados: [],
      }).eq('id', solicitacao_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, acao: 'rejeitado', horarios_liberados: reservas.length })
    }

    const payload = s.payload as unknown as PayloadLancamentoManual

    // As reservas saem ANTES de criar as sessões: elas ocupam exatamente os
    // horários que as sessões vão ocupar, então a checagem de conflito da
    // criação bateria na própria reserva.
    if (reservas.length > 0) await client.from('compromissos_terapeuta').delete().in('id', reservas)

    // Com as reservas fora, confere se alguém ocupou o horário por outro
    // caminho enquanto o pedido esperava.
    const datas = datasDoLancamento(payload)
    if (datas.futuras.length > 0) {
      const conflitos = await buscarConflitosAgenda({
        terapeuta_id: payload.terapeuta_id, datasISO: datas.futuras,
      })
      if (conflitos.length > 0) {
        // Devolve as reservas: o pedido continua pendente e o horário volta a
        // ficar seguro enquanto o CEO decide o que fazer.
        for (const dataISO of datas.futuras) {
          await client.from('compromissos_terapeuta').insert({
            terapeuta_id: payload.terapeuta_id,
            titulo: `RESERVA - ${payload.nome || 'lançamento manual'} (aguardando aprovação)`,
            inicio: dataISO, fim: new Date(new Date(dataISO).getTime() + 60 * 60 * 1000).toISOString(),
            categoria: 'compromisso', criado_por_nome: nomeUsuario,
            criado_por_tipo: 'admin', criado_por_email: usuario_email,
          })
        }
        return NextResponse.json({
          error: `O horário foi ocupado enquanto o pedido esperava: ${conflitos.map(c => c.descricao).join(' | ')}. Ajuste a data com o comercial antes de aprovar.`,
          conflitos,
        }, { status: 409 })
      }
    }

    const r = await criarLancamentoManual({
      client, payload, usuarioNome: nomeUsuario,
      usuarioTipo: (usuario?.tipo as string) ?? 'admin',
    })
    if (!r.ok) {
      return NextResponse.json({ error: r.erro }, { status: r.status })
    }

    const { error: upErr } = await client.from('solicitacoes_lancamento_manual').update({
      status: 'aprovado', decidido_por_nome: nomeUsuario, decidido_por_email: usuario_email,
      decidido_em: new Date().toISOString(), justificativa_decisao: justificativa ?? null,
      sale_id_criada: r.saleId, sessoes_criadas: r.sessoesCriadas, compromissos_reservados: [],
    }).eq('id', solicitacao_id)
    // A criação já aconteceu: falhar aqui não desfaz nada, mas precisa
    // aparecer, senão a solicitação fica "pendente" e alguém aprova de novo.
    if (upErr) {
      return NextResponse.json({
        error: `O lançamento foi criado (venda ${r.saleId}), mas a solicitação não foi marcada como aprovada: ${upErr.message}. NÃO aprove de novo - isso criaria um segundo pacote.`,
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true, acao: 'aprovado', sale_id: r.saleId,
      sessoes_criadas: r.sessoesCriadas, sessoes_puladas: r.sessoesPuladas,
    })
  } catch (err) {
    console.error('[aprovacoes/lancamento-manual PATCH]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
