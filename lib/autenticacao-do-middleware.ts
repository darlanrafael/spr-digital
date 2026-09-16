// lib/autenticacao-do-middleware.ts
//
// O caminho de BANCO que o middleware.ts percorre para descobrir quem esta
// chamando - com o cliente Supabase INJETADO, para poder testar sem rede.
//
// Fica separado de lib/decisao-do-middleware.ts de proposito: aquele arquivo
// e puro (nao faz IO nenhum); este orquestra IO (duas consultas e, quando
// precisa, a escrita da renovacao), mas atras de uma interface pequena
// (`ClienteDeContas`) que um cliente falso implementa nos testes. Sem isso, a
// regra de "duas tabelas, filtro ativo=true, falha de banco != conta
// inexistente, renovacao deslizante" so tinha prova por curl - que nao roda
// no CI e nao pega regressao (revisao da Tarefa 6, achado IMPORTANT-2).

import { crachaVencido, precisaRenovar, novaValidade } from './cracha'
import {
  contaEncontrada,
  decidirAcesso,
  type RegistroSistema,
  type RegistroDashboard,
  type Conta,
} from './decisao-do-middleware'

type ErroDeConsulta = { message: string } | null

type ConstrutorDeSelecao = {
  eq(coluna: string, valor: unknown): ConstrutorDeSelecao
  maybeSingle(): Promise<{ data: unknown; error: ErroDeConsulta }>
}

type ConstrutorDeAtualizacao = {
  eq(coluna: string, valor: unknown): Promise<{ error: ErroDeConsulta }>
}

/**
 * O pedaco do SupabaseClient que esta logica usa - pequeno de proposito, para
 * um cliente falso poder implementar sem arrastar o SDK inteiro. O cliente
 * real (`@supabase/supabase-js`) satisfaz esta forma em tempo de execucao;
 * middleware.ts casta para este tipo ao chamar, porque os tipos genéricos do
 * SDK real nao combinam estruturalmente sem isso.
 */
export interface ClienteDeContas {
  from(tabela: string): {
    select(colunas: string): ConstrutorDeSelecao
    update(valores: Record<string, unknown>): ConstrutorDeAtualizacao
  }
}

export type ResultadoDaAutenticacao =
  /**
   * A consulta ao banco FALHOU (rede, rate limit, o 525 da Cloudflare que
   * este sistema ja teve - ver lib/supabase.ts). Isto NAO e "conta invalida":
   * rotular como `recusado/sem_cracha` faria o cliente
   * (lib/cracha-no-fetch.ts, `instalarCrachaNoFetch`) tratar qualquer
   * 401-com-motivo como sessao perdida e deslogar TODO MUNDO num soluco do
   * banco. middleware.ts responde 503, sem o campo `motivo` - nunca 401.
   */
  | { tipo: 'falha_de_consulta' }
  | { tipo: 'recusado'; motivo: 'sem_cracha' | 'vencido' }
  | { tipo: 'autorizado'; conta: Conta }

/**
 * Consulta as duas tabelas de login pelo cracha, decide recusar/autorizar, e
 * renova a validade quando a janela deslizante pede - tudo com o cliente
 * injetado, testavel sem rede.
 *
 * `agoraMs` existe so para o teste poder fixar o instante (mesmo padrao de
 * lib/cracha.ts); ninguem passa em produção.
 */
export async function autenticarPeloCracha(
  client: ClienteDeContas,
  cracha: string,
  agoraMs: number = Date.now(),
): Promise<ResultadoDaAutenticacao> {
  // Procura nas DUAS areas de login. Sao tabelas independentes e nao se
  // falam. So consulta usuarios_dashboard quando usuarios_sistema NAO achou -
  // por isso o filtro ativo=true de cada consulta importa por si só: sem ele,
  // uma conta desativada ainda logaria.
  const { data: doSistema, error: erroSistema } = await client
    .from('usuarios_sistema')
    .select('id,email,tipo,terapeuta_id,ativo,session_token_expira_em')
    .eq('session_token', cracha).eq('ativo', true).maybeSingle()

  const { data: doDashboard, error: erroDashboard } = doSistema
    ? { data: null, error: null as ErroDeConsulta }
    : await client
        .from('usuarios_dashboard')
        .select('id,email,role,ativo,session_token_expira_em')
        .eq('session_token', cracha).eq('ativo', true).maybeSingle()

  // Falha de banco NUNCA vira "sem_cracha" - olhar so para `data` faz as duas
  // situacoes virarem a mesma resposta, e so a resposta errada ja desloga
  // todo mundo. Ver IMPORTANT-1 da revisao da Tarefa 6.
  if (erroSistema || erroDashboard) {
    console.error('[middleware] falha ao consultar conta:', (erroSistema ?? erroDashboard)?.message)
    return { tipo: 'falha_de_consulta' }
  }

  const achado = contaEncontrada(doSistema as RegistroSistema | null, doDashboard as RegistroDashboard | null)
  const decisao = decidirAcesso(achado, crachaVencido(achado?.expiraEm, agoraMs))
  if (decisao.tipo === 'recusado') return decisao

  // Janela deslizante: enquanto a pessoa usa, o cracha nao vence.
  if (achado && precisaRenovar(achado.expiraEm, agoraMs)) {
    const tabela = decisao.conta.origem === 'sistema' ? 'usuarios_sistema' : 'usuarios_dashboard'
    const nova = novaValidade(agoraMs)
    const { error } = await client.from(tabela)
      .update({ session_token_expira_em: nova }).eq('session_token', cracha)
    // Falha aqui NAO invalida a chamada: a pessoa ja esta autenticada.
    if (error) console.error('[middleware] validade nao renovada:', error.message)
  }

  return { tipo: 'autorizado', conta: decisao.conta }
}
