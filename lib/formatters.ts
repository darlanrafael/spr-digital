import { Sale } from '@/types'

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatDate(dateStr: string): string {
  const part = dateStr.slice(0, 10)
  const [y, m, d] = part.split('-')
  return `${d}/${m}/${y}`
}

export function formatDateTime(datetime: string): string {
  if (!datetime) return ''
  const [datePart, timePart] = datetime.split('T')
  const [y, m, d] = datePart.split('-')
  const time = timePart?.slice(0, 5) ?? ''
  return `${d}/${m}/${y}${time ? ' ' + time : ''}`
}

export function getDateFromDateTime(datetime: string): string {
  return datetime.slice(0, 10)
}

/** Parse datetime string as local Brasília time (stored as local, no TZ conversion needed) */
export function parseLocalDateTime(datetime: string): Date {
  const [datePart, timePart = '00:00:00'] = datetime.split('T')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, min] = timePart.split(':').map(Number)
  return new Date(y, mo - 1, d, h, min)
}

export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function getMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[parseInt(m) - 1]}/${y.slice(2)}`
}

export function isUTMBugged(value: string): boolean {
  if (!value) return false
  return ['l.facebook.com', '{{', '}}'].some(p => value.includes(p))
}

/** Aliquota automática por preço do produto */
export function getAliquotaByPreco(preco: number): number {
  return preco <= 167 ? 3 : 12.85
}

/** Faturamento bruto da venda conforme plataforma */
export function getSaleBruto(sale: Sale): number {
  return sale.plataforma === 'hubla' ? sale.valor_pago_cliente : sale.preco_base
}

/** Base de cálculo do imposto = valor COM juros (fallback: valor_pago_cliente para histórico sem valor_com_juros) */
export function getImpostoBase(sale: Sale): number {
  return sale.valor_com_juros ?? sale.valor_pago_cliente
}

/** Dias corridos entre duas datas "YYYY-MM-DD" */
export function diffDays(from: string, to: string): number {
  const a = parseLocalDate(from)
  const b = parseLocalDate(to)
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000)
}

/** Dias desde a compra até hoje (usando data_hora) */
export function daysSincePurchase(dataHora: string): number {
  const purchaseDate = getDateFromDateTime(dataHora)
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return diffDays(purchaseDate, todayStr)
}

/** Início e fim da semana atual (Seg-Dom) */
export function getCurrentWeekRange(): { start: string; end: string } {
  const today = new Date()
  const dow = today.getDay()
  const daysFromMon = dow === 0 ? 6 : dow - 1
  const mon = new Date(today)
  mon.setDate(today.getDate() - daysFromMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(mon), end: fmt(sun) }
}

/** Início e fim do mês anterior */
export function getPrevMonthRange(): { start: string; end: string } {
  const today = new Date()
  const firstOfPrev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastOfPrev = new Date(today.getFullYear(), today.getMonth(), 0)
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(firstOfPrev), end: fmt(lastOfPrev) }
}

export const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export const HOUR_RANGES = [
  { label: '00h–06h', from: 0, to: 5 },
  { label: '06h–09h', from: 6, to: 8 },
  { label: '09h–12h', from: 9, to: 11 },
  { label: '12h–15h', from: 12, to: 14 },
  { label: '15h–18h', from: 15, to: 17 },
  { label: '18h–21h', from: 18, to: 20 },
  { label: '21h–24h', from: 21, to: 23 },
]

export interface DayStat {
  dayIndex: number
  label: string
  qtd: number
  bruto: number
}

export interface HourStat {
  rangeLabel: string
  qtd: number
  bruto: number
}

export function calcDayStats(sales: Sale[]): DayStat[] {
  const map: Record<number, { qtd: number; bruto: number }> = {}
  for (let i = 0; i < 7; i++) map[i] = { qtd: 0, bruto: 0 }
  for (const s of sales) {
    const d = parseLocalDateTime(s.data_hora)
    const dow = d.getDay()
    map[dow].qtd++
    map[dow].bruto += getSaleBruto(s)
  }
  return Object.entries(map)
    .map(([idx, v]) => ({ dayIndex: Number(idx), label: DAY_LABELS[Number(idx)], ...v }))
    .sort((a, b) => b.bruto - a.bruto)
}

export function calcHourStats(sales: Sale[]): HourStat[] {
  const map: Record<number, { qtd: number; bruto: number }> = {}
  HOUR_RANGES.forEach((_, i) => { map[i] = { qtd: 0, bruto: 0 } })
  for (const s of sales) {
    const d = parseLocalDateTime(s.data_hora)
    const h = d.getHours()
    const idx = HOUR_RANGES.findIndex(r => h >= r.from && h <= r.to)
    if (idx >= 0) {
      map[idx].qtd++
      map[idx].bruto += getSaleBruto(s)
    }
  }
  return Object.entries(map)
    .map(([i, v]) => ({ rangeLabel: HOUR_RANGES[Number(i)].label, ...v }))
    .sort((a, b) => b.bruto - a.bruto)
}
