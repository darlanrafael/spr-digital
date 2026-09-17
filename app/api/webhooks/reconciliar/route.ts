import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron } from '@/lib/whatsapp-pendentes'
import { decidirReinsercoes, reconstruirVenda, type EventoFalho } from '@/lib/reconciliador'
import { alertarReconciliacao, type ResumoReconciliacao } from '@/lib/alerta-reconciliacao'
import { logWebhookEvent } from '@/lib/webhook-log'

const EVENTOS_PAGAMENTO = ['invoice.payment_succeeded', 'order_approved']

type Resumo = { varridas: number; recuperadas: number; naoRecuperadas: number }

/** Marca a linha ORIGINAL do evento falho em `webhook_events` como tratada,
 *  trocando `resultado` pra um valor fora de `['insert_error', 'exception']`
 *  - assim ela sai da consulta da proxima rodada e nao e alertada de novo
 *  pra sempre. Best-effort: se a marcacao falhar, o pior caso e reprocessar
 *  o mesmo evento na proxima rodada (nunca duplica venda - isso quem
 *  garante e o dedup por order_id contra `sales`, nao esta marcacao). */
async function marcarEventoTratado(client: SupabaseClient, eventoId: string, resultado: string): Promise<void> {
  const { error } = await client.from('webhook_events').update({ resultado }).eq('id', eventoId)
  if (error) console.error('[reconciliar] falha ao marcar evento tratado:', eventoId, error.message)
}

/**
 * Varre `webhook_events` por pagamento que falhou, decide o que re-inserir e
 * insere. Extraida do handler pra ser chamada tanto por POST (cron externo,
 * com `x-whatsapp-cron-secret`) quanto por GET (cron nativo da Vercel, com
 * `Authorization: Bearer CRON_SECRET`) sem duplicar a logica.
 */
async function executarReconciliacao(client: SupabaseClient): Promise<Resumo> {
  const { data: falhas } = await client
    .from('webhook_events')
    .select('id, plataforma, tipo_evento, payload')
    .in('resultado', ['insert_error', 'exception'])
    .in('tipo_evento', EVENTOS_PAGAMENTO)
    .order('created_at')
    .limit(500)
  const eventos: EventoFalho[] = (falhas ?? []).map(f => ({ id: f.id as string, plataforma: f.plataforma, payload: f.payload as Record<string, unknown> }))

  // Os candidatos a dedup saem dos PROPRIOS eventos falhos (conjunto
  // pequeno, do tamanho do lote de falhas), nunca de uma varredura de
  // `sales` inteira: o Supabase corta `select()` em ~1000 linhas por
  // padrao quando nao ha `.range()`/paginacao - o mesmo bug critico ja
  // documentado e corrigido em app/api/terapeutas/vendas/route.ts:163-172 -
  // e `sales` ja passou de 1000 linhas. Buscar tudo sem paginacao arriscaria
  // nao enxergar uma venda que caiu fora do corte e re-inserir ela = venda
  // duplicada, dinheiro duplicado. Restringindo a consulta aos `order_id`
  // que interessam (`.in()`), a checagem fica completa independente do
  // tamanho de `sales`.
  const candidatos = new Set<string>()
  for (const ev of eventos) {
    try {
      const sale = reconstruirVenda(ev)
      if (sale?.order_id) candidatos.add(sale.order_id)
    } catch {
      // Parse invalido: tratado de verdade dentro de decidirReinsercoes
      // (bucket `erros`) mais abaixo. Aqui so estamos coletando order_id
      // pra restringir a consulta em sales - ignorar com seguranca.
    }
  }

  const orderIdsExistentes = new Set<string>()
  if (candidatos.size > 0) {
    const { data: existentes } = await client
      .from('sales')
      .select('order_id')
      .in('order_id', Array.from(candidatos))
    for (const r of existentes ?? []) if (r.order_id) orderIdsExistentes.add(r.order_id as string)
  }

  const { inserir, semOrderId, erros } = decidirReinsercoes(eventos, orderIdsExistentes)

  const recuperadas: ResumoReconciliacao['recuperadas'] = []
  const naoRecuperadas: ResumoReconciliacao['naoRecuperadas'] = []

  for (const { sale, eventoId } of inserir) {
    const { error } = await client.from('sales').insert(sale)
    if (error) {
      naoRecuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, motivo: error.message })
      await logWebhookEvent({ plataforma: sale.plataforma as 'hubla' | 'kiwify', tipoEvento: 'reconciliacao', resultado: 'reconcile_insert_error', detalhe: `${sale.order_id}: ${error.message}`, payload: sale })
      // NAO marca o evento original aqui: a falha de insercao pode ser
      // transitoria (rede, banco fora do ar) - deixa `insert_error` como
      // esta pra tentar de novo na proxima rodada.
    } else {
      recuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, valor: sale.valor_pago_cliente, order_id: sale.order_id as string })
      await logWebhookEvent({ plataforma: sale.plataforma as 'hubla' | 'kiwify', tipoEvento: 'reconciliacao', resultado: 'reconcile_recovered', saleId: sale.id, detalhe: sale.order_id, payload: sale })
      await marcarEventoTratado(client, eventoId, 'reconcile_recovered')
    }
  }
  for (const { sale, eventoId } of semOrderId) {
    naoRecuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, motivo: 'payload sem order_id' })
    await marcarEventoTratado(client, eventoId, 'reconcile_skipped_no_order_id')
  }
  for (const { eventoId, plataforma, motivo } of erros) {
    naoRecuperadas.push({ plataforma, cliente: '(falha no parse)', produto: '(falha no parse)', motivo })
    await marcarEventoTratado(client, eventoId, 'reconcile_parse_error')
  }

  await alertarReconciliacao({ recuperadas, naoRecuperadas })
  return { varridas: eventos.length, recuperadas: recuperadas.length, naoRecuperadas: naoRecuperadas.length }
}

// Cron externo (ex.: cron-job.org), mandando o secret que as outras rotas de
// cron do WhatsApp ja usam.
export async function POST(req: NextRequest) {
  if (!verificarSecretCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await executarReconciliacao(getSupabaseAdmin()))
}

// Cron nativo da Vercel: chama por GET e manda `Authorization: Bearer
// CRON_SECRET` sozinho quando a env `CRON_SECRET` esta configurada no
// projeto (recurso da propria Vercel) - por isso a guarda aqui e outra,
// nao `verificarSecretCron`. Falha fechada: sem `CRON_SECRET` configurada
// neste ambiente, NINGUEM passa por GET (o POST com o secret do cron
// externo continua disponivel).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await executarReconciliacao(getSupabaseAdmin()))
}
