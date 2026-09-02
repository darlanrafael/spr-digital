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
    .from('terapeutas').select('duracao_sessao_minutos,horarios_fixos').eq('id', terapeuta_id).single()
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
    .select('id,titulo,inicio,fim')
    .eq('terapeuta_id', terapeuta_id)
    .gte('inicio', new Date(menor).toISOString())
    .lte('inicio', new Date(maior).toISOString())
    .order('inicio', { ascending: true })
    .limit(LIMITE_LINHAS)

  const [{ data: sessoes }, { data: compromissos }] = await Promise.all([sessoesQ, compromissosQ])

  const ocupados = [
    ...((sessoes ?? []) as { paciente_nome: string; data_agendada: string; numero_sessao: number; total_sessoes: number }[])
      .map(s => ({
        inicio: new Date(s.data_agendada).getTime(),
        fim: fimRealMs(s.data_agendada),
        tipo: 'sessao' as const,
        rotulo: `já tem a consulta de ${s.paciente_nome} (sessão ${s.numero_sessao}/${s.total_sessoes})`,
      })),
    ...((compromissos ?? []) as { titulo: string; inicio: string; fim: string }[])
      .map(c => ({
        inicio: new Date(c.inicio).getTime(),
        fim: new Date(c.fim).getTime(),
        tipo: 'compromisso' as const,
        rotulo: `horário bloqueado: ${c.titulo}`,
      })),
  ]

  const conflitos: Conflito[] = []
  for (const p of pedidos) {
    // A data pedida também ocupa só até o próximo horário da grade.
    const fimPedido = fimRealMs(p.iso)
    const bateu = ocupados.find(o => p.inicio < o.fim && fimPedido > o.inicio)
    if (bateu) {
      conflitos.push({ dataISO: p.iso, tipo: bateu.tipo, descricao: `${fmt(p.iso)} — ${bateu.rotulo}` })
    }
  }
  return conflitos
}

/** Mensagem única pro front, listando cada data que bateu. */
export function mensagemConflito(conflitos: Conflito[]): string {
  if (conflitos.length === 1) return `Conflito de horário: ${conflitos[0].descricao}`
  return `Conflito de horário em ${conflitos.length} datas:\n` + conflitos.map(c => `• ${c.descricao}`).join('\n')
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
