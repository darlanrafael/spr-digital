// Preparo de telefone pro WhatsApp (Z-API), que exige dígitos puros COM
// código do país. Módulo puro e testável — a regra é sutil e já falhou em
// produção, então merece teste próprio.

/** DDDs que existem no Brasil. Usado pra distinguir "DDD + celular" de um
 *  número estrangeiro de mesmo comprimento. */
const DDDS_BR = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
])

export function normalizarTelefoneBR(telefone: string | null | undefined): string | null {
  if (!telefone) return null
  const digitos = telefone.replace(/\D/g, '')
  if (!digitos) return null

  // Número dos EUA/Canadá tem 11 dígitos (1 + área + 7) — exatamente o mesmo
  // comprimento de um celular brasileiro com DDD. A regra antiga assumia que
  // todo 10-11 dígitos era brasileiro sem código de país e colava "55" na
  // frente, transformando +1 973 771-4399 em 5519737714399: a Z-API aceitava
  // a chamada e a mensagem nunca chegava. Cinco pacientes com sessão agendada
  // nunca receberam lembrete por causa disso (Ana Assis, Giselle, Camila
  // Queiroz, Fernanda Lima, Fabiano Souza — todos nos EUA).
  //
  // O "+" NÃO serve pra distinguir: metade da base tem "+" sem código de país
  // (ex: "+64999067729" é Goiás, "+11948498485" é São Paulo, "+55986837406" é
  // DDD 55 do RS). Confiar nele quebraria números que funcionam hoje.
  //
  // O que distingue: celular brasileiro é DDD válido + "9" + 8 dígitos — o
  // terceiro dígito é sempre 9. Número do +1 começa com 1 e não tem esse 9.
  // O "+" sozinho nao decide, mas ele decide o EMPATE. Depois de o numero ja
  // ter falhado nos dois testes fortes - nao e celular BR (DDD valido + 9) e
  // nao comeca com 1 - o que sobrava era colar "55" na frente por falta de
  // alternativa. Isso quebra todo pais cujo numero completo tem 11 digitos:
  //
  //   Chile     +56 9 XXXX XXXX   -> virava 5556 9XXXXXXXX
  //   Espanha   +34 6XX XXX XXX   -> virava 5534 6XXXXXXXX
  //   Franca    +33 6 XX XX XX XX -> virava 5533 6XXXXXXXX
  //   Uruguai   +598 9X XXX XXX   -> virava 55598 9XXXXXXX
  //   Bolivia   +591 7XXXXXXX     -> virava 55591 7XXXXXX
  //
  // Nenhum deles chega. E colar "55" nesse caso ja estava errado ATE PARA O
  // BRASIL: um numero de 11 digitos que nao e DDD valido + 9 nao e celular
  // brasileiro nenhum, entao "55" na frente produz 13 digitos que a Z-API
  // aceita e o WhatsApp nao entrega. Trocar o chute por "e estrangeiro com
  // codigo de pais" nao tira nenhum numero valido de circulacao.
  //
  // O que isto NAO resolve, e nao tem como resolver por regra: o Peru
  // (+51 9XX XXX XXX) e indistinguivel de um celular de Porto Alegre
  // (DDD 51 + 9 + 8 digitos) - os dois sao "519XXXXXXXX". Numero assim so se
  // resolve capturando o pais no cadastro.
  const veioComMais = telefone.trim().startsWith('+')

  if (digitos.length === 11) {
    const ddd = Number(digitos.slice(0, 2))
    if (DDDS_BR.has(ddd) && digitos[2] === '9') return '55' + digitos
    if (digitos[0] === '1') return digitos // EUA/Canadá, já com código de país
    if (veioComMais) return digitos // estrangeiro que já trouxe o código do país
    return '55' + digitos // sem o "+", mantém o comportamento antigo
  }

  // Fixo brasileiro: DDD + 8 dígitos começando em 2-5. O DDD tem de existir:
  // sem essa conferência, "55" ia na frente de qualquer coisa com 10 dígitos.
  //
  // Dez dígitos com DDD que não existe no Brasil é, na base real, número dos
  // EUA digitado sem o "+1" - o padrão aqui é brasileiro morando fora. Medido
  // na Z-API: "8044020277" (área 804, Virgínia) e "7814993955" (área 781,
  // Massachusetts) NÃO existem no WhatsApp nem como "55…" nem como os dez
  // dígitos crus, e existem como "1…". Colar "55" neles era garantia de não
  // entregar.
  //
  // É heurística, não certeza: "2389168324" tem área 238, que não é código
  // atribuído nos EUA, e esse a regra erra. Ele também não era entregável como
  // brasileiro, então nada que funciona hoje se perde. A correção definitiva é
  // capturar o país no cadastro, e não adivinhar no envio.
  if (digitos.length === 10) {
    const ddd = Number(digitos.slice(0, 2))
    if (DDDS_BR.has(ddd)) return '55' + digitos
    // Formato NANP: área e prefixo começam em 2-9. Não há guarda contra código
    // de serviço (N11) porque ela seria código morto: 211, 311, 411, 511, 611,
    // 711, 811 e 911 começam com 21, 31, 41, 51, 61, 71, 81 e 91, que são
    // todos DDD brasileiro válido - a linha acima já venceu.
    const ehNANP = /^[2-9]\d\d$/.test(digitos.slice(0, 3)) && /^[2-9]/.test(digitos[3])
    if (ehNANP) return '1' + digitos
    return digitos
  }

  return digitos
}

/**
 * O número na forma que o WhatsApp realmente usa.
 *
 * `normalizarTelefoneBR` devolve o número CERTO - o que o paciente discaria.
 * O WhatsApp não usa esse. Ele guarda a conta numa forma própria, e mandar a
 * outra faz a Z-API responder 200 e a mensagem não chegar em ninguém.
 *
 * DUAS REGRAS, as duas medidas contra a própria Z-API em 03/09/2026 pelo
 * endpoint `phone-exists`, que devolve o número canônico da conta:
 *
 * 1. CELULAR BRASILEIRO, o nono dígito.
 *    Contas de DDD 11 a 28 (SP, RJ, ES) guardam o 9. Contas de DDD 31 a 99
 *    NÃO guardam. Conferido em 53 DDDs distintos da própria base, um número
 *    real por DDD, sem uma exceção:
 *
 *      mantém o 9: 11 12 13 14 15 16 17 18 19 21 22 24 27 28
 *      tira o 9:   31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 51 53 54
 *                  61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83
 *                  84 85 86 87 88 89 91 92 93 94 95 96 97 98 99
 *
 *    Exemplo real: Márcio de Castro, DDD 84. Mandávamos 5584981114243 e o
 *    WhatsApp usa 558481114243. Ele não recebeu o lembrete de 26/08.
 *
 * 2. MÉXICO, o "1" depois do código do país.
 *    Contas mexicanas são 521 + número. Exemplo real: Natalia Rezende,
 *    mandávamos 525579077715 e o WhatsApp usa 5215579077715.
 *
 * Por que aqui e não em `normalizarTelefoneBR`: o número guardado em `sales`
 * tem de continuar sendo o número de verdade - é o que o comercial liga, é o
 * que aparece no prontuário. Esta função é só para o CANAL, e por isso roda no
 * caminho de envio, nunca na escrita.
 */
export function paraWhatsApp(numero: string | null | undefined): string | null {
  if (!numero) return null
  const d = numero.replace(/\D/g, '')
  if (!d) return null

  // Brasil: 55 + DDD (2) + 9 + 8 dígitos = 13.
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    const ddd = Number(d.slice(2, 4))
    if (ddd >= 31) return d.slice(0, 4) + d.slice(5)
    return d
  }

  // México: 52 + 10 dígitos = 12. A conta do WhatsApp é 521 + os 10.
  if (d.length === 12 && d.startsWith('52') && d[2] !== '1') return '521' + d.slice(2)

  return d
}
