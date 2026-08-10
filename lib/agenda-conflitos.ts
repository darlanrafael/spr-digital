import { getSupabaseAdmin } from '@/lib/supabase'

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
    .from('terapeutas').select('duracao_sessao_minutos').eq('id', terapeuta_id).single()
  const duracaoMs = ((terapeuta?.duracao_sessao_minutos as number | null) ?? 60) * 60000

  const pedidos = datasISO
    .map(iso => ({ iso, inicio: new Date(iso).getTime() }))
    .filter(p => Number.isFinite(p.inicio))
  if (pedidos.length === 0) return []

  // Janela única cobrindo todas as datas pedidas, folgada em uma duração pros
  // dois lados — um item que começa antes da primeira data ainda pode invadi-la.
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

  const compromissosQ = client
    .from('compromissos_terapeuta')
    .select('id,titulo,inicio,fim')
    .eq('terapeuta_id', terapeuta_id)
    .gte('inicio', new Date(menor).toISOString())
    .lte('inicio', new Date(maior).toISOString())

  const [{ data: sessoes }, { data: compromissos }] = await Promise.all([sessoesQ, compromissosQ])

  const ocupados = [
    ...((sessoes ?? []) as { paciente_nome: string; data_agendada: string; numero_sessao: number; total_sessoes: number }[])
      .map(s => ({
        inicio: new Date(s.data_agendada).getTime(),
        fim: new Date(s.data_agendada).getTime() + duracaoMs,
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
    const fimPedido = p.inicio + duracaoMs
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
