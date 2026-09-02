import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade, inferirNumeroSessoes, calcularComissao, brasiliaLocalToISO, isHojeBrasilia, normalizarTelefoneBR } from '@/lib/terapeutas-auth'
import { buscarConflitosAgenda, mensagemConflito } from '@/lib/agenda-conflitos'
import { criarEventoComMeet, cancelarEvento } from '@/lib/google-meet'
import { notificarEncaixe } from '@/lib/notificar-encaixe'
import { formatoDaVenda, montarPacote } from '@/lib/diagnostico-guiado'
import { planejarReagendamentoTotal, type SessaoExistente } from '@/lib/reagendamento-total'
import { buscarConflitosMultiTerapeuta } from '@/lib/agenda-conflitos'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sale_id, terapeuta_id, data_primeira_sessao, numero_sessoes, datas_sessoes, usuario_email, senha, token } = body as {
    sale_id: string
    terapeuta_id: string
    data_primeira_sessao: string
    numero_sessoes?: number
    datas_sessoes?: string[]
    usuario_email: string
    senha?: string
    token?: string
  }

  if (!sale_id || !terapeuta_id || !data_primeira_sessao || !usuario_email || (!senha && !token)) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  try {
  const acesso = await verificarAcesso({ usuario_email, senha, token })
  const { valido, usuario } = acesso
  if (!valido) {
    const { error, status } = erroAcesso(acesso)
    return NextResponse.json({ error }, { status })
  }

  const client = getSupabaseAdmin()

  // order_id entra na selecao so pra alimentar formatoDaVenda logo abaixo: os
  // demais produtos nunca leem esse campo, entao acrescenta-lo aqui nao muda
  // nada do caminho antigo.
  const { data: sale, error: saleErr } = await client
    .from('sales').select('id,nome,email,telefone,produto,valor_liquido,order_id').eq('id', sale_id).single()
  if (saleErr || !sale) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })

  const { data: terapeuta, error: terapErr } = await client
    .from('terapeutas').select('id,percentual_comissao,grupo_whatsapp_id').eq('id', terapeuta_id).single()
  if (terapErr || !terapeuta) return NextResponse.json({ error: 'Terapeuta não encontrado' }, { status: 404 })

  // Diagnostico Guiado: pacote com dois terapeutas. Detectado pela oferta.
  const diagnostico = formatoDaVenda(sale as { id: string; order_id?: string })

  // As datas do pacote do Diagnostico sao derivadas inteiramente da regua (7 em
  // 7 dias) e do formato (montarPacote), a partir de UMA data. Aceitar
  // datas_sessoes soltas aqui criaria um pacote com datas fora da regua que o
  // resto do sistema (remarcacao, telas, notificacao) nao sabe interpretar.
  // Recusa explicita em vez de ignorar em silencio: se o comercial digitou
  // datas especificas, ele precisa saber que elas nao foram usadas, em vez de
  // descobrir isso só olhando a agenda depois.
  if (diagnostico && datas_sessoes && datas_sessoes.length > 0) {
    return NextResponse.json(
      { error: 'O Diagnóstico Guiado monta as datas sozinho a partir da primeira sessão, com 7 dias entre elas. Envie apenas data_primeira_sessao.' },
      { status: 400 },
    )
  }

  let pedroId: string | null = null
  let deniseId: string | null = null
  if (diagnostico) {
    // .order('nome'): sem ordem explícita o PostgREST devolve as linhas na
    // ordem que quiser, e o laço abaixo sobrescreve a cada volta - com dois
    // terapeutas ativos que casem com o mesmo nome, qual deles fica com as
    // sessões mudaria de uma chamada pra outra, em silêncio. Ordenado, ao
    // menos é sempre o mesmo; e ambiguidade vira erro em vez de sorteio.
    const { data: ativos } = await client
      .from('terapeutas').select('id,nome').eq('ativo', true).order('nome', { ascending: true })
    const candidatosPedro: { id: string; nome: string }[] = []
    const candidatosDenise: { id: string; nome: string }[] = []
    for (const t of (ativos ?? []) as { id: string; nome: string }[]) {
      const n = t.nome.toLowerCase()
      if (n.includes('pedro')) candidatosPedro.push(t)
      if (n.includes('denise')) candidatosDenise.push(t)
    }
    // Match por substring é frágil por natureza (homônimo, sobrenome que
    // contenha o nome). Se houver mais de um candidato, ninguém aqui tem
    // como escolher certo: recusa e diz quem colidiu, pra alguém desativar
    // ou renomear o cadastro duplicado.
    const ambiguo = [
      candidatosPedro.length > 1 ? `Pedro (${candidatosPedro.map(t => t.nome).join(', ')})` : null,
      candidatosDenise.length > 1 ? `Denise (${candidatosDenise.map(t => t.nome).join(', ')})` : null,
    ].filter(Boolean)
    if (ambiguo.length > 0) {
      return NextResponse.json(
        { error: `Mais de um terapeuta ativo bate com o nome esperado do Diagnóstico Guiado: ${ambiguo.join(' e ')}. Ajuste o cadastro antes de agendar.` },
        { status: 409 },
      )
    }
    pedroId = candidatosPedro[0]?.id ?? null
    deniseId = candidatosDenise[0]?.id ?? null
    if (!pedroId || !deniseId) {
      return NextResponse.json(
        { error: 'Diagnostico Guiado precisa do Pedro e da Denise ativos como terapeutas.' },
        { status: 409 },
      )
    }
  }

  // O nome do produto nem sempre indica o pacote real (ex: "Mentoria Particular -
  // Pedro | Denise" é usado pra pacotes de 1/2/4/8 sessões sem diferenciação no
  // nome), então a tela de agendamento permite sobrescrever o valor inferido.
  const numSessoes = numero_sessoes && numero_sessoes > 0
    ? Math.floor(numero_sessoes)
    : inferirNumeroSessoes(sale.produto as string)
  // No Diagnóstico a comissão NÃO sai do percentual do terapeuta: é valor fixo
  // por sessão, regra do produto (Denise R$ 95, Pedro zero por ser sócio), e
  // quem aplica isso é montarPacote. Rodar calcularComissao aqui produzia um
  // número que não é pago a ninguém e que ia parar no log de auditoria como se
  // fosse o valor real do pacote.
  const comissao_por_sessao = diagnostico
    ? 0
    : calcularComissao({
        valor_liquido: sale.valor_liquido as number,
        percentual: terapeuta.percentual_comissao as number,
        numero_sessoes: numSessoes,
      }).comissao_por_sessao

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

  // Reagendamento total: esta venda já tem sessões e confirmar aqui significa
  // apagar as pendentes, cancelar os convites do paciente e recriar o pacote.
  // A checagem vem ANTES do conflito de agenda, do delete e de qualquer
  // chamada ao Google porque a recusa por sessão entregue é definitiva: o
  // insert lá embaixo recria a numeração a partir da 1 e bate no unique
  // (sale_id, numero_sessao), só que aí as pendentes já teriam sido apagadas e
  // os convites já teriam sido cancelados - erro de banco na tela e pacote
  // pela metade, sem volta. Vale pra todo produto, não só pro Diagnóstico.
  const { data: sessoesDaVenda, error: sessoesErr } = await client
    .from('sessoes').select('id,status,numero_sessao,google_event_id').eq('sale_id', sale_id)
  if (sessoesErr) return NextResponse.json({ error: sessoesErr.message }, { status: 500 })
  const plano = planejarReagendamentoTotal((sessoesDaVenda ?? []) as SessaoExistente[])
  if (!plano.ok) return NextResponse.json({ error: plano.erro }, { status: 400 })
  const substituidas = plano.substituir

  // Trava de conflito ANTES de apagar qualquer coisa: um conflito no meio do
  // pacote não pode destruir o agendamento que já existia. Ignora as sessões
  // da própria venda, que são justamente as que serão recriadas logo abaixo.
  // primeiraDataMs já passou por brasiliaLocalToISO acima: usar
  // data_primeira_sessao crua aqui reincidiria no mesmo bug que esse
  // tratamento existe pra evitar (ambiguidade de fuso dependente do
  // runtime do servidor).
  const pacote = diagnostico
    ? montarPacote({ formato: diagnostico, primeiraDataISO: new Date(primeiraDataMs).toISOString(), pedroId: pedroId!, deniseId: deniseId! })
    : null

  const conflitos = pacote
    ? await buscarConflitosMultiTerapeuta({
        itens: pacote.map(s => ({ terapeuta_id: s.terapeuta_id, dataISO: s.data_agendada })),
        ignorarSaleId: sale_id,
      })
    : await buscarConflitosAgenda({
        terapeuta_id,
        datasISO: Array.from({ length: numSessoes }, (_, i) =>
          datasExplicitas ? datasExplicitas[i] : new Date(primeiraDataMs + i * SETE_DIAS_MS).toISOString()),
        ignorarSaleId: sale_id,
      })
  if (conflitos.length > 0) {
    // Pacote inteiro recusado, nada criado: agendar só parte deixaria o
    // paciente com um pacote incompleto que alguém precisa lembrar de fechar.
    return NextResponse.json({ error: mensagemConflito(conflitos), conflitos }, { status: 409 })
  }

  // Deletar sessões existentes que ainda não foram entregues (reagendamento total)
  //
  // Antes de apagar, desamarra as ocorrências do prontuário dessas sessões.
  // ocorrencias_prontuario.sessao_id tem chave estrangeira pra sessoes, então
  // qualquer sessão que já tenha remarcação, orientação ou "não compareceu"
  // registrados trava o delete com 23503. O erro não era conferido, o delete
  // seguia adiante sem apagar nada e o insert logo abaixo batia no unique
  // (sale_id, numero_sessao), devolvendo "duplicate key value violates unique
  // constraint" - uma mensagem que não diz nada pra quem está na tela e some
  // do rastro. Vale pra qualquer produto, não só pro Diagnóstico.
  //
  // O histórico clínico NÃO se perde: a ocorrência continua amarrada ao
  // sale_id, que é por onde o prontuário lista tudo. Só perde o vínculo com a
  // sessão específica, que a partir daqui deixa de existir mesmo.
  const idsASubstituir = substituidas.map(s => s.id)
  if (idsASubstituir.length > 0) {
    const { error: desamarrarErr } = await client.from('ocorrencias_prontuario')
      .update({ sessao_id: null }).in('sessao_id', idsASubstituir)
    if (desamarrarErr) return NextResponse.json({ error: desamarrarErr.message }, { status: 500 })
  }
  // Apaga PRIMEIRO, cancela no Google DEPOIS. Na ordem inversa (que era a de
  // antes), um delete que falhasse deixava as sessões vivas no banco apontando
  // para eventos que não existem mais: o paciente perdia o convite e ninguém
  // via nada de errado na tela. Falhar o delete agora é inofensivo, porque o
  // convite antigo continua de pé junto com a sessão antiga.
  if (idsASubstituir.length > 0) {
    const { error: deleteErr } = await client.from('sessoes').delete().in('id', idsASubstituir)
    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }
  // Cancela no Google os eventos das sessões que sumiram. Sem isso o
  // reagendamento total deixava os eventos antigos no calendário para sempre:
  // as sessões novas eram criadas com eventos novos e ninguém apagava os
  // velhos, então o terapeuta via o pacote inteiro duplicado, na data antiga e
  // na nova. Medido criando e refazendo um pacote de teste: 9 eventos órfãos.
  for (const s of substituidas) {
    if (s.google_event_id) await cancelarEvento(s.google_event_id)
  }
  const base = {
    sale_id,
    status: 'agendada',
    status_consulta: 'aguardando',
    link_meet: null,
    comissao_paga: false,
    paciente_nome: sale.nome as string,
    paciente_email: sale.email as string,
    agendado_por: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
    vendedor_nome: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
    vendedor_email: usuario_email,
  }

  const sessoes = pacote
    ? pacote.map(s => ({
        ...base,
        terapeuta_id: s.terapeuta_id,
        numero_sessao: s.numero_sessao,
        total_sessoes: pacote.length,
        data_agendada: s.data_agendada,
        comissao_valor: s.comissao_valor,
      }))
    : Array.from({ length: numSessoes }, (_, i) => ({
        ...base,
        terapeuta_id,
        numero_sessao: i + 1,
        total_sessoes: numSessoes,
        data_agendada: datasExplicitas ? datasExplicitas[i] : new Date(primeiraDataMs + i * SETE_DIAS_MS).toISOString(),
        comissao_valor: comissao_por_sessao,
      }))

  const { error: insertErr } = await client.from('sessoes').insert(sessoes)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // numSessoes continua sendo a entrada do calculo do caminho antigo (comissao
  // por sessao, tamanho do array de datas) e não muda. totalCriado é o que
  // realmente foi gravado: pro Diagnostico, pacote.length (2, 4 ou 9) nunca é
  // igual a numSessoes (que vem de inferirNumeroSessoes/override e não
  // enxerga o formato do pacote) - usar numSessoes aqui pra log/resposta
  // reportaria um número de sessões que não bate com o que foi criado.
  const totalCriado = sessoes.length

  // Link do Meet — não trava o agendamento se a API do Google falhar (ver
  // lib/google-meet.ts: sem credenciais configuradas, isso é um no-op).
  for (const s of sessoes) {
    const evento = await criarEventoComMeet({
      titulo: `Sessão — ${s.paciente_nome}`,
      inicioISO: s.data_agendada,
      fimISO: new Date(new Date(s.data_agendada).getTime() + 60 * 60 * 1000).toISOString(),
    })
    if (evento) {
      const { error: linkErr } = await client.from('sessoes')
        .update({ link_meet: evento.meetLink, google_event_id: evento.eventId })
        .eq('sale_id', sale_id).eq('numero_sessao', s.numero_sessao)
      // Evento já foi criado no Google nesse ponto — se salvar falhar, o
      // evento fica órfão (existe no Calendar mas sem referência no banco).
      // Loga pra dar pra achar/limpar depois; não trava o agendamento.
      if (linkErr) console.error('[agendar] falha ao salvar link_meet:', linkErr)
    }
    // Sessão marcada pro mesmo dia — "venda de encaixe": o fluxo normal de
    // véspera (só olha "amanhã") nunca ia pegar essa. Avisa na hora, fora do
    // cron, com o link do Meet já embutido (evento acabou de ser criado acima).
    // Só dispara quando é agendamento de sessão avulsa (totalCriado === 1) -
    // agendar um pacote inteiro (totalCriado > 1) é reorganização de agenda,
    // não "última hora": se algumas datas do lote caírem em hoje (comum ao
    // recriar histórico ou preencher datas retroativas), isso já disparava
    // um "Venda de Encaixe" por sessão, alarme falso pra paciente que já
    // existia - confundiu o terapeuta. Usa totalCriado (não numSessoes) pra
    // valer também pro Diagnóstico: o pacote nunca tem 1 sessão só (mínimo é
    // 2), então esse gate corretamente nunca dispara pra ele.
    if (totalCriado === 1 && isHojeBrasilia(s.data_agendada)) {
      const { data: sessaoCriada } = await client.from('sessoes')
        .select('id,link_meet').eq('sale_id', sale_id).eq('numero_sessao', s.numero_sessao).single()
      await notificarEncaixe({
        sessao_id: sessaoCriada?.id ?? '',
        terapeuta_id,
        grupo_whatsapp_id: terapeuta.grupo_whatsapp_id as string | null,
        paciente_nome: s.paciente_nome,
        paciente_telefone: normalizarTelefoneBR(sale.telefone as string | null),
        numero_sessao: s.numero_sessao,
        total_sessoes: s.total_sessoes,
        data_agendada: s.data_agendada,
        link_meet: sessaoCriada?.link_meet ?? evento?.meetLink ?? null,
      })
    }
  }

  await registrarAtividade({
    usuario_nome: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
    usuario_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial',
    tipo_acao: 'agendamento',
    sale_id,
    descricao: `${totalCriado} sessões agendadas para ${sale.nome} - primeira em ${new Date(primeiraDataMs).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    // No Diagnóstico o log grava o que foi realmente gravado em
    // sessoes.comissao_valor (um valor por terapeuta), não um "por sessão"
    // único que não existe nesse produto.
    dados_novos: pacote
      ? {
          numSessoes: totalCriado,
          data_primeira_sessao,
          terapeuta_id,
          diagnostico_formato: diagnostico?.formato,
          comissao_por_sessao_pedro: pacote.find(s => s.terapeuta_id === pedroId)?.comissao_valor ?? 0,
          comissao_por_sessao_denise: pacote.find(s => s.terapeuta_id === deniseId)?.comissao_valor ?? 0,
          comissao_total_pacote: pacote.reduce((a, s) => a + s.comissao_valor, 0),
        }
      : { numSessoes: totalCriado, data_primeira_sessao, terapeuta_id, comissao_por_sessao },
  })

  return NextResponse.json({ success: true, sessoes_criadas: totalCriado })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
