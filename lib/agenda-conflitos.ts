import { getSupabaseAdmin } from '@/lib/supabase'
import { fimEfetivoSessao } from '@/lib/agenda-horarios'

// Trava de conflito de horário na agenda do terapeuta.
//
// Até 11/08/2026 não existia nenhuma: nem `agendar` nem `remarcar` olhavam se
// o horário já estava ocupado, e a tela só avisava no lançamento de
// compromisso (`haConflitoDeHorario`). Resultado: dois comerciais marcaram
// pacientes diferentes no mesmo horário sem nada aparecer — 25 duplas
// marcações no banco, uma delas com três pacientes juntos.
//
// A checagem é no servidor de propósito. O `agendar` cria o pacote inteiro de
// uma vez (7 em 7 dias), então cada data precisa ser verificada; uma validação
// só na tela pegaria a primeira sessão e deixaria passar as outras sete.

export type Conflito = {
  /** Data/hora pedida que bateu em algo, em ISO UTC. */
  dataISO: string
  tipo: 'sessao' | 'compromisso'
  /** Pronto pra mostrar na tela: "25/08 às 12:40 — já tem a paciente Ana". */
  descricao: string
}

/** Só a hora, para dizer o intervalo que o item ocupa. */
function horaBRT(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}

function fmt(iso: string): string {
  const d = new Date(iso)
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  return `${data} às ${hora}`
}

/**
 * Devolve os conflitos das datas pedidas contra a agenda do terapeuta —
 * consultas de outros pacientes E compromissos pessoais (almoço, gravação),
 * que existem justamente pra bloquear horário.
 *
 * `ignorarSaleId` é obrigatório no reagendamento de um pacote: o endpoint
 * apaga e recria as sessões daquela venda, então elas não podem conflitar
 * consigo mesmas. `ignorarSessaoId` faz o mesmo pro remarcar de uma sessão só.
 */
export async function buscarConflitosAgenda(params: {
  terapeuta_id: string
  datasISO: string[]
  ignorarSaleId?: string
  ignorarSessaoId?: string
}): Promise<Conflito[]> {
  const { terapeuta_id, datasISO, ignorarSaleId, ignorarSessaoId } = params
  if (datasISO.length === 0) return []

  const client = getSupabaseAdmin()

  const { data: terapeuta } = await client
    .from('terapeutas').select('nome,duracao_sessao_minutos,horarios_fixos').eq('id', terapeuta_id).single()
  // Nome do terapeuta na mensagem: sem ele o comercial nao sabe DE QUEM e a
  // agenda que esta ocupada, e num pacote com dois terapeutas isso e a primeira
  // coisa que ele precisa saber.
  // `||` e nao `??`: nome vazio produziria "a agenda de  tem um bloqueio".
  const nomeTerapeuta = ((terapeuta?.nome as string | null) ?? '').trim() || 'o terapeuta'
  const duracaoMin = (terapeuta?.duracao_sessao_minutos as number | null) ?? 60
  const horariosFixos = (terapeuta?.horarios_fixos as string[] | null) ?? null
  const duracaoMs = duracaoMin * 60000

  // Ocupação real da consulta: até o próximo horário da grade, no máximo a
  // duração cadastrada. Sem isso, na grade do Pedro a consulta das 13:30
  // "terminava" 14:20 e bloqueava as 14:10 — que a agenda oferece como livre.
  const BRT = 'America/Sao_Paulo'
  function minutosBRT(iso: string): number {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: BRT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso))
    return Number(p.find(x => x.type === 'hour')?.value ?? 0) * 60
      + Number(p.find(x => x.type === 'minute')?.value ?? 0)
  }
  function fimRealMs(iso: string): number {
    const ini = minutosBRT(iso)
    return new Date(iso).getTime() + (fimEfetivoSessao(ini, duracaoMin, horariosFixos) - ini) * 60000
  }

  const pedidos = datasISO
    .map(iso => ({ iso, inicio: new Date(iso).getTime() }))
    .filter(p => Number.isFinite(p.inicio))
  if (pedidos.length === 0) return []

  // Janela única cobrindo todas as datas pedidas, folgada em uma duração pros
  // dois lados — um item que começa antes da primeira data ainda pode invadi-la.
  // Teto explicito por consulta. Se bater nele, a janela pedida e larga demais
  // para a trava ser confiavel, e o chamador precisa saber - ver `truncou` no
  // retorno.
  const LIMITE_LINHAS = 900
  const menor = Math.min(...pedidos.map(p => p.inicio)) - duracaoMs
  const maior = Math.max(...pedidos.map(p => p.inicio)) + duracaoMs

  let sessoesQ = client
    .from('sessoes')
    .select('id,sale_id,paciente_nome,data_agendada,numero_sessao,total_sessoes')
    .eq('terapeuta_id', terapeuta_id)
    .neq('status', 'cancelada')
    .not('data_agendada', 'is', null)
    .gte('data_agendada', new Date(menor).toISOString())
    .lte('data_agendada', new Date(maior).toISOString())
  if (ignorarSaleId) sessoesQ = sessoesQ.neq('sale_id', ignorarSaleId)
  if (ignorarSessaoId) sessoesQ = sessoesQ.neq('id', ignorarSessaoId)
  // `order` + `limit` explicitos. Sem eles vale o teto de 1000 do PostgREST,
  // que corta EM SILENCIO e sem ordem definida - e a trava simplesmente para de
  // enxergar parte dos horarios ocupados, que e o problema que este modulo
  // existe para resolver. A janela era estreita enquanto as datas vinham da
  // regua de 7 dias (56 dias num Formato 1); com datas digitadas a mao ela
  // passou a ser o que a pessoa escrever. O Pedro ja tem 740 compromissos
  // cadastrados, contra o teto de 1000.
  sessoesQ = sessoesQ.order('data_agendada', { ascending: true }).limit(LIMITE_LINHAS)

  const compromissosQ = client
    .from('compromissos_terapeuta')
    .select('id,titulo,inicio,fim,categoria')
    .eq('terapeuta_id', terapeuta_id)
    // Sobreposicao, e nao "comeca dentro da janela". Filtrar por `inicio`
    // deixava invisivel todo compromisso mais longo que a duracao da sessao:
    // medido no banco, 158 dos 357 compromissos do Pedro tem trecho que a trava
    // nao enxergava, ate 170 minutos. Caso concreto: pedir 02/09 as 15:00,
    // dentro de uma GRAVACAO das 14:10 as 17:00, devolvia ZERO conflito.
    .lte('inicio', new Date(maior).toISOString())
    .gte('fim', new Date(menor).toISOString())
    .order('inicio', { ascending: true })
    .limit(LIMITE_LINHAS)

  const [{ data: sessoes, error: errSessoes }, { data: compromissos, error: errCompromissos }] =
    await Promise.all([sessoesQ, compromissosQ])
  // Trava de seguranca nao pode falhar ABERTA. Descartar o erro fazia uma
  // consulta que falhasse virar `null`, o `?? []` virar zero conflitos e o
  // agendamento passar por cima de qualquer coisa. Melhor derrubar a rota com
  // erro visivel do que marcar dois pacientes no mesmo horario em silencio.
  if (errSessoes) throw new Error(`não foi possível conferir a agenda: ${errSessoes.message}`)
  if (errCompromissos) throw new Error(`não foi possível conferir os compromissos: ${errCompromissos.message}`)

  const ocupados = [
    ...((sessoes ?? []) as { paciente_nome: string; data_agendada: string; numero_sessao: number; total_sessoes: number }[])
      .map(s => ({
        inicio: new Date(s.data_agendada).getTime(),
        fim: fimRealMs(s.data_agendada),
        tipo: 'sessao' as const,
        rotulo: `${nomeTerapeuta} já atende ${s.paciente_nome} das ${horaBRT(s.data_agendada)} às ${horaBRT(new Date(fimRealMs(s.data_agendada)).toISOString())} (sessão ${s.numero_sessao} de ${s.total_sessoes}). Escolha outro horário.`,
      })),
    ...((compromissos ?? []) as { titulo: string; inicio: string; fim: string; categoria: string | null }[])
      .map(c => {
        // `categoria` decide o tipo, NAO a tabela de onde a linha veio.
        // `compromissos_terapeuta` guarda os dois: a tela de lancamento manual
        // oferece "Categoria: Compromisso | Sessao" e a rota grava o que a
        // pessoa escolheu. Carimbar tudo como 'compromisso' fazia uma CONSULTA
        // REAL lancada a mao virar bloqueio - e, com o override, o sistema
        // ofereceria "Agendar assim mesmo" em cima dela. Dupla marcacao, que e
        // exatamente o que esta trava existe para impedir. Ha 4 linhas assim no
        // banco, com nome de paciente no titulo.
        const ehSessao = c.categoria === 'sessao'
        return {
        inicio: new Date(c.inicio).getTime(),
        fim: new Date(c.fim).getTime(),
        tipo: (ehSessao ? 'sessao' : 'compromisso') as 'sessao' | 'compromisso',
        // Precisa dizer as tres coisas: DE QUEM e a agenda, QUE HORAS o
        // bloqueio ocupa, e que e um BLOQUEIO e nao consulta marcada. A
        // mensagem antiga era so `horário bloqueado: <titulo>`, e como o time
        // reserva a vaga com o nome do paciente no titulo, o comercial lia
        // "horário bloqueado: Juliane Eller" enquanto agendava a Juliane - e
        // entendia que ela ja estava agendada. Caso real de 02/09/2026.
        rotulo: ehSessao
          // Lancada a mao, mas e consulta: a mensagem nao pode chamar de
          // bloqueio o que a propria equipe marcou como sessao.
          ? `${nomeTerapeuta} atende "${c.titulo}" das ${horaBRT(c.inicio)} às ${horaBRT(c.fim)} (consulta lançada na agenda). Escolha outro horário.`
          : `a agenda de ${nomeTerapeuta} tem um bloqueio das ${horaBRT(c.inicio)} às ${horaBRT(c.fim)}: "${c.titulo}". É um compromisso lançado na agenda, não uma consulta marcada.`,
        }
      }),
  ]

  const conflitos: Conflito[] = []
  for (const p of pedidos) {
    // A data pedida também ocupa só até o próximo horário da grade.
    const fimPedido = fimRealMs(p.iso)
    const bateu = ocupados.find(o => p.inicio < o.fim && fimPedido > o.inicio)
    if (bateu) {
      conflitos.push({ dataISO: p.iso, tipo: bateu.tipo, descricao: `em ${fmt(p.iso)}: ${bateu.rotulo}` })
    }
  }
  return conflitos
}

/**
 * Conflitos que vieram SO de compromissos da agenda (almoco, gravacao, ou um
 * horario reservado a mao para este mesmo paciente), sem nenhuma consulta de
 * outro paciente no meio.
 *
 * Existe por um caso real de 02/09/2026: a equipe bloqueia o horario na agenda
 * do terapeuta ANTES de agendar, para segurar a vaga, e depois o agendamento
 * era recusado pela propria reserva. Compromisso e bloqueio da propria equipe e
 * pode ser passado por cima com confirmacao explicita; consulta de outro
 * paciente, nunca - foi para isso que esta trava foi construida em 11/08/2026,
 * depois de 25 duplas marcacoes reais.
 */
export function soCompromissos(conflitos: Conflito[]): boolean {
  return conflitos.length > 0 && conflitos.every(c => c.tipo === 'compromisso')
}

/**
 * Mensagem única pro front, listando cada data que bateu.
 *
 * Diz sempre POR QUE está bloqueado, não só que está: de quem é a agenda, o que
 * ocupa o horário e em que intervalo. Sem isso o comercial não tem como decidir
 * se muda a data, se apaga um bloqueio que ele mesmo criou, ou se fala com o
 * terapeuta.
 */
export function mensagemConflito(conflitos: Conflito[]): string {
  if (conflitos.length === 1) {
    return `Não dá para marcar ${conflitos[0].descricao}`
  }
  return `${conflitos.length} horários do pacote estão ocupados:\n` + conflitos.map(c => `• ${c.descricao}`).join('\n')
}

/**
 * Agrupa as datas pedidas por terapeuta. Exportada para teste: e a unica parte
 * pura de buscarConflitosMultiTerapeuta.
 */
export function agruparPorTerapeuta(
  itens: { terapeuta_id: string; dataISO: string }[],
): Record<string, string[]> {
  const g: Record<string, string[]> = {}
  for (const i of itens) {
    if (!g[i.terapeuta_id]) g[i.terapeuta_id] = []
    g[i.terapeuta_id].push(i.dataISO)
  }
  return g
}

/**
 * Conflito de um pacote cujas sessoes sao de terapeutas diferentes. Cada data e
 * validada contra a agenda do terapeuta DAQUELA sessao, nao contra um terapeuta
 * unico. Existe por causa do Diagnostico Guiado, primeiro produto assim.
 */
export async function buscarConflitosMultiTerapeuta(params: {
  itens: { terapeuta_id: string; dataISO: string }[]
  ignorarSaleId?: string
}): Promise<Conflito[]> {
  const grupos = agruparPorTerapeuta(params.itens)
  const todos: Conflito[] = []
  for (const [terapeuta_id, datasISO] of Object.entries(grupos)) {
    const c = await buscarConflitosAgenda({ terapeuta_id, datasISO, ignorarSaleId: params.ignorarSaleId })
    todos.push(...c)
  }
  return todos.sort((a, b) => a.dataISO.localeCompare(b.dataISO))
}
