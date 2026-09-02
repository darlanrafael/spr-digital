import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'
import { buscarConflitosMultiTerapeuta, mensagemConflito } from '@/lib/agenda-conflitos'
import { novasDatasSeguintes, formatoDaVenda } from '@/lib/diagnostico-guiado'
import { criarEventoComMeet, cancelarEvento, integracaoCalendarAtiva } from '@/lib/google-meet'

// Sem `maxDuration` declarado, a Vercel corta a função em 10 s. Esta rota fala
// com o Google Calendar duas vezes por sessão movida (cancelar o evento antigo
// e criar o novo, com Meet), e num Formato 1 são até 8 sessões: latência medida
// com as credenciais do projeto, 877 ms na primeira chamada (autenticação) e
// ~349 ms por round trip depois, com o insert com conferenceData mais pesado
// que o resto. Dava de 10 a 13 s só no laço. O upsert das datas é commitado
// ANTES dele, então o corte deixava as datas novas certas e parte das sessões
// apontando pro evento velho: o paciente com convite e link do Meet no horário
// antigo, e a tela mostrando erro genérico sem dizer o que ficou pela metade.
export const maxDuration = 60

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

  // try/catch externo, igual ao que /agendar e /remarcar ganharam nesta
  // branch. Sem ele, qualquer exceção não prevista (rede caindo no meio de
  // uma consulta, resposta estranha do Google, erro de tipo) virava um 500
  // sem JSON: a tela caía no `json.error ?? 'Não foi possível empurrar as
  // seguintes.'` e a pessoa ficava sem saber o que aconteceu nem o que já
  // tinha sido movido.
  try {
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

  // Sem data na sessão-base não existe régua pra empurrar: new Date(null) vira
  // 1970 e o pacote inteiro seria remarcado pra 51 anos atrás, em silêncio.
  // Sessão sem data existe de verdade (status 'pendente' criado por
  // lançamento manual antigo), então isso não é hipótese.
  if (!sessao.data_agendada) {
    return NextResponse.json(
      { error: 'A sessão remarcada está sem data. Marque a data dela antes de empurrar as seguintes.' },
      { status: 400 },
    )
  }

  // Trava de produto. A régua de 7 dias é regra do Diagnóstico Guiado, não do
  // sistema: medido no banco em 01/09/2026, 123 pacotes de outros produtos têm
  // 2 ou mais sessões e 41 deles (33%) já têm um par com menos de 7 dias entre
  // as sessões - ou seja, uma Mentoria Particular remarcada dispara o aviso
  // com frequência, e um clique aqui reescreveria as datas dela pra uma régua
  // que aquele produto nunca seguiu, mexendo em consultas já combinadas com o
  // paciente. Só pacote do Diagnóstico (reconhecido pela oferta) passa.
  const { data: vendaMae, error: vendaErr } = await client
    .from('sales').select('id,order_id').eq('id', sessao.sale_id).maybeSingle()
  if (vendaErr) return NextResponse.json({ error: vendaErr.message }, { status: 500 })
  if (!vendaMae || !formatoDaVenda(vendaMae as { id: string; order_id?: string })) {
    return NextResponse.json(
      { error: 'Empurrar as seguintes vale só para o Diagnóstico Guiado, que tem 7 dias fixos entre as sessões. Neste produto, remarque uma sessão de cada vez.' },
      { status: 400 },
    )
  }

  // Esta rota é a segunda decisão do fluxo: a sessão do meio já foi remarcada
  // e salva por /remarcar. Aqui só empurramos as que vêm DEPOIS dela no mesmo
  // pacote, ainda não entregues nem canceladas - sessão entregue é histórico,
  // não pode ser movida, e cancelada não existe mais pro paciente.
  const { data: seguintes, error: seguintesErr } = await client
    .from('sessoes').select('id,terapeuta_id,numero_sessao,total_sessoes,paciente_nome,paciente_email,data_agendada,google_event_id')
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

  // Uma única instrução em vez do for sequencial anterior: se uma sessão
  // falhasse no meio do loop, metade do pacote ficava movida e metade não -
  // exatamente o cenário que o dono do produto descreveu como pior que não
  // mover nada. upsert com onConflict:'id' vira um único INSERT ... ON
  // CONFLICT DO UPDATE, que o Postgres executa como uma instrução só: se
  // qualquer linha do lote falhar, nenhuma é alterada (testado contra o banco
  // real com um lote de 2 linhas, uma delas inválida de propósito - a outra,
  // que seria aplicada sem erro sozinha, também não mudou).
  //
  // O payload de cada linha precisa incluir sale_id, terapeuta_id,
  // numero_sessao, total_sessoes, paciente_nome e paciente_email (as colunas
  // NOT NULL sem default da tabela) mesmo repassando o valor que a linha já
  // tem: o Postgres valida essas colunas ao montar a linha ANTES de checar se
  // há conflito, então omitir qualquer uma delas derruba o upsert inteiro com
  // "violates not-null constraint", mesmo que o conflito vá cair sempre no
  // UPDATE. Colunas fora do payload (status, comissão, link_meet etc.) não
  // entram no SET do UPDATE e ficam intactas - confirmado numa linha
  // sintética descartável criada e apagada pelo próprio teste, comparando
  // todas as colunas antes/depois.
  const agora = new Date().toISOString()
  const { error: updateErr } = await client.from('sessoes').upsert(
    seguintes.map((s, i) => ({
      id: s.id,
      sale_id: sessao.sale_id as string,
      terapeuta_id: s.terapeuta_id as string,
      numero_sessao: s.numero_sessao as number,
      total_sessoes: s.total_sessoes as number,
      paciente_nome: s.paciente_nome as string,
      paciente_email: s.paciente_email as string,
      data_agendada: novasDatas[i],
      updated_at: agora,
    })),
    { onConflict: 'id' }
  )
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email
  const usuarioTipo = (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial'

  // Mesmo tratamento do /remarcar: cancela o evento antigo e cria um novo, em
  // vez de só mexer na data do banco. Sem isso o paciente continuava com o
  // convite e o link do Meet no horário ANTIGO de cada sessão empurrada - num
  // Formato 1 são até 8 sessões erradas de uma vez. Fora da transação de
  // propósito: o Google pode falhar (ou estar desligado, ver
  // lib/google-meet.ts) e isso não pode desfazer as datas já salvas.
  //
  // Em lotes paralelos, não uma sessão de cada vez: sequencial são 3 idas e
  // voltas por sessão somadas uma na outra, o que estourava o tempo da função
  // (ver maxDuration no topo). Promise.allSettled em vez de Promise.all porque
  // uma sessão que falhe não pode impedir as outras de terem o convite
  // refeito - e o que falhou volta na resposta, em vez de sumir num log que
  // ninguém lê. Lote de 4 pra não disparar rate limit da API do Google nem
  // abrir 8 conexões de uma vez.
  const LOTE_CALENDAR = 4
  const falhasCalendar: { numero_sessao: number; motivo: string }[] = []
  // Evento criado sem o link do Meet ainda (conferência sendo provisionada)
  // não é falha: o convite existe na agenda e o link aparece depois. Fica
  // separado pra tela não dizer que o paciente ficou sem convite.
  const linksPendentes: number[] = []
  // Integração desligada é modo documentado do módulo (ver lib/google-meet.ts),
  // não incidente: sem as 3 variáveis de ambiente as sessões continuam sendo
  // movidas, só que sem link. Tratar esse null como erro fazia toda remarcação
  // em cadeia acusar N pacientes sem convite se uma variável sumisse da Vercel.
  //
  // O laço inteiro fica de fora nesse modo, e não só o aviso: rodando, ele
  // gravaria link_meet e google_event_id nulos sem ter cancelado nada (o
  // cancelamento também é no-op), apagando a referência de eventos que
  // continuam existindo no Calendar - órfãos que ninguém mais consegue achar
  // pra limpar. Não mexer preserva a informação até a integração voltar.
  const calendarAtivo = integracaoCalendarAtiva()
  for (let inicio = 0; calendarAtivo && inicio < seguintes.length; inicio += LOTE_CALENDAR) {
    const lote = seguintes.slice(inicio, inicio + LOTE_CALENDAR)
    const resultados = await Promise.allSettled(lote.map(async (s, j) => {
      const i = inicio + j
      if (s.google_event_id) {
        await cancelarEvento(s.google_event_id as string)
      }
      const evento = await criarEventoComMeet({
        titulo: `Sessão - ${s.paciente_nome}`,
        inicioISO: novasDatas[i],
        fimISO: new Date(new Date(novasDatas[i]).getTime() + 60 * 60 * 1000).toISOString(),
      })
      // Grava antes de reclamar do evento que não veio: o antigo já foi
      // cancelado, então manter o google_event_id velho no banco apontaria
      // pra um evento que não existe mais.
      const { error: linkErr } = await client.from('sessoes')
        .update({ link_meet: evento?.meetLink ?? null, google_event_id: evento?.eventId ?? null })
        .eq('id', s.id)
      // Evento novo já existe no Google nesse ponto - se salvar falhar, ele
      // fica órfão (existe no Calendar sem referência no banco).
      if (linkErr) throw new Error(`o link do Meet novo não foi salvo no banco (${linkErr.message})`)
      // Aqui null é falha de verdade: o gate do laço já tirou o caso desligado.
      // Evento sem link é caso à parte, e não falha: o google_event_id já foi
      // salvo no update acima, então o evento não vira órfão.
      if (!evento) throw new Error('o Google não devolveu o convite novo')
      if (!evento.meetLink) linksPendentes.push(s.numero_sessao as number)
    }))
    resultados.forEach((r, j) => {
      if (r.status === 'rejected') {
        falhasCalendar.push({ numero_sessao: lote[j].numero_sessao as number, motivo: String(r.reason?.message ?? r.reason) })
        console.error(`[empurrar-seguintes] sessão ${lote[j].numero_sessao}:`, r.reason)
      }
    })
  }

  // Rastro clínico no prontuário, uma linha por sessão movida. Antes só
  // atividades_log era gravado (e ele nem aceitava 'empurrar_seguintes', ver
  // a migration 20260901000000), então de 4 a 8 sessões mudavam de dia sem
  // deixar nenhum registro na aba que o terapeuta realmente lê.
  // tipo 'remarcacao' porque é literalmente o que aconteceu com cada uma, e
  // porque o check constraint de ocorrencias_prontuario.tipo não conhece
  // nenhum tipo novo - inventar um aqui repetiria o erro do log de atividades.
  const ocorrencias = seguintes.map((s, i) => {
    const anteriorFmt = s.data_agendada
      ? new Date(s.data_agendada as string).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'sem data'
    const novaFmt = new Date(novasDatas[i]).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    return {
      sale_id: sessao.sale_id,
      sessao_id: s.id,
      tipo: 'remarcacao',
      titulo: `Remarcação em cadeia - Sessão ${s.numero_sessao}`,
      descricao: `Empurrada junto com a remarcação da sessão ${sessao.numero_sessao}, para manter os 7 dias do Diagnóstico Guiado. De ${anteriorFmt} para ${novaFmt}.`,
      dados_extras: {
        sessao_id: s.id,
        motivo: 'empurrar_seguintes',
        origem_sessao_id: sessao_id,
        origem_numero_sessao: sessao.numero_sessao,
        data_anterior: s.data_agendada,
        nova_data: novasDatas[i],
      },
      criado_por_nome: usuarioNome,
      criado_por_tipo: usuarioTipo,
      criado_por_email: usuario_email,
    }
  })
  const { error: ocErr } = await client.from('ocorrencias_prontuario').insert(ocorrencias)
  // Não derruba a resposta: as sessões já foram movidas e o Calendar já foi
  // atualizado. Loga pra não sumir em silêncio, que foi o defeito original.
  if (ocErr) console.error('[empurrar-seguintes] falha ao gravar no prontuário:', ocErr)

  await registrarAtividade({
    usuario_nome: usuarioNome,
    usuario_tipo: usuarioTipo,
    tipo_acao: 'empurrar_seguintes',
    sessao_id,
    sale_id: sessao.sale_id as string,
    descricao: `${seguintes.length} sessão(ões) seguinte(s) de ${sessao.paciente_nome} empurradas para manter os 7 dias, a partir da sessão ${sessao.numero_sessao}`,
    dados_novos: { movidas: seguintes.length, novasDatas },
  })

  // As datas JÁ estão salvas mesmo com falha no Google, e é assim que tem que
  // ser (o Calendar pode estar fora do ar e isso não pode desfazer a agenda).
  // O que não podia continuar é a tela dizer "tudo certo" quando parte dos
  // pacientes ficou sem convite novo.
  const numerosComFalha = falhasCalendar.map(f => f.numero_sessao).sort((a, b) => a - b)
  const numerosPendentes = linksPendentes.slice().sort((a, b) => a - b)
  const avisos: string[] = []
  if (falhasCalendar.length > 0) {
    avisos.push(`As datas foram salvas, mas o convite do Google não foi refeito em ${falhasCalendar.length} sessão(ões) (sessão ${numerosComFalha.join(', ')}). Esse(s) paciente(s) pode(m) estar sem convite na data nova: remarque essa(s) sessão(ões) de novo ou avise o time técnico.`)
  }
  if (numerosPendentes.length > 0) {
    avisos.push(`O convite novo foi criado no Google Agenda em ${numerosPendentes.length} sessão(ões) (sessão ${numerosPendentes.join(', ')}), mas o link do Meet ainda não estava pronto. O evento existe na agenda: o link deve aparecer em alguns minutos.`)
  }
  return NextResponse.json({
    success: true,
    movidas: seguintes.length,
    calendario_falhas: falhasCalendar,
    calendario_links_pendentes: numerosPendentes,
    aviso: avisos.length === 0 ? null : avisos.join(' '),
  })
  } catch (err) {
    console.error('[empurrar-seguintes]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
