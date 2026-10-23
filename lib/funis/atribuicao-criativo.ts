/**
 * Ad id da Meta embutido no utm_content da venda, ou null quando nao da pra
 * atribuir (sem UTM, organico, link na bio).
 *
 * Formato do utm_content: "<nome do anuncio>|<adId>::<tracking facebook>::".
 * O ad id e o segmento depois do primeiro "|", ate o "::". Meta ad id e sempre
 * numerico - se nao for, devolve null em vez de inventar atribuicao.
 *
 * Liga venda -> criativo (o Meta nao sabe qual anuncio gerou a venda; a UTM
 * sabe). Ver item 114 do spr-digital.md.
 */
export function adIdDaVenda(utmContent: string | null | undefined): string | null {
  if (!utmContent) return null
  const barra = utmContent.indexOf('|')
  if (barra < 0) return null
  const depois = utmContent.slice(barra + 1)
  const id = depois.split('::')[0].trim()
  if (!/^\d+$/.test(id)) return null
  return id
}
