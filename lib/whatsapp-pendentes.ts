import { SupabaseClient } from '@supabase/supabase-js'

export type SessaoPendenteWhatsapp = {
  sessao_id: string
  paciente_nome: string
  paciente_telefone: string | null
  numero_sessao: number
  total_sessoes: number
  data_agendada: string
  link_meet: string | null
  grupo_ja_enviado: boolean
  paciente_ja_enviado: boolean
}

export type TerapeutaPendente = {
  terapeuta_id: string
  grupo_whatsapp_id: string
  sessoes: SessaoPendenteWhatsapp[]
}

type ColunaGrupo = 'lembrete_grupo_vespera_enviado_em' | 'lembrete_grupo_30min_enviado_em'
type ColunaPaciente = 'lembrete_paciente_vespera_enviado_em' | 'lembrete_paciente_30min_enviado_em'

// Autenticação simples pra chamadas do n8n — não há sessão de usuário aqui,
// só uma chave secreta compartilhada configurada nos dois lados.
export function verificarSecretCron(req: Request): boolean {
  const secret = req.headers.get('x-whatsapp-cron-secret')
  return !!secret && !!process.env.WHATSAPP_CRON_SECRET && secret === process.env.WHATSAPP_CRON_SECRET
}

// Busca sessões agendadas de terapeutas com automação de WhatsApp ligada
// (grupo_whatsapp_id preenchido), dentro da janela de data informada, que
// ainda não tiveram pelo menos um dos dois lembretes daquele tipo enviado.
// Compartilhado entre pendentes-vespera e pendentes-30min — só muda a janela
// de data e quais colunas de controle são checadas.
export async function buscarPendentes(
  client: SupabaseClient,
  params: { inicio: string; fim: string; colGrupo: ColunaGrupo; colPaciente: ColunaPaciente }
): Promise<TerapeutaPendente[]> {
  const { data: terapeutas, error: terapErr } = await client
    .from('terapeutas')
    .select('id,grupo_whatsapp_id')
    .not('grupo_whatsapp_id', 'is', null)
  if (terapErr) throw new Error(terapErr.message)
  if (!terapeutas || terapeutas.length === 0) return []

  const terapeutaIds = terapeutas.map(t => t.id as string)

  const { data: sessoes, error: sessErr } = await client
    .from('sessoes')
    .select(`id,sale_id,terapeuta_id,numero_sessao,total_sessoes,data_agendada,link_meet,paciente_nome,${params.colGrupo},${params.colPaciente}`)
    .eq('status', 'agendada')
    .in('terapeuta_id', terapeutaIds)
    .gte('data_agendada', params.inicio)
    .lte('data_agendada', params.fim)
    .or(`${params.colGrupo}.is.null,${params.colPaciente}.is.null`)
    .order('data_agendada', { ascending: true })
  if (sessErr) throw new Error(sessErr.message)

  type SessaoRow = {
    id: string
    sale_id: string
    terapeuta_id: string
    numero_sessao: number
    total_sessoes: number
    data_agendada: string
    link_meet: string | null
    paciente_nome: string
  } & Record<ColunaGrupo | ColunaPaciente, string | null>

  const linhas = (sessoes ?? []) as unknown as SessaoRow[]

  const saleIds = [...new Set(linhas.map(s => s.sale_id))]
  const telefonePorSale: Record<string, string | null> = {}
  if (saleIds.length > 0) {
    const { data: sales, error: salesErr } = await client.from('sales').select('id,telefone').in('id', saleIds)
    if (salesErr) throw new Error(salesErr.message)
    for (const s of sales ?? []) telefonePorSale[s.id as string] = s.telefone as string | null
  }

  const grupoIdPorTerapeuta: Record<string, string> = {}
  for (const t of terapeutas) grupoIdPorTerapeuta[t.id as string] = t.grupo_whatsapp_id as string

  const porTerapeuta: Record<string, TerapeutaPendente> = {}
  for (const s of linhas) {
    if (!porTerapeuta[s.terapeuta_id]) {
      porTerapeuta[s.terapeuta_id] = {
        terapeuta_id: s.terapeuta_id,
        grupo_whatsapp_id: grupoIdPorTerapeuta[s.terapeuta_id],
        sessoes: [],
      }
    }
    porTerapeuta[s.terapeuta_id].sessoes.push({
      sessao_id: s.id,
      paciente_nome: s.paciente_nome,
      paciente_telefone: telefonePorSale[s.sale_id] ?? null,
      numero_sessao: s.numero_sessao,
      total_sessoes: s.total_sessoes,
      data_agendada: s.data_agendada,
      link_meet: s.link_meet,
      grupo_ja_enviado: !!s[params.colGrupo],
      paciente_ja_enviado: !!s[params.colPaciente],
    })
  }

  return Object.values(porTerapeuta)
}
