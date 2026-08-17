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
  if (digitos.length === 11) {
    const ddd = Number(digitos.slice(0, 2))
    if (DDDS_BR.has(ddd) && digitos[2] === '9') return '55' + digitos
    if (digitos[0] === '1') return digitos // EUA/Canadá, já com código de país
    return '55' + digitos // ambíguo: mantém o comportamento antigo
  }

  // Fixo brasileiro: DDD + 8 dígitos começando em 2-5.
  if (digitos.length === 10) return '55' + digitos

  return digitos
}
