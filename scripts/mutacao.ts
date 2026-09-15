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
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
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

// SEGURANCA. Em 12/09/2026 uma rodada de 38 modulos foi morta por timeout e
// deixou `lib/ligacao-de-pacote.ts` MUTADO no repositorio: o `finally` nao roda
// quando o processo e derrubado de fora. Um arquivo mutado esquecido vale menos
// que zero - e um defeito plantado que passa pelos testes daquele mutante.
//
// Tres camadas:
//   1. recusa comecar se o alvo tiver mudanca nao commitada (senao nao ha para
//      onde restaurar com seguranca)
//   2. restaura em SIGINT e SIGTERM, que e o que `timeout` manda
//   3. deixa um marcador em disco; se ele sobrar, a proxima rodada avisa
//   4. instala um gancho de pre-commit que RECUSA commit enquanto o marcador
//      existir (ver abaixo o porque)
const MARCADOR = '.mutacao-em-andamento'

// O marcador so serve se alguem olhar para ele na hora certa. Em 15/09/2026 um
// mutante foi parar num commit: `git add -A` rodou enquanto um lote estava no
// meio de `lib/pacote-de-vendas.ts`, e a linha `if (o.id === venda.id) return
// true` (no lugar de `false`) entrou no repositorio. O motor restaurou o
// arquivo logo depois - mas o commit ja estava feito, e a restauracao virou uma
// "modificacao" que, lida ao contrario, foi descartada com `git checkout --`.
//
// `.git/hooks/` nao e versionado, entao o gancho e (re)instalado aqui, toda vez
// que o motor roda. Assim ele existe em qualquer clone que ja tenha rodado uma
// medicao.
{
  const { writeFileSync: escrever, existsSync: existe, chmodSync: permissao } = require('node:fs') as typeof import('node:fs')
  const GANCHO = '.git/hooks/pre-commit'
  const CORPO = [
    '#!/bin/sh',
    '# Instalado por scripts/mutacao.ts. Ver o comentario la sobre o mutante',
    '# que foi commitado em 15/09/2026.',
    'if [ -f .mutacao-em-andamento ]; then',
    '  echo ""',
    '  echo "  COMMIT RECUSADO: ha um teste de mutacao em andamento."',
    '  echo "  Arquivo sendo mutado agora: $(cat .mutacao-em-andamento)"',
    '  echo ""',
    '  echo "  Commitar agora grava um defeito de proposito no repositorio."',
    '  echo "  Espere o lote terminar (o motor restaura sozinho) e commite depois."',
    '  echo ""',
    '  exit 1',
    'fi',
    '',
  ].join('\n')
  try {
    if (existe('.git/hooks')) {
      escrever(GANCHO, CORPO, 'utf8')
      permissao(GANCHO, 0o755)
    }
  } catch { /* sem gancho o motor ainda funciona; nao vale derrubar a medicao */ }
}
{
  const { execSync: ex } = require('node:child_process') as typeof import('node:child_process')
  if (existsSync(MARCADOR)) {
    // RESTAURA SOZINHO em vez de so avisar.
    //
    // Em 15/09/2026 uma rodada foi morta com `pkill -TERM` e o arquivo ficou
    // mutado: o sinal atinge o `npx`, nao o node por dentro, entao o tratador
    // que eu tinha registrado nunca rodou. O MARCADOR foi o que denunciou o
    // arquivo - e essa e a camada que funciona, porque nao depende de o
    // processo ter chance de reagir.
    //
    // Avisar e pedir para o humano rodar `git checkout` deixa uma janela em que
    // alguem pode commitar o defeito plantado sem perceber. Restaurar na hora
    // fecha a janela.
    const antigo = readFileSync(MARCADOR, 'utf8').trim()
    console.error(`\nRODADA ANTERIOR NAO TERMINOU. Restaurando ${antigo}...`)
    try {
      ex(`git checkout -- "${antigo}"`, { encoding: 'utf8' })
      console.error(`  restaurado.\n`)
      unlinkSync(MARCADOR)
    } catch (e) {
      console.error(`  NAO CONSEGUI RESTAURAR. Rode a mao: git checkout -- ${antigo}\n`)
      process.exit(1)
    }
  }
  const sujos = ex(`git status --porcelain -- ${arquivos.join(' ')}`, { encoding: 'utf8' }).trim()
  if (sujos) {
    console.error('\nOs alvos abaixo tem mudanca nao commitada. Commite ou descarte antes:')
    console.error(sujos + '\n')
    process.exit(1)
  }
}

let emUso: { arquivo: string; original: string } | null = null
const restaurar = () => {
  if (emUso) { writeFileSync(emUso.arquivo, emUso.original, 'utf8'); emUso = null }
  try { if (existsSync(MARCADOR)) unlinkSync(MARCADOR) } catch { /* nada a fazer */ }
}
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sinal, () => { restaurar(); process.exit(130) })
}
process.on('exit', restaurar)

type Sobrevivente = { arquivo: string; linha: number; mutacao: string; trecho: string }
const sobreviventes: Sobrevivente[] = []
let totalMutantes = 0

for (const arq of arquivos) {
  const original = readFileSync(arq, 'utf8')
  emUso = { arquivo: arq, original }
  writeFileSync(MARCADOR, arq, 'utf8')
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
    emUso = null
    try { if (existsSync(MARCADOR)) unlinkSync(MARCADOR) } catch { /* nada a fazer */ }
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
