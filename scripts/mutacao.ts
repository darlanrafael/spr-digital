// Teste de MUTACAO: mede o quanto a suite e cega.
//
// Metodo 3 dos quatro pedidos pelo usuario em 12/09/2026. Os outros tres
// REDUZEM o que passa; este MEDE. Sem ele, "536 testes passando" e uma frase,
// nao uma medida.
//
// Como funciona: estraga o codigo de proposito, um pedacinho por vez, e roda a
// suite. Se a suite continua verde, aquele defeito passaria em producao - o
// mutante SOBREVIVEU, e ali existe codigo sem teste que o cubra.
//
// O MD ja registra uma medicao feita a mao: 12 de 12 defeitos reintroduzidos em
// `app/` passaram com os testes verdes. Isto automatiza a medicao onde ela
// ensina algo - em `lib/`, que e onde os testes existem.
//
// Escopo por argumento: `npx tsx scripts/mutacao.ts lib/rateio-das-deducoes.ts`
// ou sem argumento para os modulos de dinheiro.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const MODULOS_DE_DINHEIRO = [
  'lib/rateio-das-deducoes.ts',
  'lib/repasse-do-diagnostico.ts',
  'lib/dinheiro-do-pacote.ts',
  'lib/alertas-reembolso.ts',
  'lib/alertas-reembolso-parcial.ts',
  'lib/moeda-da-venda.ts',
  'lib/entregues-desde-o-fechamento.ts',
  'lib/sessoes-por-produto.ts',
  'lib/vendas-ja-fechadas.ts',
  'lib/invariantes-do-fechamento.ts',
  'lib/diagnostico-guiado.ts',
  'lib/resumo-do-fechamento-terapeuta.ts',
]

// Mutacoes classicas. Cada uma troca UMA coisa: se a suite nao nota, nao ha
// teste cobrindo aquela decisao.
const TROCAS: [RegExp, string, string][] = [
  [/>=/g, '>', 'fronteira: >= virou >'],
  [/<=/g, '<', 'fronteira: <= virou <'],
  [/([^<>=!])>([^=>])/g, '$1>=$2', 'fronteira: > virou >='],
  [/([^<>=!])<([^=<])/g, '$1<=$2', 'fronteira: < virou <='],
  [/===/g, '!==', 'igualdade invertida'],
  [/!==/g, '===', 'desigualdade invertida'],
  [/&&/g, '||', 'E virou OU'],
  [/\|\|/g, '&&', 'OU virou E'],
  [/\+ /g, '- ', 'soma virou subtracao'],
  [/ - /g, ' + ', 'subtracao virou soma'],
  [/\btrue\b/g, 'false', 'true virou false'],
  [/\bfalse\b/g, 'true', 'false virou true'],
]

function linhasDeCodigo(texto: string): Set<number> {
  // Fora de comentario e de string: mutar um comentario nao prova nada.
  const ok = new Set<number>()
  let emBloco = false
  texto.split('\n').forEach((l, i) => {
    const t = l.trim()
    if (t.startsWith('/*')) emBloco = true
    if (emBloco) { if (t.includes('*/')) emBloco = false; return }
    if (t.startsWith('//') || t.startsWith('*') || t === '') return
    ok.add(i)
  })
  return ok
}

function suiteVerde(): boolean {
  try {
    execSync('npx tsx --test lib/*.test.ts', { stdio: 'pipe', timeout: 120_000 })
    return true
  } catch { return false }
}

const alvos = process.argv.slice(2).filter(a => a.endsWith('.ts'))
const arquivos = alvos.length > 0 ? alvos : MODULOS_DE_DINHEIRO

type Sobrevivente = { arquivo: string; linha: number; mutacao: string; trecho: string }
const sobreviventes: Sobrevivente[] = []
let totalMutantes = 0

for (const arq of arquivos) {
  const original = readFileSync(arq, 'utf8')
  const linhas = original.split('\n')
  const validas = linhasDeCodigo(original)
  let mortos = 0
  let vivos = 0

  try {
    for (const [padrao, troca, nome] of TROCAS) {
      for (let i = 0; i < linhas.length; i++) {
        if (!validas.has(i)) continue
        const l = linhas[i]

        // UMA ocorrencia por vez. Trocar todas as da linha de uma vez gera
        // MUTANTE EQUIVALENTE: em `a + socios.reduce((b, n) => b + ...)`, os
        // dois `+` viram `-` e a dupla negacao se cancela - o codigo continua
        // certo e o mutante aparece como "sobrevivente" sem ser defeito nenhum.
        // Achado rodando o proprio motor em 12/09/2026.
        // Posicoes que estao DENTRO de string ou template. Mutar um hifen no
        // meio de "EMPRESA - R$" nao prova nada sobre a logica, e polui a
        // lista de sobreviventes com texto.
        const dentroDeTexto = new Set<number>()
        {
          let aspas: string | null = null
          for (let k = 0; k < l.length; k++) {
            const ch = l[k]
            if (aspas) {
              dentroDeTexto.add(k)
              if (ch === aspas && l[k - 1] !== '\\') aspas = null
            } else if (ch === "'" || ch === '"' || ch === '`') {
              aspas = ch
              dentroDeTexto.add(k)
            }
          }
        }

        const ocorrencias = [...l.matchAll(new RegExp(padrao.source, 'g'))]
        for (const oc of ocorrencias) {
          const inicio = oc.index ?? 0
          if (dentroDeTexto.has(inicio)) continue
          const mutada = l.slice(0, inicio) + oc[0].replace(new RegExp(padrao.source), troca) + l.slice(inicio + oc[0].length)
          if (mutada === l) continue

          totalMutantes++
          const copia = [...linhas]
          copia[i] = mutada
          writeFileSync(arq, copia.join('\n'), 'utf8')

          if (suiteVerde()) {
            vivos++
            sobreviventes.push({ arquivo: arq, linha: i + 1, mutacao: `${nome} (coluna ${inicio + 1})`, trecho: l.trim().slice(0, 90) })
          } else {
            mortos++
          }
        }
      }
    }
  } finally {
    // SEMPRE restaura, mesmo se algo explodir no meio. Deixar um arquivo mutado
    // no repositorio seria pior que nao ter medido nada.
    writeFileSync(arq, original, 'utf8')
  }

  const total = mortos + vivos
  const taxa = total > 0 ? Math.round((mortos / total) * 100) : 100
  const barra = '█'.repeat(Math.round(taxa / 5)).padEnd(20, '·')
  console.log(`${barra} ${String(taxa).padStart(3)}%  ${arq}  (${mortos} mortos, ${vivos} vivos)`)
}

const mortosTotal = totalMutantes - sobreviventes.length
console.log(`\n=== ${totalMutantes} mutantes: ${mortosTotal} mortos, ${sobreviventes.length} vivos`)
console.log(`=== a suite pega ${totalMutantes > 0 ? Math.round((mortosTotal / totalMutantes) * 100) : 100}% dos defeitos introduzidos\n`)

if (sobreviventes.length > 0) {
  console.log('MUTANTES VIVOS — cada linha e um defeito que passaria em producao:\n')
  const porArquivo = new Map<string, Sobrevivente[]>()
  for (const s of sobreviventes) {
    if (!porArquivo.has(s.arquivo)) porArquivo.set(s.arquivo, [])
    porArquivo.get(s.arquivo)!.push(s)
  }
  for (const [arq, lista] of [...porArquivo].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${arq}  (${lista.length})`)
    for (const s of lista.slice(0, 10)) console.log(`  :${s.linha}  ${s.mutacao}\n      ${s.trecho}`)
    if (lista.length > 10) console.log(`  ... e mais ${lista.length - 10}`)
    console.log()
  }
}
