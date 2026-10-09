// Fonte unica dos campos de controle do lembrete de WhatsApp de uma sessao.
//
// Cada carimbo `lembrete_*_enviado_em` diz "ja avisei para o horario que esta
// agendado AGORA". Quando a sessao muda de data (remarcar, empurrar-seguintes),
// esses carimbos ficam velhos: eles descrevem o horario ANTIGO. O disparo
// (lib/whatsapp-pendentes) so seleciona sessao com ALGUM carimbo nulo, entao
// uma sessao remarcada com os 4 preenchidos era tratada como "ja avisada" e o
// paciente NAO recebia lembrete na data nova.
//
// Bug real: Aline Damam, sessao remarcada em 06/10/2026 para 09/10/2026, pulada
// no disparo da vespera porque os 4 carimbos seguiam com a data de 30/09
// (achado em 09/10/2026). Por isso toda rota que reescreve `data_agendada` de
// uma sessao existente deve zerar estes campos junto.

// Os nomes TEM de bater exatamente com as colunas que o disparo confere
// (colGrupo/colPaciente de vespera e de 30min em lib/whatsapp-pendentes.ts).
export const COLUNAS_LEMBRETE = [
  'lembrete_grupo_vespera_enviado_em',
  'lembrete_paciente_vespera_enviado_em',
  'lembrete_grupo_30min_enviado_em',
  'lembrete_paciente_30min_enviado_em',
] as const

export type CamposLembreteZerados = { [K in (typeof COLUNAS_LEMBRETE)[number]]: null }

// Patch pronto pra espalhar num update/upsert: `{ ...LEMBRETES_ZERADOS }`.
export const LEMBRETES_ZERADOS: CamposLembreteZerados = {
  lembrete_grupo_vespera_enviado_em: null,
  lembrete_paciente_vespera_enviado_em: null,
  lembrete_grupo_30min_enviado_em: null,
  lembrete_paciente_30min_enviado_em: null,
}

// Acrescenta os carimbos zerados a um payload de update, sem mexer no resto.
export function comLembretesZerados<T extends Record<string, unknown>>(
  patch: T,
): T & CamposLembreteZerados {
  return { ...patch, ...LEMBRETES_ZERADOS }
}
