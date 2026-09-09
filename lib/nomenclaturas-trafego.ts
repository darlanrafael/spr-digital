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
    // Com o UNDERSCORE de proposito. As campanhas reais sao
    // "CSP_Vendas_Frio_Advantage_TesteCriativo_VID_..." - CSP e prefixo. Como
    // o casamento e por CONTEM, o termo solto "CSP" pegaria tambem qualquer
    // campanha com "CSP" no meio de outra palavra, e a conta tem 246
    // campanhas. O underscore prende no prefixo sem perder nenhuma das que
    // existem hoje.
    //
    // Se aparecer campanha do produto escrita de outro jeito ("CSP - Vendas",
    // "[CSP]"), ela NAO sera pega: e o momento de acrescentar a variante aqui.
    'CSP_',
  ],
}

/** A lista do projeto, com fallback para `proj_1` como o codigo antigo fazia. */
export function nomenclaturasDoProjeto(projectId?: string | null): string[] {
  return NOMENCLATURAS_POR_PROJETO[projectId ?? ''] ?? NOMENCLATURAS_POR_PROJETO.proj_1
}
