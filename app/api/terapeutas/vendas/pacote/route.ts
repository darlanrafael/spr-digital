import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'
import { MARCA_DESFAZER } from '@/lib/conferencia-de-pacote'
import { avaliarLigacao, desfazerLinkSeAuditoriaFalhar, refazerLinkSeAuditoriaFalhar, type VendaParaLigar, type Veredicto } from '@/lib/ligacao-de-pacote'

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
// Lista as respostas do comercial, para o CEO conferir.
//
// O pedido do usuário era "registrar uma ocorrência e notificar pra mim em
// solicitações, assim como já acontece com os reembolsos". Sem esta rota a
// tabela era write-only: gravava e ninguém lia, então a metade da feature que
// existe para o CEO enxergar não existia de fato.
export async function GET(req: NextRequest) {
  try {
    const client = getSupabaseAdmin()

    // A lista traz nome do paciente, produto e a `justificativa` de texto livre
    // que o comercial digita sobre ele - o campo mais sensível do módulo. Sem
    // nenhuma checagem, bastava a URL.
    //
    // A checagem é por usuário ATIVO, não por senha nem por token, e isso é uma
    // escolha consciente: a tela de Aprovações guarda só `{nome, email, tipo}`
    // em `localStorage`, sem token, e `verificarAcesso` por token só passa para
    // quem tem `dispensa_senha_nas_acoes`. Exigir qualquer um dos dois deixaria
    // a conferência do CEO inacessível para ele mesmo.
    //
    // O que isto protege: varredura anônima da URL. O que NÃO protege: alguém
    // que saiba um e-mail cadastrado. As rotas GET de /vendas e /aprovacoes têm
    // exatamente a mesma lacuna e precisam da mesma decisão - autenticação de
    // GET neste módulo é item aberto, registrado no spr-digital.md.
    const email = (req.nextUrl.searchParams.get('usuario_email') ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Informe o usuário.' }, { status: 401 })
    const { data: quem } = await client
      .from('usuarios_sistema').select('id').ilike('email', email).eq('ativo', true).maybeSingle()
    if (!quem) return NextResponse.json({ error: 'Usuário não autorizado.' }, { status: 401 })
    const { data, error } = await client
      .from('ocorrencias_pacote')
      // Colunas nomeadas, nao `*`: o dia em que a tabela ganhar uma coluna
      // nova, ela nao vaza sozinha por esta rota.
      .select('id,sale_id,sale_irma_id,paciente_nome,produto,tipo,diferenca,sessoes_do_pacote,paciente_paga_diferenca,havera_outra_compra,justificativa,respondido_por_nome,created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ocorrencias: data ?? [] })
  } catch (err) {
    console.error('[vendas/pacote GET]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

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

    let veredictoDoLink: Veredicto = { acao: 'so_registrar' }
    // A rota NÃO confia na tela. Ligar duas vendas erradas dá ao paciente menos
    // sessões do que ele pagou e some com a segunda compra de Pendentes, então
    // cada condição é conferida aqui também. O I/O fica aqui; a DECISÃO fica em
    // lib/ligacao-de-pacote.ts, onde os testes a alcançam.
    if (sale_irma_id) {
      const { data: irma } = await client
        .from('sales').select('id, pacote_pai_id, email, produto, status, data_hora').eq('id', sale_irma_id as string).single()
      const i = (irma ?? null) as VendaParaLigar | null
      let irmaTemFilhas = false, irmaTemSessoes = false
      // As duas contagens só interessam para LIGAR. Numa resposta de "compras
      // separadas" elas seriam duas idas ao banco sem uso.
      if (i && tipo === 'mesmo_pacote') {
        const { data: filhas, error: fErr } = await client
          .from('sales').select('id').eq('pacote_pai_id', sale_irma_id as string).limit(1)
        if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })
        irmaTemFilhas = (filhas ?? []).length > 0
        const { data: sessoesIrma, error: sErr } = await client
          .from('sessoes').select('id').eq('sale_id', sale_irma_id as string).limit(1)
        if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
        irmaTemSessoes = (sessoesIrma ?? []).length > 0
      }
      veredictoDoLink = avaliarLigacao({
        tipo, irmaId: sale_irma_id ?? null,
        venda: venda as VendaParaLigar, irma: i, irmaTemFilhas, irmaTemSessoes,
      })
      if (veredictoDoLink.acao === 'recusar') {
        return NextResponse.json({ error: veredictoDoLink.erro }, { status: veredictoDoLink.status })
      }
      if (veredictoDoLink.acao === 'ligar') {
        const { error: upErr } = await client
          .from('sales').update({ pacote_pai_id: sale_id }).eq('id', sale_irma_id as string)
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
      }
      if (veredictoDoLink.acao === 'desligar') {
        const { error: upErr } = await client
          .from('sales').update({ pacote_pai_id: null }).eq('id', sale_irma_id as string)
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
      }
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
      // A retratação (respondeu "mesmo pacote", o agendamento falhou, trocou
      // para "compra separada") carrega a marca do desfazer: sem ela o CEO lia
      // "Compras separadas" e concluía que foi resposta do comercial, quando na
      // verdade uma junção já registrada foi anulada.
      justificativa: veredictoDoLink.acao === 'desligar'
        ? `${MARCA_DESFAZER}: a resposta mudou para "compras separadas".${justificativa ? ` ${justificativa}` : ''}`
        : justificativa ?? null,
      respondido_por_nome: nomeUsuario,
      respondido_por_email: usuario_email,
    })
    if (ocErr) {
      // Sem auditoria o link nao pode ficar de pe: o CEO nao teria como saber
      // que duas compras foram juntadas, e nao ha tela que desfaca. Mas so o
      // link criado NESTA tentativa e desfeito - ver
      // desfazerLinkSeAuditoriaFalhar em lib/ligacao-de-pacote.ts.
      if (desfazerLinkSeAuditoriaFalhar(veredictoDoLink) && sale_irma_id) {
        const { error: rbErr } = await client.from('sales').update({ pacote_pai_id: null }).eq('id', sale_irma_id)
        if (rbErr) console.error('[vendas/pacote] rollback do link falhou', sale_irma_id, rbErr.message)
      }
      if (refazerLinkSeAuditoriaFalhar(veredictoDoLink) && sale_irma_id) {
        const { error: rbErr } = await client.from('sales').update({ pacote_pai_id: sale_id }).eq('id', sale_irma_id)
        if (rbErr) console.error('[vendas/pacote] rollback do desligamento falhou', sale_irma_id, rbErr.message)
      }
      return NextResponse.json({ error: ocErr.message }, { status: 500 })
    }

    const descricao =
      tipo === 'mesmo_pacote'
        ? `Compras juntadas no mesmo pacote${sessoes_do_pacote ? ` (${sessoes_do_pacote} sessões)` : ''}, respondido por ${nomeUsuario}`
        : tipo === 'compra_separada'
          ? `Compras tratadas como pacotes separados, respondido por ${nomeUsuario}${veredictoDoLink.acao === 'desligar' ? ' (a ligação anterior entre elas foi desfeita)' : ''}`
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

// Desfaz a ligação entre duas compras.
//
// Existe porque um clique errado em "É o mesmo pacote" fazia a venda sumir de
// Pendentes, do dashboard e da tela do terapeuta, sem nenhuma tela mostrando
// que ela virou filha de outra - a única saída seria cirurgia no banco.
export async function DELETE(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { sale_id, usuario_email, senha, token } = body as {
    sale_id: string
    usuario_email: string
    senha?: string
    token?: string
  }
  if (!sale_id || !usuario_email || (!senha && !token)) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
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
      .from('sales').select('id, nome, produto, pacote_pai_id').eq('id', sale_id).single()
    if (vErr || !venda) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })

    const v = venda as { nome: string; produto: string; pacote_pai_id?: string | null }
    if (!v.pacote_pai_id) {
      return NextResponse.json({ error: 'Esta venda não faz parte de outro pacote.' }, { status: 400 })
    }

    // O pacote JÁ MONTADO não pode ser desfeito por aqui.
    //
    // As sessões da venda-pai foram criadas contando as duas compras, e a
    // comissão gravada em cada uma saiu do líquido do pacote inteiro. Desligar
    // sem tocar nelas deixa o pai com 8 sessões sustentadas por uma compra que
    // vale 4, devolve a filha a Pendentes com o botão "Agendar" ativo, e o
    // paciente termina com 8 + 4 = 12 sessões tendo pago 8 - com a comissão do
    // pacote inteiro nas primeiras e uma comissão nova por cima nas últimas.
    // Dimensionado no par real do Fábio Nery (R$ 700 + R$ 700, Denise a 30%):
    // R$ 531,15 no lugar de R$ 354,10, 50% a mais.
    //
    // O "Separar" existe para o clique errado em "É o mesmo pacote" - estado em
    // que o pai ainda não tem sessão nenhuma - e nesse estado ele continua
    // funcionando. Depois de agendado, desfazer é anular as sessões primeiro.
    const { data: sessoesDoPai, error: sErr } = await client
      .from('sessoes').select('id').eq('sale_id', v.pacote_pai_id)
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    const qtdSessoes = (sessoesDoPai ?? []).length
    if (qtdSessoes > 0) {
      return NextResponse.json({
        error: `O pacote já foi agendado: a venda principal tem ${qtdSessoes} ${qtdSessoes === 1 ? 'sessão criada' : 'sessões criadas'}, e elas contam as duas compras. Separar agora deixaria o paciente com sessões a mais e a comissão em dobro. Anule ou reagende as sessões da venda principal antes de separar as compras.`,
      }, { status: 409 })
    }

    const { error: upErr } = await client
      .from('sales').update({ pacote_pai_id: null }).eq('id', sale_id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const descricao = `${MARCA_DESFAZER} por ${nomeUsuario}. Ela volta para Pendentes de Agendamento.`
    // `sale_id` é o PAI e `sale_irma_id` é a outra compra, na mesma direção do
    // POST. Antes estava invertido: quem consultasse `ocorrencias_pacote` pelo
    // id do pai - que é para isso que o índice existe - encontrava a junção e
    // nunca o desfazer que a anulou.
    const { error: ocErr } = await client.from('ocorrencias_pacote').insert({
      sale_id: v.pacote_pai_id,
      sale_irma_id: sale_id,
      paciente_nome: v.nome,
      produto: v.produto,
      tipo: 'compra_separada',
      justificativa: descricao,
      respondido_por_nome: nomeUsuario,
      respondido_por_email: usuario_email,
    })
    if (ocErr) {
      // Simétrico ao POST: sem auditoria o desligamento não pode ficar de pé.
      // Antes o erro era ignorado e a rota devolvia `success` de qualquer jeito
      // - desligar sem registro nenhum passava em silêncio.
      const { error: rbErr } = await client.from('sales').update({ pacote_pai_id: v.pacote_pai_id }).eq('id', sale_id)
      if (rbErr) console.error('[vendas/pacote DELETE] rollback falhou', sale_id, rbErr.message)
      return NextResponse.json({ error: ocErr.message }, { status: 500 })
    }

    // A nota de prontuário do POST ("Compras juntadas no mesmo pacote") fica
    // gravada para sempre. Sem esta, o prontuário - que é o registro que o
    // terapeuta e o comercial leem - continuava dizendo que as compras estão
    // juntas depois de elas terem sido separadas.
    await client.from('ocorrencias_prontuario').insert({
      sale_id: v.pacote_pai_id,
      tipo: 'nota',
      titulo: 'Compras separadas: ligação desfeita',
      descricao,
      dados_extras: { sale_irma_id: sale_id, tipo: 'desfazer_pacote' },
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
    console.error('[vendas/pacote DELETE]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
