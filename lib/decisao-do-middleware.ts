// lib/decisao-do-middleware.ts
//
// A parte do middleware que decide, sem tocar em banco nem em rede - por isso
// testavel direto, sem subir servidor nem falar com o Supabase.
//
// Fica fora de middleware.ts DE PROPOSITO: `npm test` roda so `lib/*.test.ts`,
// e o middleware.ts (raiz, runtime Edge) nunca entraria nessa varredura. Sem
// esta separacao, a regra mais critica do arquivo - apagar cabecalho forjado
// antes de escrever o verdadeiro - so seria provada subindo servidor.

import { CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'

export type ContaDoSistema = {
  origem: 'sistema'
  id: string
  email: string
  tipo: string
  terapeutaId: string | null
}

export type ContaDoDashboard = {
  origem: 'dashboard'
  id: string
  email: string
  role: string
}

export type Conta = ContaDoSistema | ContaDoDashboard

/** O formato da linha que volta de `usuarios_sistema`. */
export type RegistroSistema = {
  id: string
  email: string
  tipo: string
  terapeuta_id: string | null
  session_token_expira_em: string | null
}

/** O formato da linha que volta de `usuarios_dashboard`. */
export type RegistroDashboard = {
  id: string
  email: string
  role: string
  session_token_expira_em: string | null
}

export type ContaAchada = { conta: Conta; expiraEm: string | null }

/**
 * Unifica as duas tabelas de login (independentes, nao se falam) num so
 * formato. Prioridade para `usuarios_sistema` quando as duas viessem
 * preenchidas - o middleware ja garante que isso nunca acontece (so consulta
 * `usuarios_dashboard` quando `usuarios_sistema` nao achou nada), mas a funcao
 * fica defensiva mesmo assim.
 */
export function contaEncontrada(
  doSistema: RegistroSistema | null,
  doDashboard: RegistroDashboard | null,
): ContaAchada | null {
  if (doSistema) {
    return {
      conta: {
        origem: 'sistema',
        id: doSistema.id,
        email: doSistema.email,
        tipo: doSistema.tipo,
        terapeutaId: doSistema.terapeuta_id,
      },
      expiraEm: doSistema.session_token_expira_em,
    }
  }
  if (doDashboard) {
    return {
      conta: {
        origem: 'dashboard',
        id: doDashboard.id,
        email: doDashboard.email,
        role: doDashboard.role,
      },
      expiraEm: doDashboard.session_token_expira_em,
    }
  }
  return null
}

export type Recusa = { tipo: 'recusado'; motivo: 'sem_cracha' | 'vencido' }
export type Autorizacao = { tipo: 'autorizado'; conta: Conta }
export type DecisaoDeAcesso = Recusa | Autorizacao

/**
 * A decisao inteira de autenticacao, sem IO: dado o que a consulta ao banco
 * achou (ou nao achou) e se o cracha esta vencido, decide recusar ou
 * autorizar.
 *
 * Chamar SO depois de confirmar que a rota nao e aberta (`ehRotaAberta`) e que
 * existe um cracha no cabecalho - as duas coisas que dispensam consulta ao
 * banco e nao pertencem a decisao daqui.
 */
export function decidirAcesso(achado: ContaAchada | null, crachaEstaVencido: boolean): DecisaoDeAcesso {
  if (!achado) return { tipo: 'recusado', motivo: 'sem_cracha' }
  if (crachaEstaVencido) return { tipo: 'recusado', motivo: 'vencido' }
  return { tipo: 'autorizado', conta: achado.conta }
}

/**
 * Monta os cabecalhos de identidade que a rota vai receber.
 *
 * APAGA os quatro cabecalhos ANTES de escrever - nesta ordem, nunca ao
 * contrario. Sem isto, quem chama mandaria `x-spr-quem-tipo: dashboard:admin`
 * direto no cabecalho e a rota trataria como admin de verdade. Este e o teste
 * mais importante do arquivo: ver 'forja e apagada' no arquivo de teste.
 *
 * Nao muda nenhum outro cabecalho da entrada - so os quatro da identidade.
 */
export function construirCabecalhosDeIdentidade(headersEntrada: Headers, conta: Conta): Headers {
  const cabecalhos = new Headers(headersEntrada)
  for (const c of Object.values(CABECALHOS_DA_IDENTIDADE)) cabecalhos.delete(c)

  if (conta.origem === 'sistema') {
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.tipo, `sistema:${conta.tipo}`)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.id, conta.id)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.email, conta.email)
    // So escreve quando existe: um socio (`terapeutaId: null`) nao pode
    // acabar com o cabecalho de um terapeuta anterior que tenha sobrado.
    if (conta.terapeutaId) cabecalhos.set(CABECALHOS_DA_IDENTIDADE.terapeutaId, conta.terapeutaId)
  } else {
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.tipo, `dashboard:${conta.role}`)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.id, conta.id)
    cabecalhos.set(CABECALHOS_DA_IDENTIDADE.email, conta.email)
  }
  return cabecalhos
}
