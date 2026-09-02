import { google } from 'googleapis'
import { notificarAdmin } from './notificar-admin'

const CALENDARIO_NOME = 'Atendimentos SPR Digital'

// Sem as 3 variáveis configuradas, a integração fica "desligada" — quem
// chama essas funções sempre recebe null/no-op, sem erro, e o agendamento
// continua funcionando normalmente sem link (mesmo comportamento de hoje).
function credenciaisDisponiveis(): boolean {
  return !!(
    process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_MEET_PRIVATE_KEY &&
    process.env.GOOGLE_MEET_DELEGATED_USER
  )
}

function getAuthClient() {
  const privateKey = (process.env.GOOGLE_MEET_PRIVATE_KEY as string).replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email: process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject: process.env.GOOGLE_MEET_DELEGATED_USER,
  })
}

// Guarda a PROMESSA, não o id pronto. As rotas de pacote passaram a chamar o
// Calendar em paralelo (ver empurrar-seguintes): com o cache de string, N
// chamadas simultâneas em processo frio faziam N calendarList.list() e, se o
// calendário ainda não existisse, N calendars.insert() - ou seja, calendários
// duplicados. Guardando a promessa, a primeira chamada resolve e todas as
// outras esperam por ela. Para quem chama em sequência não muda nada.
let calendarIdPromise: Promise<string> | null = null

// Procura (ou cria, na primeira vez) o calendário secundário dedicado —
// evita lotar a agenda pessoal de quem "possui" a conta de serviço com
// toda sessão de todo terapeuta.
async function getCalendarId(calendar: ReturnType<typeof google.calendar>): Promise<string> {
  if (!calendarIdPromise) {
    calendarIdPromise = (async () => {
      const { data } = await calendar.calendarList.list()
      const existente = data.items?.find(c => c.summary === CALENDARIO_NOME)
      if (existente?.id) return existente.id
      const { data: novo } = await calendar.calendars.insert({
        requestBody: { summary: CALENDARIO_NOME },
      })
      return novo.id as string
    })()
  }
  try {
    return await calendarIdPromise
  } catch (err) {
    // Falha de rede não pode virar cache permanente: zera pra próxima
    // chamada tentar de novo, que era o comportamento de antes.
    calendarIdPromise = null
    throw err
  }
}

export async function criarEventoComMeet(params: {
  titulo: string
  inicioISO: string
  fimISO: string
}): Promise<{ eventId: string; meetLink: string } | null> {
  if (!credenciaisDisponiveis()) return null
  try {
    const auth = getAuthClient()
    const calendar = google.calendar({ version: 'v3', auth })
    const calendarId = await getCalendarId(calendar)

    const { data } = await calendar.events.insert({
      calendarId,
      conferenceDataVersion: 1,
      requestBody: {
        summary: params.titulo,
        start: { dateTime: params.inicioISO },
        end: { dateTime: params.fimISO },
        conferenceData: {
          createRequest: {
            requestId: `spr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    })

    const meetLink = data.hangoutLink
    if (!data.id || !meetLink) return null
    return { eventId: data.id, meetLink }
  } catch (err) {
    console.error('[google-meet] falha ao criar evento:', err)
    await notificarAdmin(`Falha ao gerar link do Meet para "${params.titulo}" (início: ${params.inicioISO}). Erro: ${String(err)}`)
    return null
  }
}

export async function cancelarEvento(eventId: string): Promise<void> {
  if (!credenciaisDisponiveis()) return
  try {
    const auth = getAuthClient()
    const calendar = google.calendar({ version: 'v3', auth })
    const calendarId = await getCalendarId(calendar)
    await calendar.events.delete({ calendarId, eventId })
  } catch (err) {
    console.error('[google-meet] falha ao cancelar evento:', err)
  }
}
