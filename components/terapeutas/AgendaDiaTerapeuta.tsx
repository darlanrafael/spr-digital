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
  horariosFixos?: string[]
  onClickSessao: (sessao: SessaoDia) => void
  onClickCompromisso: (compromisso: CompromissoDia) => void
  onClickLivre: (inicio: Date, fim: Date) => void
  onNavegarDia: (direcao: -1 | 1) => void
  onVoltarMes: () => void
}

export const JANELA_INICIO_MIN = 8 * 60   // 08:00
export const JANELA_FIM_MIN = 22 * 60     // 22:00 — o último horário fixo do Pedro (21:10, 50min) termina às 22:00; 21:00 cortava esse slot fora da área visível
const PX_POR_MIN = 1

// Sempre fixa em Brasília (America/Sao_Paulo) — usar d.getHours()/getMinutes()
// direto pega o fuso local do dispositivo que está vendo a tela, não o do
// negócio. Se o computador estiver com relógio em outro fuso, os blocos da
// agenda saem na hora errada mesmo com o dado certo no banco.
export function minutosDoDia(iso: string): number {
  const d = new Date(iso)
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const hora = Number(partes.find(p => p.type === 'hour')?.value ?? 0)
  const minuto = Number(partes.find(p => p.type === 'minute')?.value ?? 0)
  return hora * 60 + minuto
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

export function fmtDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

export type Ocupado = { inicio: number; fim: number }

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
export function calcularIntervalosLivres(ocupados: Ocupado[], janelaInicio: number, janelaFim: number): Ocupado[] {
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

function horarioParaMinutos(horario: string): number {
  const [h, m] = horario.split(':').map(Number)
  return h * 60 + m
}

// Conta quantos horários fixos (ex: os 14 do Pedro) NÃO batem com nada em
// `ocupados` (sessão ou compromisso já ocupando aquele intervalo) — usado
// pelo preview do card de mês pra terapeuta de horário fixo.
export function contarSlotsLivres(horariosFixos: string[], ocupados: Ocupado[], duracaoMinutos: number): number {
  return horariosFixos.filter(h => {
    const inicio = horarioParaMinutos(h)
    const fim = inicio + duracaoMinutos
    return !ocupados.some(o => inicio < o.fim && fim > o.inicio)
  }).length
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
  data, sessoes, compromissos, duracaoSessaoMinutos, horariosFixos = [],
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
  // Terapeuta de horário fixo (ex: Pedro): só os horários da lista contam
  // como "livre" — cada um vira um bloco do tamanho exato da duração da
  // sessão, não uma faixa contínua. Terapeuta sem lista (padrão) mantém o
  // comportamento de sempre: qualquer vão vira livre, picado em pedaços de
  // até 1h pro hover não destacar tudo de uma vez.
  const livres = horariosFixos.length > 0
    ? horariosFixos
        .map(h => ({ inicio: horarioParaMinutos(h), fim: horarioParaMinutos(h) + duracaoSessaoMinutos }))
        .filter(slot => !ocupados.some(o => slot.inicio < o.fim && slot.fim > o.inicio))
    : calcularIntervalosLivres(ocupados, JANELA_INICIO_MIN, JANELA_FIM_MIN).flatMap(fatiarLivrePorHora)

  const alturaTotal = (JANELA_FIM_MIN - JANELA_INICIO_MIN) * PX_POR_MIN
  // Terapeuta de horário fixo: a régua lateral mostra os horários exatos da
  // grade dele (ex: 09:40, 10:30...), não a hora cheia genérica — senão a
  // régua não bate com onde os blocos de fato aparecem na tela.
  const marcas = horariosFixos.length > 0
    ? horariosFixos
        .map(h => ({ minuto: horarioParaMinutos(h), label: h }))
        .sort((a, b) => a.minuto - b.minuto)
    : Array.from(
        { length: Math.floor(JANELA_FIM_MIN / 60) - Math.ceil(JANELA_INICIO_MIN / 60) + 1 },
        (_, i) => {
          const h = Math.ceil(JANELA_INICIO_MIN / 60) + i
          return { minuto: h * 60, label: `${h.toString().padStart(2, '0')}:00` }
        },
      )

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

      {horariosFixos.length > 0 ? (
        // Terapeuta de horário fixo: lista compacta, uma linha por horário da
        // grade dele, sem espaço proporcional ao relógio — a régua de tempo
        // contínua criava "buracos" visuais nos intervalos entre horários
        // (ex: janela de almoço), que não fazem sentido pra quem só atende
        // nesses horários exatos, não numa agenda de horário livre.
        <div className="divide-y divide-white/5">
          {marcas.map(m => {
            const fimSlot = m.minuto + duracaoSessaoMinutos
            const sessaoAqui = sessoesComHorario.find(s => m.minuto < s.fim && fimSlot > s.inicio)
            const compromissoAqui = !sessaoAqui
              ? compromissosComHorario.find(c => m.minuto < c.fim && fimSlot > c.inicio)
              : undefined

            if (sessaoAqui) {
              const { sessao, inicio, fim } = sessaoAqui
              return (
                <button key={m.minuto} onClick={() => onClickSessao(sessao)}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/5 transition-colors">
                  <span className="w-12 shrink-0 text-[11px] text-gray-500">{m.label}</span>
                  <span className="w-[3px] h-8 rounded-sm bg-indigo-500 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-indigo-200 truncate">{sessao.paciente_nome}</p>
                    <p className="text-[11px] text-indigo-400/80 truncate">{fmtHora(inicio)}–{fmtHora(fim)} · Sessão {sessao.numero_sessao}/{sessao.total_sessoes}</p>
                  </span>
                </button>
              )
            }

            if (compromissoAqui) {
              const { compromisso, inicio, fim } = compromissoAqui
              const isSessao = compromisso.categoria === 'sessao'
              return (
                <button key={m.minuto} onClick={() => onClickCompromisso(compromisso)}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/5 transition-colors">
                  <span className="w-12 shrink-0 text-[11px] text-gray-500">{m.label}</span>
                  <span className={`w-[3px] h-8 rounded-sm shrink-0 ${isSessao ? 'bg-indigo-500' : 'bg-stone-400'}`} />
                  <span className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${isSessao ? 'text-indigo-200' : 'text-stone-300'}`}>🔒 {compromisso.titulo}</p>
                    <p className={`text-[11px] truncate ${isSessao ? 'text-indigo-400/80' : 'text-stone-500'}`}>{fmtHora(inicio)}–{fmtHora(fim)}</p>
                  </span>
                </button>
              )
            }

            return (
              <button key={m.minuto}
                onClick={() => onClickLivre(horaParaData(data, m.minuto), horaParaData(data, fimSlot))}
                className="w-full flex items-center gap-3 px-5 py-3 text-left bg-green-500/[0.04] hover:bg-green-500/10 transition-colors">
                <span className="w-12 shrink-0 text-[11px] text-gray-500">{m.label}</span>
                <span className="w-[3px] h-8 rounded-sm bg-green-500/40 shrink-0" />
                <span className="text-[11px] text-green-500/70">Livre — clique pra bloquear</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex px-5 py-4">
          <div className="w-12 shrink-0 relative" style={{ height: alturaTotal }}>
            {marcas.map(m => (
              <div key={m.minuto} className="absolute right-2 text-[10px] text-gray-600 -translate-y-1/2"
                style={{ top: (m.minuto - JANELA_INICIO_MIN) * PX_POR_MIN }}>
                {m.label}
              </div>
            ))}
          </div>

          <div className="relative flex-1 border-l border-white/5" style={{ height: alturaTotal }}>
            {marcas.map(m => (
              <div key={m.minuto} className="absolute left-0 right-0 border-t border-white/5"
                style={{ top: (m.minuto - JANELA_INICIO_MIN) * PX_POR_MIN }} />
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
      )}
    </div>
  )
}
