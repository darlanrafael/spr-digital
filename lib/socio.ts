// lib/socio.ts
//
// Quem e o socio (Pedro) entre os terapeutas. O socio recebe a comissao no
// fechamento, entao nao passa por aprovacao de falta.
//
// ATENCAO: a deteccao e POR NOME, o que e fragil (ex.: um futuro "Pedro
// Henrique" tambem daria true). Mantem o padrao atual do projeto, que detecta
// o Pedro pelo nome em varios lugares. IDEAL FUTURO: uma flag `eh_socio` na
// tabela `terapeutas`, lida no lugar do nome.

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** O nome e o do socio (Pedro)? Casa "pedro" como palavra inteira. */
export function ehPedroSocio(nome: string): boolean {
  return /(^|[^a-z])pedro($|[^a-z])/.test(normalizar(nome ?? ''))
}
