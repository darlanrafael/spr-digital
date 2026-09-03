import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'

// Resposta do comercial sobre pacote pago em mais de uma compra.
//
// Duas coisas acontecem aqui, e a ordem importa:
//   1. se ele disse que é o mesmo pacote, a venda irmã é ligada a esta
//      (`pacote_pai_id`) e some de Pendentes de Agendamento;
//   2. a resposta vira registro em `ocorrencias_pacote` e no prontuário, para o
//      CEO conferir depois - pedido do usuário em 03/09/2026, "assim como já
//      acontece com os reembolsos".
//
// Não bloqueia nada: o comercial responde e segue agendando. A pergunta existe
// para o sistema não decidir sozinho o que só quem vendeu sabe.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const {
    sale_id, sale_irma_id, tipo, diferenca, sessoes_do_pacote,
    paciente_paga_diferenca, havera_outra_compra, justificativa,
    usuario_email, senha, token,
  } = body as {
    sale_id: string
    sale_irma_id?: string | null
    tipo: 'mesmo_pacote' | 'compra_separada' | 'valor_divergente'
    diferenca?: number | null
    sessoes_do_pacote?: number | null
    paciente_paga_diferenca?: boolean | null
    havera_outra_compra?: boolean | null
    justificativa?: string | null
    usuario_email: string
    senha?: string
    token?: string
  }

  if (!sale_id || !tipo || !usuario_email || (!senha && !token)) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }
  if (tipo === 'mesmo_pacote' && !sale_irma_id) {
    return NextResponse.json({ error: 'Para juntar as compras é preciso dizer qual é a outra venda.' }, { status: 400 })
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

    const { data: venda, error: vErr } = await client
      .from('sales').select('id, nome, produto, email, pacote_pai_id').eq('id', sale_id).single()
    if (vErr || !venda) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })

    if (tipo === 'mesmo_pacote') {
      // A rota NÃO confia na tela. Ligar duas vendas erradas dá ao paciente
      // menos sessões do que ele pagou e some com a segunda compra de
      // Pendentes, então cada condição é conferida aqui também.
      if (sale_irma_id === sale_id) {
        return NextResponse.json({ error: 'Uma venda não pode ser parte dela mesma.' }, { status: 400 })
      }
      // Esta venda já é filha de outra: ligá-la como pai criaria corrente (ou
      // ciclo, com A->B e B->A) que nenhuma tela sabe mostrar.
      if ((venda as { pacote_pai_id?: string | null }).pacote_pai_id) {
        return NextResponse.json({ error: 'Esta venda já faz parte de outro pacote.' }, { status: 409 })
      }
      const { data: irma, error: iErr } = await client
        .from('sales').select('id, pacote_pai_id, email, produto, status').eq('id', sale_irma_id as string).single()
      if (iErr || !irma) return NextResponse.json({ error: 'A outra venda não foi encontrada' }, { status: 404 })
      const i = irma as { pacote_pai_id?: string | null; email?: string | null; produto: string; status?: string | null }
      if (i.pacote_pai_id) {
        return NextResponse.json({ error: 'Essa outra venda já faz parte de outro pacote.' }, { status: 409 })
      }
      // Mesmo paciente, por E-MAIL. Cruzar por nome já produziu falso positivo
      // neste projeto.
      const emailA = ((venda as { email?: string | null }).email ?? '').trim().toLowerCase()
      const emailB = (i.email ?? '').trim().toLowerCase()
      if (!emailA || !emailB || emailA !== emailB) {
        return NextResponse.json({ error: 'As duas vendas precisam ser do mesmo paciente.' }, { status: 400 })
      }
      if (i.produto !== (venda as { produto: string }).produto) {
        return NextResponse.json({ error: 'As duas vendas precisam ser do mesmo produto.' }, { status: 400 })
      }
      if (i.status !== 'aprovada') {
        return NextResponse.json({ error: 'A outra venda não está aprovada.' }, { status: 400 })
      }
      // Irmã COM sessões já é um pacote agendado por conta própria. Ligá-la
      // aqui esconderia as sessões dela de todas as telas, que passam a olhar
      // só a venda-pai.
      const { data: sessoesIrma, error: sErr } = await client
        .from('sessoes').select('id').eq('sale_id', sale_irma_id as string).limit(1)
      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
      if ((sessoesIrma ?? []).length > 0) {
        return NextResponse.json({ error: 'A outra venda já tem sessões agendadas: ela é um pacote próprio.' }, { status: 409 })
      }
      const { error: upErr } = await client
        .from('sales').update({ pacote_pai_id: sale_id }).eq('id', sale_irma_id as string)
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    const { error: ocErr } = await client.from('ocorrencias_pacote').insert({
      sale_id,
      sale_irma_id: sale_irma_id ?? null,
      paciente_nome: (venda as { nome: string }).nome,
      produto: (venda as { produto: string }).produto,
      tipo,
      diferenca: diferenca ?? null,
      sessoes_do_pacote: sessoes_do_pacote ?? null,
      paciente_paga_diferenca: paciente_paga_diferenca ?? null,
      havera_outra_compra: havera_outra_compra ?? null,
      justificativa: justificativa ?? null,
      respondido_por_nome: nomeUsuario,
      respondido_por_email: usuario_email,
    })
    if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 })

    const descricao =
      tipo === 'mesmo_pacote'
        ? `Compras juntadas no mesmo pacote${sessoes_do_pacote ? ` (${sessoes_do_pacote} sessões)` : ''}, respondido por ${nomeUsuario}`
        : tipo === 'compra_separada'
          ? `Compras tratadas como pacotes separados, respondido por ${nomeUsuario}`
          : `Valor do pacote divergente${diferenca ? ` em ${diferenca > 0 ? 'falta' : 'sobra'} de R$ ${Math.abs(diferenca).toLocaleString('pt-BR')}` : ''}, respondido por ${nomeUsuario}`

    // Tipo 'nota': e o unico que o check constraint de ocorrencias_prontuario
    // conhece para registro livre. Inventar tipo novo repetiria o erro do log
    // de atividades, que ja quebrou tres vezes neste projeto.
    await client.from('ocorrencias_prontuario').insert({
      sale_id,
      tipo: 'nota',
      titulo: tipo === 'mesmo_pacote' ? 'Compras juntadas no mesmo pacote' : tipo === 'compra_separada' ? 'Compras tratadas como pacotes separados' : 'Valor do pacote divergente',
      descricao: justificativa ? `${descricao}. Justificativa: ${justificativa}` : descricao,
      dados_extras: { sale_irma_id: sale_irma_id ?? null, tipo, diferenca: diferenca ?? null, paciente_paga_diferenca: paciente_paga_diferenca ?? null, havera_outra_compra: havera_outra_compra ?? null },
      criado_por_nome: nomeUsuario,
      criado_por_tipo: (usuario?.tipo as string) ?? 'admin',
      criado_por_email: usuario_email,
    })

    await registrarAtividade({
      usuario_nome: nomeUsuario,
      usuario_tipo: (usuario?.tipo as string) ?? 'admin',
      tipo_acao: 'nota',
      sale_id,
      descricao,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[vendas/pacote]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
