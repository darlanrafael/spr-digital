import { NextResponse } from 'next/server'
import { google } from 'googleapis'

// Endpoint temporário de diagnóstico — remover depois de confirmar o link
// automático do Meet funcionando em produção.
export async function GET() {
  const temEmail = !!process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL
  const temKey = !!process.env.GOOGLE_MEET_PRIVATE_KEY
  const temUser = !!process.env.GOOGLE_MEET_DELEGATED_USER
  const keyPreview = process.env.GOOGLE_MEET_PRIVATE_KEY
    ? process.env.GOOGLE_MEET_PRIVATE_KEY.slice(0, 30) + '...' + process.env.GOOGLE_MEET_PRIVATE_KEY.slice(-30)
    : null
  const keyHasLiteralBackslashN = process.env.GOOGLE_MEET_PRIVATE_KEY?.includes('\\n') ?? false
  const keyHasRealNewline = process.env.GOOGLE_MEET_PRIVATE_KEY?.includes('\n') ?? false

  let erroReal: string | null = null
  let sucesso = false
  try {
    const privateKey = (process.env.GOOGLE_MEET_PRIVATE_KEY as string).replace(/\\n/g, '\n')
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/calendar'],
      subject: process.env.GOOGLE_MEET_DELEGATED_USER,
    })
    const calendar = google.calendar({ version: 'v3', auth })
    await calendar.calendarList.list()
    sucesso = true
  } catch (err) {
    erroReal = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json({
    temEmail, temKey, temUser, keyPreview,
    keyHasLiteralBackslashN, keyHasRealNewline,
    sucesso, erroReal,
  })
}
