// As nomenclaturas de campanha que identificam o investimento em trafego do
// projeto na tela inicial.
//
// Vive aqui porque a lista estava DUPLICADA em dois arquivos
// (`app/api/meta/insights` e `app/api/meta/test`). Acrescentar uma nomenclatura
// num e esquecer do outro faz os dois divergirem em silencio: a tela mostra um
// numero e o teste confirma outro, sem erro nenhum.
//
// A tela de FECHAMENTOS nao usa esta lista - la o usuario digita os termos na
// hora, para poder fechar um periodo com qualquer recorte de campanha.
//
// O casamento e por "o nome da campanha CONTEM o termo", sem diferenciar
// maiuscula de minuscula (ver `getProjectInvestment` em lib/meta.ts). Termo
// curto pega mais coisa do que se espera: e por isso que cada entrada aqui tem
// de dizer o que ela identifica.
export const NOMENCLATURAS_POR_PROJETO: Record<string, string[]> = {
  proj_1: [
    '[F01-IRM',  // Imersao - A Reaproximacao
    '[PF01_RC',  // Perpetuo - Reconquista
    // Combo Os Primeiros Passos da Restauracao, acrescentado em 09/09/2026.
    //
    // Termo SOLTO, sem underscore, por decisao explicita do usuario: "TUDO QUE
    // TIVER CSP E PARA PEGAR NO NOME DA CAMPANHA". As campanhas de hoje sao
    // "CSP_Vendas_Frio_Advantage_..." mas ele quer garantir que qualquer
    // variante de escrita entre - "CSP - Vendas", "[CSP] Combo", "Combo CSP".
    //
    // O custo, registrado para nao virar surpresa: o casamento e por CONTEM,
    // entao uma campanha com essas tres letras GRUDADAS dentro de outra
    // palavra ("CSPX", "ACSP") tambem entraria e inflaria o investimento da
    // tela inicial. Se o numero aparecer alto demais, este e o primeiro lugar
    // a olhar - a conta tem 246 campanhas.
    'CSP',
  ],
}

/** A lista do projeto, com fallback para `proj_1` como o codigo antigo fazia. */
export function nomenclaturasDoProjeto(projectId?: string | null): string[] {
  return NOMENCLATURAS_POR_PROJETO[projectId ?? ''] ?? NOMENCLATURAS_POR_PROJETO.proj_1
}
