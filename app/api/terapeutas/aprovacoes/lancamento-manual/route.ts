import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso } from '@/lib/terapeutas-auth'
import { criarLancamentoManual, datasDoLancamento, type PayloadLancamentoManual } from '@/lib/criar-lancamento-manual'
import { buscarConflitosAgenda } from '@/lib/agenda-conflitos'
import { lerIdentidade, podeAdministrar, podeMexerEmVenda } from '@/lib/identidade-da-chamada'

// A fila de lançamentos manuais esperando decisão do CEO, e a decisão em si.
//
// Regra do usuário (09/09/2026): o comercial pede, o CEO aprova, e SÓ ENTÃO o
// sistema cria venda, sessões, evento do Meet e prontuário. Ver a rota de
// lançar e lib/criar-lancamento-manual.ts.
export async function GET(req: NextRequest) {
  try {
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeMexerEmVenda(quem)) return NextResponse.json({ error: 'Sem permissão para ver esta fila.' }, { status: 403 })

    const client = getSupabaseAdmin()
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

    // Esta fila e do CEO: aprovar cria venda, sessoes e evento de agenda de
    // verdade. verificarAcesso so confirma senha/token - nao confirma papel.
    // Mantido como camada extra; esta e a que decide quem pode aprovar.
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeAdministrar(quem)) {
      return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
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
      //
      // Se o apagar falhar, NAO marque como rejeitado: a solicitacao sairia da
      // fila com os horarios ainda bloqueados por uma reserva que ninguem mais
      // vai limpar, e a agenda do terapeuta ficaria com buraco permanente.
      if (reservas.length > 0) {
        const { error: apagarErr } = await client.from('compromissos_terapeuta').delete().in('id', reservas)
        if (apagarErr) {
          console.error('[aprovacoes/lancamento-manual] reservas nao liberadas ao rejeitar:', apagarErr)
          return NextResponse.json({
            error: 'Nao foi possivel liberar os horarios reservados deste pedido. Ele continua pendente; tente rejeitar de novo em alguns instantes.',
          }, { status: 500 })
        }
      }
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
    //
    // O erro TEM de ser conferido, e a rota TEM de parar aqui: se o apagar
    // falhar em silencio, as reservas continuam ocupando exatamente os horarios
    // pedidos, e a checagem de conflito logo abaixo encontra AS PROPRIAS
    // RESERVAS. O CEO recebia "o horario foi ocupado enquanto o pedido
    // esperava" apontando para uma reserva do proprio sistema, sem nenhum jeito
    // de aprovar e sem entender por que.
    if (reservas.length > 0) {
      const { error: apagarErr } = await client.from('compromissos_terapeuta').delete().in('id', reservas)
      if (apagarErr) {
        console.error('[aprovacoes/lancamento-manual] reservas nao apagadas ao aprovar:', apagarErr)
        return NextResponse.json({
          error: 'Nao foi possivel liberar as reservas de horario deste pedido. Ele continua pendente; tente aprovar de novo em alguns instantes.',
        }, { status: 500 })
      }
    }

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
        // Se a devolucao falhar, o horario NAO volta a ficar seguro - e isso
        // precisa aparecer na mensagem. Em silencio, o CEO leria "ajuste a data
        // com o comercial" achando que a vaga continua reservada, e ela estaria
        // livre para qualquer outro agendamento.
        let naoRedevolvidas = 0
        for (const dataISO of datas.futuras) {
          const { error: reservaErr } = await client.from('compromissos_terapeuta').insert({
            terapeuta_id: payload.terapeuta_id,
            titulo: `RESERVA - ${payload.nome || 'lançamento manual'} (aguardando aprovação)`,
            inicio: dataISO, fim: new Date(new Date(dataISO).getTime() + 60 * 60 * 1000).toISOString(),
            categoria: 'compromisso', criado_por_nome: nomeUsuario,
            criado_por_tipo: 'admin', criado_por_email: usuario_email,
          })
          if (reservaErr) {
            naoRedevolvidas++
            console.error('[aprovacoes/lancamento-manual] reserva nao redevolvida:', dataISO, reservaErr)
          }
        }
        const avisoReserva = naoRedevolvidas > 0
          ? ` ATENCAO: ${naoRedevolvidas} de ${datas.futuras.length} horario(s) NAO voltaram a ficar reservados - trate como vaga livre.`
          : ''
        return NextResponse.json({
          error: `O horário foi ocupado enquanto o pedido esperava: ${conflitos.map(c => c.descricao).join(' | ')}. Ajuste a data com o comercial antes de aprovar.${avisoReserva}`,
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
