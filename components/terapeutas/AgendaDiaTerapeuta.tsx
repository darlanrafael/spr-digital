// components/terapeutas/AgendaDiaTerapeuta.tsx
'use client'

export type SessaoDia = {
  id: string
  paciente_nome: string
  numero_sessao: number
  total_sessoes: number
  status: string
  data_agendada: string
}

export type CompromissoDia = {
  id: string
  titulo: string
  inicio: string
  fim: string
  categoria: 'sessao' | 'compromisso'
}

interface AgendaDiaTerapeutaProps {
  data: Date
  sessoes: SessaoDia[]
  compromissos: CompromissoDia[]
  duracaoSessaoMinutos: number
  onClickSessao: (sessao: SessaoDia) => void
  onClickCompromisso: (compromisso: CompromissoDia) => void
  onClickLivre: (inicio: Date, fim: Date) => void
  onNavegarDia: (direcao: -1 | 1) => void
  onVoltarMes: () => void
}

const JANELA_INICIO_MIN = 8 * 60   // 08:00
const JANELA_FIM_MIN = 21 * 60     // 21:00
const PX_POR_MIN = 1

function minutosDoDia(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function horaParaData(diaBase: Date, minutos: number): Date {
  const d = new Date(diaBase)
  d.setHours(0, minutos, 0, 0)
  return d
}

function fmtHora(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, '0')
  const m = (min % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function fmtDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

type Ocupado = { inicio: number; fim: number }

// Restringe um valor ao intervalo [min, max] — usado pra manter tudo (blocos
// ocupados e intervalos livres) dentro da janela fixa 08:00–21:00, mesmo
// quando a sessão/compromisso original começa ou termina fora dela.
function clamp(min: number, valor: number, max: number): number {
  return Math.min(Math.max(valor, min), max)
}

// Calcula os intervalos livres dentro da janela do dia, dado tudo que já
// ocupa horário (sessões + compromissos, em minutos desde meia-noite). O
// cursor nunca anda pra trás, então intervalos sobrepostos/aninhados não
// geram um "livre" fantasma no meio deles.
function calcularIntervalosLivres(ocupados: Ocupado[], janelaInicio: number, janelaFim: number): Ocupado[] {
  const ordenados = [...ocupados].sort((a, b) => a.inicio - b.inicio)
  const livres: Ocupado[] = []
  let cursor = janelaInicio
  for (const o of ordenados) {
    const inicio = clamp(janelaInicio, o.inicio, janelaFim)
    const fim = clamp(janelaInicio, o.fim, janelaFim)
    if (inicio > cursor) livres.push({ inicio: cursor, fim: inicio })
    cursor = Math.max(cursor, fim)
  }
  if (cursor < janelaFim) livres.push({ inicio: cursor, fim: janelaFim })
  return livres
}

// Corta um intervalo livre em pedaços de no máximo 1h, alinhados às linhas
// da hora cheia (ex: 12:40–21:00 vira 12:40–13:00, 13:00–14:00, ...). Sem
// isso, um vão livre de várias horas virava uma única área de hover — passar
// o mouse em qualquer ponto dela destacava o vão inteiro, não só a "linha"
// embaixo do cursor.
function fatiarLivrePorHora(intervalo: Ocupado): Ocupado[] {
  const pedacos: Ocupado[] = []
  let cursor = intervalo.inicio
  while (cursor < intervalo.fim) {
    const proximaHora = Math.floor(cursor / 60) * 60 + 60
    const fimPedaco = Math.min(proximaHora, intervalo.fim)
    pedacos.push({ inicio: cursor, fim: fimPedaco })
    cursor = fimPedaco
  }
  return pedacos
}

export default function AgendaDiaTerapeuta({
  data, sessoes, compromissos, duracaoSessaoMinutos,
  onClickSessao, onClickCompromisso, onClickLivre, onNavegarDia, onVoltarMes,
}: AgendaDiaTerapeutaProps) {
  const isHoje = data.toDateString() === new Date().toDateString()
  const agora = new Date()
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()

  const sessoesComHorario = sessoes.map(s => ({
    sessao: s,
    inicio: minutosDoDia(s.data_agendada),
    fim: minutosDoDia(s.data_agendada) + duracaoSessaoMinutos,
  }))

  const compromissosComHorario = compromissos.map(c => ({
    compromisso: c,
    inicio: minutosDoDia(c.inicio),
    fim: minutosDoDia(c.fim),
  }))

  const ocupados: Ocupado[] = [
    ...sessoesComHorario.map(s => ({ inicio: s.inicio, fim: s.fim })),
    ...compromissosComHorario.map(c => ({ inicio: c.inicio, fim: c.fim })),
  ]
  const livres = calcularIntervalosLivres(ocupados, JANELA_INICIO_MIN, JANELA_FIM_MIN)
    .flatMap(fatiarLivrePorHora)

  const alturaTotal = (JANELA_FIM_MIN - JANELA_INICIO_MIN) * PX_POR_MIN
  const primeiraHora = Math.ceil(JANELA_INICIO_MIN / 60)
  const ultimaHora = Math.floor(JANELA_FIM_MIN / 60)
  const horasMarcadas = Array.from({ length: ultimaHora - primeiraHora + 1 }, (_, i) => primeiraHora + i)

  return (
    <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <button onClick={onVoltarMes} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">‹ Mês</button>
        <div className="flex items-center gap-3">
          <button onClick={() => onNavegarDia(-1)} aria-label="Dia anterior"
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">‹</button>
          <p className="text-sm font-semibold text-white capitalize">
            {data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
          <button onClick={() => onNavegarDia(1)} aria-label="Próximo dia"
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">›</button>
        </div>
        <div className="w-12" />
      </div>

      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-white/5 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><i className="w-[3px] h-2.5 rounded-sm bg-indigo-500 inline-block" /> Sessão</span>
        <span className="flex items-center gap-1.5"><i className="w-[3px] h-2.5 rounded-sm bg-stone-400 inline-block" /> Compromisso</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-sm bg-green-400/60 inline-block" /> Livre — clique pra bloquear</span>
      </div>

      <div className="flex px-5 py-4">
        <div className="w-12 shrink-0 relative" style={{ height: alturaTotal }}>
          {horasMarcadas.map(h => (
            <div key={h} className="absolute right-2 text-[10px] text-gray-600 -translate-y-1/2"
              style={{ top: (h * 60 - JANELA_INICIO_MIN) * PX_POR_MIN }}>
              {h.toString().padStart(2, '0')}:00
            </div>
          ))}
        </div>

        <div className="relative flex-1 border-l border-white/5" style={{ height: alturaTotal }}>
          {horasMarcadas.map(h => (
            <div key={h} className="absolute left-0 right-0 border-t border-white/5"
              style={{ top: (h * 60 - JANELA_INICIO_MIN) * PX_POR_MIN }} />
          ))}

          {livres.map((l, i) => (
            <div key={`livre-${i}`}
              onClick={() => onClickLivre(horaParaData(data, l.inicio), horaParaData(data, l.fim))}
              className="absolute left-0 right-0 group cursor-pointer bg-green-500/[0.04] hover:bg-green-500/10 rounded-lg transition-colors flex items-center px-3"
              style={{ top: (l.inicio - JANELA_INICIO_MIN) * PX_POR_MIN, height: (l.fim - l.inicio) * PX_POR_MIN }}>
              <span className="text-[11px] text-green-500/40 group-hover:text-green-400 transition-colors">
                + {fmtDuracao(l.fim - l.inicio)} livre
              </span>
            </div>
          ))}

          {sessoesComHorario.map(({ sessao, inicio, fim }) => {
            const inicioClamp = clamp(JANELA_INICIO_MIN, inicio, JANELA_FIM_MIN)
            const fimClamp = clamp(JANELA_INICIO_MIN, fim, JANELA_FIM_MIN)
            return (
              <button key={sessao.id} onClick={() => onClickSessao(sessao)}
                className="absolute left-0 right-2 text-left rounded-r-lg border-l-[3px] border-indigo-500 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors px-2.5 py-1 overflow-hidden"
                style={{ top: (inicioClamp - JANELA_INICIO_MIN) * PX_POR_MIN, height: Math.max((fimClamp - inicioClamp) * PX_POR_MIN, 20) }}>
                <p className="text-[11px] font-medium text-indigo-200 truncate">{sessao.paciente_nome}</p>
                <p className="text-[10px] text-indigo-400/80 truncate">{fmtHora(inicio)}–{fmtHora(fim)} · Sessão {sessao.numero_sessao}/{sessao.total_sessoes}</p>
              </button>
            )
          })}

          {compromissosComHorario.map(({ compromisso, inicio, fim }) => {
            const inicioClamp = clamp(JANELA_INICIO_MIN, inicio, JANELA_FIM_MIN)
            const fimClamp = clamp(JANELA_INICIO_MIN, fim, JANELA_FIM_MIN)
            // Categoria escolhida no lançamento manual decide a cor do bloco —
            // "sessao" usa a mesma cor indigo das sessões reais, "compromisso"
            // usa o cinza-pedra padrão.
            const isSessao = compromisso.categoria === 'sessao'
            return (
              <button key={compromisso.id} onClick={() => onClickCompromisso(compromisso)}
                className={`absolute left-0 right-2 text-left rounded-r-lg border-l-[3px] transition-colors px-2.5 py-1 overflow-hidden ${
                  isSessao
                    ? 'border-indigo-500 bg-indigo-500/10 hover:bg-indigo-500/20'
                    : 'border-stone-400 bg-stone-400/10 hover:bg-stone-400/20'
                }`}
                style={{ top: (inicioClamp - JANELA_INICIO_MIN) * PX_POR_MIN, height: Math.max((fimClamp - inicioClamp) * PX_POR_MIN, 20) }}>
                <p className={`text-[11px] font-medium truncate ${isSessao ? 'text-indigo-200' : 'text-stone-300'}`}>🔒 {compromisso.titulo}</p>
                <p className={`text-[10px] truncate ${isSessao ? 'text-indigo-400/80' : 'text-stone-500'}`}>{fmtHora(inicio)}–{fmtHora(fim)}</p>
              </button>
            )
          })}

          {isHoje && agoraMin >= JANELA_INICIO_MIN && agoraMin <= JANELA_FIM_MIN && (
            <div className="absolute left-0 right-0 h-px bg-red-400 z-10"
              style={{ top: (agoraMin - JANELA_INICIO_MIN) * PX_POR_MIN }}>
              <span className="absolute -left-1 -top-[3px] w-[7px] h-[7px] rounded-full bg-red-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
