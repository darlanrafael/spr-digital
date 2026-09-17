// lib/rotas-abertas.ts
//
// As rotas que NAO exigem cracha, e o motivo de cada uma.
//
// Esta lista e uma RESTRICAO DE SEGURANCA ao contrario: tirar uma daqui nao
// deixa o sistema mais seguro, deixa quebrado. Os dois webhooks sao a Hubla e a
// Kiwify chamando o sistema para avisar de venda nova - eles nao tem login. Se
// passarem a exigir cracha, AS VENDAS PARAM DE ENTRAR EM SILENCIO: nenhum erro
// aparece em tela, e a falta so seria notada dias depois.

export const ROTAS_ABERTAS = [
  '/api/webhooks/hubla',              // a Hubla avisando de venda nova
  '/api/webhooks/kiwify',             // a Kiwify avisando de venda nova
  '/api/webhooks/reconciliar',        // cron; ja confere x-whatsapp-cron-secret
  '/api/whatsapp/pendentes-vespera',  // cron; ja confere x-whatsapp-cron-secret
  '/api/whatsapp/pendentes-30min',    // cron; idem
  '/api/whatsapp/marcar-enviado',     // cron; idem
  '/api/dashboard-usuarios/login',    // e o proprio login do DRE
  '/api/terapeutas/login',            // e o proprio login do modulo de terapeutas
]

/**
 * Comparacao EXATA, nunca por prefixo.
 *
 * Por prefixo, `/api/dashboard-usuarios/login` (aberta) abriria tambem
 * `/api/dashboard-usuarios`, que cria e altera usuario do DRE.
 */
export function ehRotaAberta(caminho: string): boolean {
  const limpo = caminho.split('?')[0].replace(/\/+$/, '')
  return ROTAS_ABERTAS.includes(limpo)
}