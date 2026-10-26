import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'
import { lerIdentidade, podeAdministrar, podeMexerEmVenda } from '@/lib/identidade-da-chamada'
import { decisaoDaFalta } from '@/lib/falta-comissao'

// Aprovacao de comissao de FALTA (nao compareceu) da Denise/Leomir (v2).
//
// Quando elas marcam "nao compareceu", a sessao vira entregue com a comissao
// INTACTA, porem TRAVADA (comissao_bloqueada = true), e cai aqui como pendente.
// O dono decide:
//   - Pagar     -> falta 'aprovado' e a sessao e DESTRAVADA (a comissao ja
//                  estava la; passa a contar no "a pagar").
//   - Nao pagar -> falta 'negado' e a sessao continua travada.
// A comissao nunca e zerada nem reescrita aqui. Mesmo padrao da aprovacao de
// reembolso. Ver item 125 do spr-digital.md.

type Falta = {
  id: string
  sessao_id: string
  sale_id: string | null
  terapeuta_id: string | null
  terapeuta_nome: string | null
  paciente_nome: string | null
  paciente_email: string | null
  numero_sessao: number | null
  total_sessoes: number | null
  data_sessao: string | null
  comissao_valor: number
  status: string
  solicitado_por_nome: string | null
  created_at: string
  decidido_por_nome: string | null
  decidido_em: string | null
}

function fmtBRL(n: number) {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export async function GET(req: NextRequest) {
  try {
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeMexerEmVenda(quem)) return NextResponse.json({ error: 'Sem permissão para ver as aprovações.' }, { status: 403 })

    const supabase = getSupabaseAdmin()

    if (req.nextUrl.searchParams.get('count') === 'true') {
      const { count } = await supabase
        .from('solicitacoes_falta_comissao')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pendente')
      return NextResponse.json({ pendentes_count: count ?? 0 })
    }

    const [pendentesRes, historicoRes] = await Promise.all([
      supabase.from('solicitacoes_falta_comissao')
        .select('*').eq('status', 'pendente').order('created_at', { ascending: false }),
      supabase.from('solicitacoes_falta_comissao')
        .select('*').neq('status', 'pendente').order('decidido_em', { ascending: false }).limit(50),
    ])

    return NextResponse.json({
      pendentes: (pendentesRes.data ?? []) as Falta[],
      historico: (historicoRes.data ?? []) as Falta[],
    })
  } catch (err) {
    console.error('[aprovacoes/falta-comissao GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // Identidade e papel ANTES da senha: sem isso a rota virava um oraculo de
    // senha para qualquer um (a resposta 401/403 revelava se a senha batia).
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeAdministrar(quem)) {
      return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
    }

    const body = await req.json() as Record<string, unknown>
    const { id, acao, senha, usuario_nome, usuario_email } = body
    if (
      typeof id !== 'string' || !id ||
      typeof senha !== 'string' || !senha ||
      typeof usuario_email !== 'string' || !usuario_email ||
      (acao !== 'pagar' && acao !== 'nao_pagar')
    ) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }
    const nome = typeof usuario_nome === 'string' && usuario_nome ? usuario_nome : quem.email

    // Amarra a auditoria a identidade: o admin so decide em nome de si mesmo.
    if (usuario_email.toLowerCase() !== quem.email.toLowerCase()) {
      return NextResponse.json({ error: 'O e-mail informado não é o da sua sessão.' }, { status: 403 })
    }

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()

    const { data: falta } = await supabase
      .from('solicitacoes_falta_comissao').select('*').eq('id', id).single()
    if (!falta) return NextResponse.json({ error: 'Falta não encontrada' }, { status: 404 })
    const f = falta as Falta

    const { novoStatusFalta, desbloquear } = decisaoDaFalta(acao)

    // Decisao ATOMICA: a condicao status='pendente' no proprio UPDATE e o que
    // mata a corrida/duplo-clique. Um SELECT antes nao basta.
    const { data: decididas, error: faltaErr } = await supabase
      .from('solicitacoes_falta_comissao')
      .update({
        status: novoStatusFalta,
        decidido_por_nome: nome,
        decidido_por_email: usuario_email,
        decidido_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pendente')
      .select()
    if (faltaErr) return NextResponse.json({ error: faltaErr.message }, { status: 500 })
    if (!decididas || decididas.length === 0) {
      return NextResponse.json({ error: 'Esta falta já foi decidida.' }, { status: 409 })
    }

    // Pagar: destrava a sessao (a comissao esta intacta). Condicionado ao
    // estado esperado; se a sessao mudou, desfaz a decisao da falta.
    if (desbloquear) {
      const { data: liberadas, error: sessErr } = await supabase.from('sessoes')
        .update({ comissao_bloqueada: false })
        .eq('id', f.sessao_id)
        .eq('status', 'entregue')
        .eq('status_consulta', 'nao_compareceu')
        .select('id')

      if (sessErr || !liberadas || liberadas.length === 0) {
        const { error: reverteErr } = await supabase.from('solicitacoes_falta_comissao')
          .update({
            status: 'pendente',
            decidido_por_nome: null,
            decidido_por_email: null,
            decidido_em: null,
          })
          .eq('id', id)
        if (reverteErr) {
          console.error('[aprovacoes/falta-comissao] FALHA ao reverter falta', id, reverteErr)
          return NextResponse.json({
            error: 'A sessão mudou de estado e a decisão não pôde ser desfeita; confira a falta ' + id + '.',
          }, { status: 500 })
        }
        return NextResponse.json({
          error: sessErr ? sessErr.message : 'A sessão mudou de estado; confira.',
        }, { status: 500 })
      }
    }

    const aprovou = acao === 'pagar'
    const { error: notaErr } = await supabase.from('ocorrencias_prontuario').insert({
      sale_id: f.sale_id,
      sessao_id: f.sessao_id,
      tipo: aprovou ? 'falta_comissao_aprovada' : 'falta_comissao_negada',
      titulo: aprovou ? 'Comissão da falta aprovada pelo CEO' : 'Comissão da falta negada pelo CEO',
      descricao: aprovou
        ? `Falta da sessão ${f.numero_sessao} (${f.terapeuta_nome ?? ''}): comissão de ${fmtBRL(f.comissao_valor)} aprovada por ${nome}.`
        : `Falta da sessão ${f.numero_sessao} (${f.terapeuta_nome ?? ''}): comissão de ${fmtBRL(f.comissao_valor)} NÃO paga, por decisão de ${nome}.`,
      dados_extras: { falta_id: id, sessao_id: f.sessao_id, comissao_valor: f.comissao_valor, decisao: acao },
      criado_por_nome: nome,
      criado_por_tipo: 'admin',
      criado_por_email: usuario_email,
    })
    // Nao derruba a resposta (a decisao ja valeu), mas fica no log.
    if (notaErr) console.error('[ocorrencias_prontuario] nota da falta nao gravada:', notaErr)

    // Nao derruba a resposta: a decisao ja foi persistida; retry daria 409.
    try {
      await registrarAtividade({
        usuario_nome: nome,
        usuario_tipo: 'admin',
        tipo_acao: aprovou ? 'falta_comissao_aprovada' : 'falta_comissao_negada',
        sessao_id: f.sessao_id,
        sale_id: f.sale_id ?? undefined,
        descricao: aprovou
          ? `Comissão de falta aprovada (${fmtBRL(f.comissao_valor)}) - ${f.terapeuta_nome ?? ''} - paciente: ${f.paciente_nome ?? ''}`
          : `Comissão de falta negada - ${f.terapeuta_nome ?? ''} - paciente: ${f.paciente_nome ?? ''}`,
      })
    } catch (e) {
      console.error('[aprovacoes/falta-comissao] atividade nao registrada:', e)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[aprovacoes/falta-comissao PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
