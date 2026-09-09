'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, X, RefreshCw, AlertTriangle } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import { getSession } from '@/lib/auth'
import type { AlertaEstorno } from '@/lib/estorno-com-sessao'
import { rotuloDaOcorrencia, textoDaDiferenca } from '@/lib/conferencia-de-pacote'

// Dados ao vivo — sem isso a Vercel cacheia a página como estática e serve
// versões antigas do CDN mesmo depois de um deploy novo.
export const dynamic = 'force-dynamic'

type TerapeutaSession = { nome: string; email: string; tipo: string }

type Solicitacao = {
  id: string
  sale_id: string
  paciente_nome: string
  paciente_email: string
  sessoes_ids: string[]
  sessoes_numeros: number[]
  valor_reembolso: number
  motivo: string
  solicitado_por_nome: string
  solicitado_por_tipo: string
  solicitado_por_email: string
  status: string
  aprovado_por_nome: string | null
  aprovado_por_email: string | null
  justificativa_rejeicao: string | null
  created_at: string
  updated_at: string
}

function fmtBRL(n: number) {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}

export default function TerapeutasAprovacoes() {
  const [pendentes, setPendentes] = useState<Solicitacao[]>([])
  const [historico, setHistorico] = useState<Solicitacao[]>([])
  // Respostas do comercial sobre pacote pago em mais de uma compra. Ficam numa
  // seção própria, e não na fila de aprovações: aqui nada espera decisão sua -
  // o comercial já respondeu e já agendou. É conferência, não autorização.
  const [ocorrenciasPacote, setOcorrenciasPacote] = useState<{
    id: string; paciente_nome: string; produto: string; tipo: string
    diferenca: number | null; sessoes_do_pacote: number | null
    paciente_paga_diferenca: boolean | null; havera_outra_compra: boolean | null
    justificativa: string | null; respondido_por_nome: string; created_at: string
  }[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [adminEmail, setAdminEmail] = useState('rafael@spr.com')
  const [sessionNome, setSessionNome] = useState('')

  // Toast
  const [toast, setToast] = useState('')
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 3500)
  }

  // Modal aprovar
  const [aprovarId, setAprovarId] = useState<string | null>(null)
  const [ocorrenciasErro, setOcorrenciasErro] = useState('')
  const [estornos, setEstornos] = useState<AlertaEstorno[]>([])
  const [lancamentos, setLancamentos] = useState<Record<string, unknown>[]>([])
  // Sem isto, o lancamento SOME da tela depois de decidido: a API ja devolvia o
  // historico e a tela lia so os pendentes. O usuario aprovou o primeiro e nao
  // achou mais nada.
  const [lancHistorico, setLancHistorico] = useState<Record<string, unknown>[]>([])
  const [lancDecidindo, setLancDecidindo] = useState<string | null>(null)
  const [lancMotivo, setLancMotivo] = useState('')
  const [lancErro, setLancErro] = useState('')
  const [lancSenhaOpen, setLancSenhaOpen] = useState(false)
  const [lancPendente, setLancPendente] = useState<{ id: string; acao: 'aprovar' | 'rejeitar' } | null>(null)
  const [aprovarSenhaOpen, setAprovarSenhaOpen] = useState(false)
  const [aprovarLoading, setAprovarLoading] = useState(false)
  const [aprovarErro, setAprovarErro] = useState('')

  // Modal rejeitar
  const [rejeitarId, setRejeitarId] = useState<string | null>(null)
  const [rejeitarJustificativa, setRejeitarJustificativa] = useState('')
  const [rejeitarSenhaOpen, setRejeitarSenhaOpen] = useState(false)
  const [rejeitarLoading, setRejeitarLoading] = useState(false)
  const [rejeitarErro, setRejeitarErro] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const res = await fetch('/api/terapeutas/aprovacoes')
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setPendentes(json.pendentes ?? [])
      setHistorico(json.historico ?? [])
    } catch (e) {
      setErro(String(e))
    } finally {
      setLoading(false)
    }

    // A conferência de pacotes vem DEPOIS de `setLoading(false)`, e de
    // propósito. Ela é seção informativa; a fila de reembolsos é a razão de a
    // tela existir. Enquanto este `await` ficava dentro do try que controla o
    // `loading`, um fetch pendurado - sem rejeitar, sem timeout: Vercel lenta,
    // rede em suspensão, aba voltando do sono - deixava a tela inteira no
    // spinner para sempre, com os reembolsos já carregados e invisíveis.
    //
    // O AbortController fecha a outra metade: sem ele, "pendurado" não vira
    // erro nunca, e a seção ficaria carregando em silêncio.
    // Lancamentos manuais esperando decisao. Fora do try do loading pelo mesmo
    // motivo dos outros: falha aqui nao pode derrubar a fila de reembolsos.
    try {
      const r4 = await fetch(`/api/terapeutas/aprovacoes/lancamento-manual?usuario_email=${encodeURIComponent(adminEmail)}`, { cache: 'no-store' })
      const j4 = await r4.json()
      if (r4.ok) {
        setLancamentos(j4.pendentes ?? [])
        setLancHistorico(j4.historico ?? [])
      }
    } catch { /* secao fica vazia */ }

    // Estorno na plataforma com sessao futura. Mesmo tratamento da conferencia
    // de pacotes: fora do try do loading, com timeout, e falha visivel.
    try {
      const r3 = await fetch(`/api/terapeutas/estornos-com-sessao?usuario_email=${encodeURIComponent(adminEmail)}`, { cache: 'no-store' })
      const j3 = await r3.json()
      if (r3.ok) setEstornos(j3.alertas ?? [])
    } catch { /* secao fica vazia */ }

    setOcorrenciasErro('')
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    try {
      const r2 = await fetch(`/api/terapeutas/vendas/pacote?usuario_email=${encodeURIComponent(adminEmail)}`, { cache: 'no-store', signal: ctrl.signal })
      const j2 = await r2.json()
      if (!r2.ok) throw new Error(j2.error ?? `HTTP ${r2.status}`)
      setOcorrenciasPacote(j2.ocorrencias ?? [])
    } catch (e) {
      // Silêncio é a pior resposta numa tela cuja função é conferir: o CEO não
      // distinguia "não há nada a conferir" de "a conferência falhou".
      setOcorrenciasErro(e instanceof Error ? e.message : String(e))
    } finally {
      clearTimeout(t)
    }
  }, [adminEmail])

  useEffect(() => { loadData() }, [loadData])

  // Aprovar CRIA o lancamento inteiro (venda, sessoes, Meet, comissao) e
  // libera os horarios reservados. Recusar nao deixa residuo: nada foi criado,
  // so os bloqueios somem. Ver app/api/terapeutas/aprovacoes/lancamento-manual.
  // Guarda a decisao ate a senha ser digitada: toda acao que muda dado nesta
  // tela pede senha, e criar venda + sessoes + evento no Google e a que mais
  // muda.
  async function decidirLancamento(id: string, acao: 'aprovar' | 'rejeitar') {
    if (acao === 'rejeitar' && lancMotivo.trim().length < 10) {
      setLancErro('Escreva o motivo da recusa (mínimo 10 letras).')
      return
    }
    setLancPendente({ id, acao })
    setLancSenhaOpen(true)
  }

  async function confirmarLancamento(senhaAcao: string) {
    if (!lancPendente) return
    const { id, acao } = lancPendente
    setLancErro('')
    try {
      const res = await fetch('/api/terapeutas/aprovacoes/lancamento-manual', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solicitacao_id: id, acao,
          justificativa: acao === 'rejeitar' ? lancMotivo : undefined,
          usuario_email: adminEmail, senha: senhaAcao,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setLancErro(json.error ?? `Erro ${res.status}`); return }
      setLancSenhaOpen(false); setLancPendente(null)
      setLancDecidindo(null); setLancMotivo('')
      loadData()
    } catch (e) {
      setLancErro(e instanceof Error ? e.message : String(e))
    }
  }

  // "Seu e-mail" ficava sempre travado em rafael@spr.com por padrão — pra
  // qualquer outro usuário logado (comercial, outro admin) as ações com
  // senha nunca batiam, porque tentavam validar a senha dele contra a conta
  // errada. Carrega o e-mail/nome reais da sessão.
  //
  // terapeutas_session tem prioridade sobre o login do dashboard principal:
  // a senha aqui é validada contra usuarios_sistema (tabela do módulo de
  // terapeutas), então um spr_session esquecido no navegador (de outra
  // conta, ou de um teste anterior) sempre falha com "Senha inválida" se
  // for usado em vez do login real da pessoa no módulo.
  useEffect(() => {
    const raw = localStorage.getItem('terapeutas_session')
    if (raw) {
      try {
        const session = JSON.parse(raw) as TerapeutaSession
        setAdminEmail(session.email)
        setSessionNome(session.nome)
        return
      } catch { /* ignore, cai pro fallback abaixo */ }
    }
    const adminSession = getSession()
    if (adminSession) {
      setAdminEmail(adminSession.email)
      setSessionNome(adminSession.name)
    }
  }, [])

  function nomeFromEmail(email: string) {
    return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  async function handleAprovar(senha: string) {
    if (!aprovarId) return
    setAprovarLoading(true); setAprovarErro('')
    const res = await fetch('/api/terapeutas/aprovacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: aprovarId,
        acao: 'aprovar',
        senha,
        usuario_nome: sessionNome || nomeFromEmail(adminEmail),
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setAprovarLoading(false)
    if (!res.ok) { setAprovarErro(json.error ?? 'Erro'); return }
    setAprovarSenhaOpen(false)
    setAprovarId(null)
    showToast('✓ Reembolso aprovado e sessões canceladas!')
    loadData()
  }

  async function handleRejeitar(senha: string) {
    if (!rejeitarId) return
    if (rejeitarJustificativa.trim().length < 10) {
      setRejeitarErro('Justificativa obrigatória (mínimo 10 caracteres)')
      return
    }
    setRejeitarLoading(true); setRejeitarErro('')
    const res = await fetch('/api/terapeutas/aprovacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: rejeitarId,
        acao: 'rejeitar',
        justificativa: rejeitarJustificativa,
        senha,
        usuario_nome: sessionNome || nomeFromEmail(adminEmail),
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setRejeitarLoading(false)
    if (!res.ok) { setRejeitarErro(json.error ?? 'Erro'); return }
    setRejeitarSenhaOpen(false)
    setRejeitarId(null)
    setRejeitarJustificativa('')
    showToast('✓ Solicitação rejeitada.')
    loadData()
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-6">

        {/* Cabeçalho */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Aprovações Pendentes</h1>
            <p className="text-sm text-gray-400 mt-1">Solicitações aguardando sua decisão</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">Seu e-mail:</span>
            <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 w-48" />
            <button onClick={loadData} className="p-1.5 text-gray-500 hover:text-white transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Badge de alerta */}
        {!loading && pendentes.length > 0 && (
          <div className="mb-5 flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-sm font-medium text-red-400">
                {pendentes.length} solicitação(ões) aguardando aprovação
              </span>
            </span>
          </div>
        )}

        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{erro}</div>
        )}

        {loading ? (
          <div className="flex justify-center h-40 items-center">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Pendentes */}
            <div className="space-y-4 mb-8">
              {pendentes.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle className="w-10 h-10 text-green-500/40 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">Nenhuma solicitação pendente</p>
                  <p className="text-xs text-gray-600 mt-1">Tudo em dia!</p>
                </div>
              ) : pendentes.map(sol => (
                <div key={sol.id} className="bg-gray-900 border border-orange-500/20 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="px-5 py-4 border-b border-white/5 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{sol.paciente_nome}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{sol.paciente_email}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Solicitado em</p>
                      <p className="text-xs text-gray-300">{fmtDt(sol.created_at)}</p>
                    </div>
                  </div>

                  <div className="px-5 py-4 space-y-4">
                    {/* Solicitante */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Solicitado por:</span>
                      <span className="text-white font-medium">{sol.solicitado_por_nome}</span>
                      <span className="text-indigo-400 capitalize bg-indigo-400/10 px-2 py-0.5 rounded-full">{sol.solicitado_por_tipo}</span>
                    </div>

                    {/* Sessões */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Sessões a cancelar:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(sol.sessoes_numeros as number[]).map(n => (
                          <span key={n} className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded">
                            Sessão {n}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Valor */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Valor a reembolsar:</span>
                      <span className="text-xl font-bold text-red-400">{fmtBRL(sol.valor_reembolso)}</span>
                    </div>

                    {/* Motivo */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Motivo:</p>
                      <div className="bg-gray-800/60 rounded-lg p-3 text-xs text-gray-300 leading-relaxed">{sol.motivo}</div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-3 pt-1">
                      <button onClick={() => { setAprovarId(sol.id); setAprovarErro(''); setAprovarSenhaOpen(true) }}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors">
                        <CheckCircle className="w-3.5 h-3.5" /> Aprovar reembolso
                      </button>
                      <button onClick={() => { setRejeitarId(sol.id); setRejeitarJustificativa(''); setRejeitarErro('') }}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                        <X className="w-3.5 h-3.5" /> Rejeitar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pacotes pagos em mais de uma compra. Não é fila de decisão: o
                comercial já respondeu e já agendou. Fica aqui para o CEO
                conferir, do jeito que ele pediu - "assim como já acontece com
                os reembolsos". */}
            {/* Lancamento manual esperando aprovacao. Decisao do usuario em
                09/09/2026: o comercial pede, o CEO aprova, e SO ENTAO o sistema
                cria venda, sessoes, Meet e prontuario. Agendamento de venda
                real da plataforma nao passa por aqui. */}
            {lancamentos.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-amber-300 uppercase tracking-wide mb-1">Lançamentos manuais aguardando você</h2>
                <p className="text-[11px] text-gray-600 mb-3">
                  Nada foi criado ainda. Os horários estão reservados na agenda até você decidir.
                </p>
                <div className="bg-gray-900 border border-amber-500/30 rounded-xl divide-y divide-white/5">
                  {lancamentos.map(l => {
                    const id = String(l.id)
                    const jaTem = (l.vendas_que_ja_existem as Record<string, unknown>[] | undefined) ?? []
                    const mesmoProduto = jaTem.filter(v => String(v.produto ?? '').trim().toLowerCase() === String(l.produto ?? '').trim().toLowerCase())
                    return (
                      <div key={id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-gray-200">{String(l.paciente_nome ?? '(sem nome)')}</p>
                            <p className="text-[11px] text-gray-500">{String(l.produto ?? '-')} · {fmtBRL(Number(l.valor_pago_cliente ?? 0))} · {String(l.terapeuta_nome ?? '-')}</p>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0 bg-amber-500/20 text-amber-300 border-amber-500/40">
                            Aguardando
                          </span>
                        </div>
                        <div className="mt-2 space-y-0.5 text-[11px] text-gray-400">
                          <p>
                            {String(l.total_sessoes ?? 0)} sessões · {String(l.sessoes_entregues ?? 0)} já entregues
                            {l.proxima_sessao_data ? ` · próxima em ${fmtDt(String(l.proxima_sessao_data))}` : ''}
                          </p>
                          <p className="text-gray-600">Pedido por {String(l.solicitado_por_nome ?? '-')} · {fmtDt(String(l.created_at))}</p>
                        </div>

                        {/* O que o paciente JA TEM. Era isto que faltava em 04/08. */}
                        {mesmoProduto.length > 0 && (
                          <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                            <p className="text-[11px] text-red-300 font-medium">
                              Este paciente já tem {mesmoProduto.length} venda(s) deste MESMO produto:
                            </p>
                            {mesmoProduto.map(v => (
                              <p key={String(v.id)} className="text-[11px] text-red-400/80">
                                {fmtBRL(Number(v.valor_pago_cliente ?? 0))} de {fmtDt(String(v.data_hora))} · {String(v.sessoes ?? 0)} sessão(ões) · {String(v.status ?? '-')}
                              </p>
                            ))}
                          </div>
                        )}

                        {lancDecidindo === id ? (
                          <div className="mt-3 space-y-2">
                            <input type="text" value={lancMotivo} onChange={e => setLancMotivo(e.target.value)}
                              placeholder="Motivo da recusa (mín. 10 letras)"
                              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" />
                            {lancErro && <p className="text-[11px] text-red-400">{lancErro}</p>}
                            <div className="flex gap-2">
                              <button onClick={() => { setLancDecidindo(null); setLancMotivo(''); setLancErro('') }}
                                className="flex-1 py-2 text-xs text-gray-300 bg-gray-800 border border-white/10 rounded-lg">Voltar</button>
                              <button onClick={() => decidirLancamento(id, 'rejeitar')}
                                className="flex-1 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg">Confirmar recusa</button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 flex gap-2">
                            <button onClick={() => { setLancDecidindo(id); setLancMotivo(''); setLancErro('') }}
                              className="flex-1 py-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20">Recusar</button>
                            <button onClick={() => decidirLancamento(id, 'aprovar')}
                              className="flex-1 py-2 text-xs font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg">Aprovar e criar</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {lancHistorico.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Lançamentos manuais já decididos</h2>
                <p className="text-[11px] text-gray-600 mb-3">Registro do que você aprovou ou recusou.</p>
                <div className="bg-gray-900 border border-white/10 rounded-xl divide-y divide-white/5">
                  {lancHistorico.map(l => {
                    const aprovado = l.status === 'aprovado'
                    const sessoes = Number(l.sessoes_criadas ?? 0)
                    return (
                      <div key={String(l.id)} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-gray-200">{String(l.paciente_nome ?? '(sem nome)')}</p>
                            <p className="text-[11px] text-gray-500">{String(l.produto ?? '-')} · {fmtBRL(Number(l.valor_pago_cliente ?? 0))} · {String(l.terapeuta_nome ?? '-')}</p>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0 ${
                            aprovado ? 'bg-green-500/20 text-green-300 border-green-500/40'
                            : 'bg-red-500/20 text-red-300 border-red-500/40'}`}>
                            {aprovado ? 'Aprovado' : 'Recusado'}
                          </span>
                        </div>
                        <div className="mt-2 space-y-0.5 text-[11px] text-gray-400">
                          <p>Pedido por {String(l.solicitado_por_nome ?? '-')} · decidido por {String(l.decidido_por_nome ?? '-')} em {fmtDt(String(l.decidido_em ?? l.created_at))}</p>
                          {aprovado && (
                            /* Zero sessoes acontece quando o pedido veio sem a
                               data da primeira sessao - o campo e opcional. A
                               venda existe e as sessoes precisam ser agendadas
                               pelo prontuario. Foi o caso do primeiro uso real. */
                            <p className={sessoes === 0 ? 'text-amber-400' : ''}>
                              {sessoes === 0
                                ? 'Venda criada SEM sessão: o pedido veio sem a data da 1ª sessão. Precisa agendar pelo prontuário.'
                                : `${sessoes} ${sessoes === 1 ? 'sessão criada' : 'sessões criadas'}`}
                            </p>
                          )}
                          {l.justificativa_decisao ? <p className="text-gray-300">&ldquo;{String(l.justificativa_decisao)}&rdquo;</p> : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Estorno que veio DE FORA (o cliente pediu reembolso na plataforma
                ou deu chargeback) e a sessao continuou marcada. O caminho de
                dentro - reembolso pedido pela tela e aprovado aqui - ja cancela
                as sessoes; este e o buraco do de fora. */}
            {estornos.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-red-300 uppercase tracking-wide mb-1">Estorno na plataforma com sessão marcada</h2>
                <p className="text-[11px] text-gray-600 mb-3">
                  O cliente estornou e a sessão continua na agenda. Decida se cancela ou se foi combinado.
                </p>
                <div className="bg-gray-900 border border-red-500/30 rounded-xl divide-y divide-white/5">
                  {estornos.map(e => (
                    <div key={e.saleId} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-gray-200">{e.nome}</p>
                          <p className="text-[11px] text-gray-500">{e.produto} · {fmtBRL(e.valor)}</p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0 bg-red-500/20 text-red-300 border-red-500/40">
                          {e.status === 'chargeback' ? 'Chargeback' : e.status === 'em_protesto' ? 'Em protesto' : 'Reembolsada'}
                        </span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[11px] text-gray-400">
                        {e.dataReembolso && <p>Estornado em {fmtDt(e.dataReembolso)}</p>}
                        <p className="text-red-300">
                          {e.sessoes.length} {e.sessoes.length === 1 ? 'sessão ainda marcada' : 'sessões ainda marcadas'}:{' '}
                          {e.sessoes.map(s => fmtDt(s.dataISO)).join(', ')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {ocorrenciasErro && (
              <div className="mb-8 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <p className="text-sm text-amber-300">Não foi possível carregar os pacotes conferidos pelo comercial.</p>
                <p className="text-[11px] text-amber-400/80 mt-1">{ocorrenciasErro}</p>
                <button onClick={loadData} className="mt-2 text-[11px] underline text-amber-300">Tentar de novo</button>
              </div>
            )}
            {ocorrenciasPacote.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Pacotes e valores conferidos pelo comercial</h2>
                <p className="text-[11px] text-gray-600 mb-3">Nada aqui espera decisão sua. É registro do que o comercial respondeu ao agendar.</p>
                <div className="bg-gray-900 border border-white/10 rounded-xl divide-y divide-white/5">
                  {ocorrenciasPacote.map(o => (
                    <div key={o.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-gray-200">{o.paciente_nome}</p>
                          <p className="text-[11px] text-gray-500">{o.produto}</p>
                        </div>
<OcorrenciaBadge o={o} />
                      </div>
                      <div className="mt-2 space-y-0.5 text-[11px] text-gray-400">
                        {o.sessoes_do_pacote != null && <p>Pacote de {o.sessoes_do_pacote} {o.sessoes_do_pacote === 1 ? 'sessão' : 'sessões'}</p>}
                        {textoDaDiferenca(o.diferenca) && (
                          <p className={(o.diferenca ?? 0) > 0 ? 'text-amber-400' : 'text-gray-400'}>
                            {textoDaDiferenca(o.diferenca)}
                          </p>
                        )}
                        {o.paciente_paga_diferenca != null && <p>Paciente vai pagar a diferença: <span className="text-gray-300">{o.paciente_paga_diferenca ? 'sim' : 'não'}</span></p>}
                        {o.havera_outra_compra != null && <p>Vai haver outra compra: <span className="text-gray-300">{o.havera_outra_compra ? 'sim' : 'não'}</span></p>}
                        {o.justificativa && <p className="text-gray-300 mt-1">&ldquo;{o.justificativa}&rdquo;</p>}
                        <p className="text-gray-600 pt-1">{o.respondido_por_nome} · {fmtDt(o.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Histórico */}
            {historico.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Histórico</h2>
                <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          {['Data', 'Paciente', 'Valor', 'Status', 'Decidido por', 'Data decisão'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {historico.map(sol => (
                          <tr key={sol.id} className="border-b border-white/5 hover:bg-white/2">
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sol.created_at)}</td>
                            <td className="px-4 py-3">
                              <p className="text-white text-xs">{sol.paciente_nome}</p>
                              <p className="text-[10px] text-gray-500">{sol.paciente_email}</p>
                            </td>
                            <td className="px-4 py-3 text-red-400 text-xs whitespace-nowrap">{fmtBRL(sol.valor_reembolso)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                                sol.status === 'aprovado' ? 'text-green-500 bg-green-500/10' : 'text-red-400 bg-red-400/10'
                              }`}>
                                {sol.status === 'aprovado' ? '✓ Aprovado' : '✗ Rejeitado'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-300 text-xs">{sol.aprovado_por_nome ?? '—'}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sol.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Modal rejeitar (inline) */}
      {rejeitarId && !rejeitarSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Rejeitar solicitação</h3>
              <button onClick={() => { setRejeitarId(null); setRejeitarJustificativa('') }} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mb-4">
              <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg p-3 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-400">A solicitação será rejeitada e o paciente continuará com as sessões ativas.</p>
              </div>
              <label className="text-xs text-gray-400 block mb-2">Justificativa <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
              <textarea value={rejeitarJustificativa} onChange={e => setRejeitarJustificativa(e.target.value)} rows={4}
                placeholder="Explique o motivo da rejeição..."
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
              {rejeitarErro && <p className="text-xs text-red-400 mt-1">{rejeitarErro}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setRejeitarId(null); setRejeitarJustificativa('') }}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (rejeitarJustificativa.trim().length < 10) { setRejeitarErro('Justificativa obrigatória (mínimo 10 caracteres)'); return }
                setRejeitarErro(''); setRejeitarSenhaOpen(true)
              }} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal isOpen={lancSenhaOpen}
        onClose={() => { setLancSenhaOpen(false); setLancPendente(null); setLancErro('') }}
        onConfirm={confirmarLancamento}
        titulo={lancPendente?.acao === 'aprovar' ? 'Aprovar lançamento manual' : 'Recusar lançamento manual'}
        descricao={lancPendente?.acao === 'aprovar'
          ? 'Ao confirmar, o sistema cria a venda, as sessões, o link do Meet e a comissão, e libera os horários reservados.'
          : 'Nada foi criado, então recusar só libera os horários que estavam reservados na agenda.'}
        loading={false} erro={lancErro} />

      <SenhaModal isOpen={aprovarSenhaOpen} onClose={() => { setAprovarSenhaOpen(false); setAprovarErro('') }}
        onConfirm={handleAprovar} titulo="Confirmar aprovação de reembolso"
        descricao="Esta ação cancelará as sessões selecionadas. Digite sua senha para confirmar."
        loading={aprovarLoading} erro={aprovarErro} />

      <SenhaModal isOpen={rejeitarSenhaOpen} onClose={() => { setRejeitarSenhaOpen(false); setRejeitarErro('') }}
        onConfirm={handleRejeitar} titulo="Confirmar rejeição"
        descricao="Digite sua senha para registrar a rejeição da solicitação."
        loading={rejeitarLoading} erro={rejeitarErro} />

      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-800 border border-white/10 text-white text-xs px-4 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}

      <MobileNav />
    </div>
  )
}

// As quatro aparências do rótulo. O TEXTO vem de lib/conferencia-de-pacote.ts,
// onde os testes o alcançam; aqui fica só a cor.
const CORES_DO_ROTULO: Record<string, string> = {
  juntadas: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  divergente: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  desfeita: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  separadas: 'bg-gray-700/40 text-gray-300 border-white/10',
  informada: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
}

function OcorrenciaBadge({ o }: { o: { tipo: string; justificativa?: string | null } }) {
  const r = rotuloDaOcorrencia(o)
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0 ${CORES_DO_ROTULO[r.cor]}`}>
      {r.texto}
    </span>
  )
}
