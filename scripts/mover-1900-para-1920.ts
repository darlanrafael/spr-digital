// Move as sessoes FUTURAS do Pedro das 19:00 para as 19:20 (BRT).
// Pedido do usuario em 09/09/2026: "Quero alterar somente a agenda do PEDRO..
// TODOS PACIENTES QUE ESTIVER AS 19:00 IRAO PARA AS 19:20".
//
// Roda em ensaio por padrao. So grava com --gravar.
//
// Move o evento do Google EXISTENTE em vez de apagar e recriar (que e o que a
// rota de remarcar faz): recriar trocaria o link do Meet de todos os pacientes
// por causa de 20 minutos. Movendo, o Google avisa os convidados da mudanca de
// horario e o link continua o mesmo.
import { config } from 'dotenv'
config({ path: '.env.local' })
// Nenhum efeito externo alem do Calendar: sem WhatsApp, sem n8n.
delete process.env.N8N_ENCAIXE_WEBHOOK_URL
delete process.env.N8N_ALERTA_WEBHOOK_URL
delete process.env.N8N_BASE_URL
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

const GRAVAR = process.argv.includes('--gravar')
const DESLOCAMENTO_MIN = 20
const HORA_ORIGEM = '19:00'
const brt = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString()

async function calendario() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_MEET_PRIVATE_KEY as string).replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject: process.env.GOOGLE_MEET_DELEGATED_USER,
  })
  const cal = google.calendar({ version: 'v3', auth })
  const { data } = await cal.calendarList.list()
  const c = (data.items ?? []).find(x => x.summary === 'Atendimentos SPR Digital')
  if (!c?.id) throw new Error('calendario "Atendimentos SPR Digital" nao encontrado')
  return { cal, calendarId: c.id }
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: teraps } = await db.from('terapeutas').select('id,nome')
  const pedro = (teraps ?? []).find((t: any) => String(t.nome).toLowerCase().includes('pedro')) as any
  if (!pedro) throw new Error('Pedro nao encontrado')

  const agora = new Date().toISOString()
  const { data: todas } = await db.from('sessoes')
    .select('id,paciente_nome,data_agendada,status,numero_sessao,total_sessoes,google_event_id')
    .eq('terapeuta_id', pedro.id).not('data_agendada', 'is', null)
    .gt('data_agendada', agora).in('status', ['agendada', 'pendente']).order('data_agendada')
  const alvo = (todas ?? []).filter((s: any) => brt(s.data_agendada).slice(11, 16) === HORA_ORIGEM)

  console.log(GRAVAR ? '>>> GRAVANDO <<<' : '>>> ENSAIO (nada sera gravado) <<<')
  console.log(`terapeuta: ${pedro.nome} | sessoes a mover: ${alvo.length}\n`)

  const { cal, calendarId } = await calendario()
  let okDb = 0, okCal = 0, semEvento = 0, falhas = 0

  for (const s of alvo as any[]) {
    const nova = new Date(new Date(s.data_agendada).getTime() + DESLOCAMENTO_MIN * 60000).toISOString()
    const linha = `${brt(s.data_agendada).slice(0, 16).replace('T', ' ')} -> ${brt(nova).slice(11, 16)} | ${String(s.paciente_nome).slice(0, 26).padEnd(26)} | ${s.numero_sessao}/${s.total_sessoes}`
    if (!GRAVAR) { console.log('  ' + linha); continue }

    const { error } = await db.from('sessoes').update({ data_agendada: nova }).eq('id', s.id)
    if (error) { console.log(`  FALHOU banco: ${linha} -> ${error.message}`); falhas++; continue }
    okDb++

    if (!s.google_event_id) { console.log(`  ${linha} | banco ok, SEM evento no Calendar`); semEvento++; continue }
    try {
      const { data: ev } = await cal.events.get({ calendarId, eventId: s.google_event_id })
      const ini = new Date(ev.start?.dateTime as string).getTime()
      const fim = new Date(ev.end?.dateTime as string).getTime()
      await cal.events.patch({
        calendarId, eventId: s.google_event_id, sendUpdates: 'all',
        requestBody: {
          start: { dateTime: new Date(ini + DESLOCAMENTO_MIN * 60000).toISOString(), timeZone: 'America/Sao_Paulo' },
          end: { dateTime: new Date(fim + DESLOCAMENTO_MIN * 60000).toISOString(), timeZone: 'America/Sao_Paulo' },
        },
      })
      okCal++
      console.log(`  ${linha} | banco ok, Calendar ok`)
    } catch (e: any) {
      console.log(`  ${linha} | banco ok, CALENDAR FALHOU: ${String(e.message ?? e).slice(0, 90)}`)
      falhas++
    }
    await db.from('atividades_log').insert({
      usuario_nome: 'Rafael (ajuste em lote)', usuario_tipo: 'admin',
      tipo_acao: 'remarcacao', sessao_id: s.id,
      descricao: `Horario ajustado de ${HORA_ORIGEM} para ${brt(nova).slice(11, 16)} (BRT) - ajuste em lote da agenda do Pedro, pedido em 09/09/2026.`,
    })
  }

  if (GRAVAR) console.log(`\nbanco: ${okDb} | Calendar: ${okCal} | sem evento: ${semEvento} | falhas: ${falhas}`)
  else console.log('\nPara gravar: npx tsx scripts/mover-1900-para-1920.ts --gravar')
}
main()
