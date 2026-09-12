// Pre-voo: varre o codigo procurando os padroes de defeito que JA morderam
// este projeto, registrados no spr-digital.md.
//
// POR QUE EXISTE. Em 11/09/2026 o usuario pediu uma revisao do dia. A primeira
// passada nao achou nada; a segunda, com mais atencao nas mesmas 1.073 linhas,
// achou quatro defeitos - e DOIS deles eram repeticao de erro que o MD ja
// documentava. Atencao nao e metodo: e sorte com esforco. Isto e o contrario -
// roda em segundos e nao depende de eu estar bem naquele dia.
//
// REGRA DESTE ARQUIVO: cada check nasce de um defeito REAL, com a referencia no
// MD. Check inventado "por precaucao" gera ruido, e ferramenta com ruido para de
// ser lida - ai ela custa mais do que vale.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

type Achado = { arquivo: string; linha: number; trecho: string; check: string; porque: string; grave: boolean }

const IGNORAR = ['node_modules', '.next', '.git', 'scripts']

// TODAS as pastas de codigo. A primeira versao varria so `app` e `lib`, e o
// proprio pre-voo acusou `avisoDaLinha()` como "regra testada e nao ligada"
// quando ela esta ligada em `components/terapeutas/AgendaDiaTerapeuta.tsx` -
// 1.240 linhas que estavam fora da varredura. A ferramenta feita para achar
// falha silenciosa tinha a sua propria.
const PASTAS = ['app', 'lib', 'components', 'contexts', 'types', 'hooks'].filter(d => {
  try { return statSync(d).isDirectory() } catch { return false }
})
function arquivos(dir: string, ext = ['.ts', '.tsx']): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.includes(nome)) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) { saida.push(...arquivos(caminho, ext)); continue }
    if (ext.some(e => nome.endsWith(e)) && !nome.endsWith('.test.ts')) saida.push(caminho)
  }
  return saida
}

// Arquivos alterados em relacao ao que esta publicado. Usado pelos checks de
// regra "daqui pra frente", que nao devem acusar a base historica inteira.
const MUDADOS: Set<string> = (() => {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const saida = execSync('git diff --name-only origin/main HEAD; git diff --name-only; git diff --name-only --cached', { encoding: 'utf8' })
    return new Set(saida.split('\n').map(x => x.trim()).filter(Boolean))
  } catch { return new Set<string>() }
})()

const achados: Achado[] = []
const add = (a: Achado) => achados.push(a)

const TABELAS_GRANDES = ['sales', 'sessoes', 'atividades_log', 'webhook_events', 'ocorrencias_prontuario', 'compromissos_terapeuta']

for (const arq of PASTAS.flatMap(d => arquivos(d))) {
  const texto = readFileSync(arq, 'utf8')
  const linhas = texto.split('\n')

  linhas.forEach((l, i) => {
    const n = i + 1
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*')) return

    // ── C1 ── Consulta em tabela grande sem teto nem paginacao.
    // Origem: itens 37, 40 e 42 do MD. O PostgREST corta em 1000 linhas EM
    // SILENCIO, e o teto esta ativo neste projeto.
    //
    // A primeira versao deste check acusou 29 leituras e as duas que eu conferi
    // na mao eram FALSO POSITIVO: uma estava dentro de um `while (true)` de
    // cursor com o `.limit` longe por causa de um comentario, e a outra usava
    // `.in('sale_id', batch)`. Heuristica refeita: janela grande, olhar para
    // TRAS procurando laco de paginacao, e aceitar `in(` como chave.
    for (const tab of TABELAS_GRANDES) {
      if (!l.includes(`from('${tab}')`)) continue
      const adiante = linhas.slice(i, i + 25).join(' ')
      const atras = linhas.slice(Math.max(0, i - 18), i).join(' ')
      // Escrita, e nao leitura: decide pela ORDEM. Comparar so o inicio do
      // bloco falhava quando um comentario empurrava o `.update(` para longe -
      // foi como o webhook da Hubla entrou na lista da primeira rodada.
      const posEscrita = adiante.search(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
      const posLeitura = adiante.search(/\.select\(/)
      if (posEscrita >= 0 && (posLeitura < 0 || posEscrita < posLeitura)) continue

      const temTeto = /\.limit\(|\.single\(\)|\.maybeSingle\(\)|count:\s*'exact'|head:\s*true|\.range\(/.test(adiante)
      // Chave que limita a poucas linhas por natureza. `pacote_pai_id` entra
      // porque a relacao e 1 pai para poucas filhas.
      const porChave = /\.(eq|in)\('(id|sale_id|sessao_id|solicitacao_id|terapeuta_id|fechamento_id|pacote_pai_id|order_id|email)',/.test(adiante)
      // Laco de cursor: `while (true)` ou `for (;;)` com `gt(` ou `cursor` perto.
      const emLacoDeCursor = /while\s*\(true\)|for\s*\(;;\)/.test(atras) && /cursor|\.gt\(/.test(atras + adiante)
      // Janela de data limita, mas nao com teto duro: um mes pode passar de
      // 1000 numa operacao maior. Fica como LEVE - vale olhar, nao trava.
      const porJanelaDeData = /\.(gte|lte|gt|lt)\('(data_|created_at|updated_at)/.test(adiante)

      if (!temTeto && !porChave && !emLacoDeCursor) {
        add({ arquivo: arq, linha: n, trecho: t.slice(0, 110),
          // Nome diferente por gravidade: o relatorio agrupa por check e mostra
          // o motivo do PRIMEIRO item, entao misturar grave e leve no mesmo
          // nome faz a mensagem mentir sobre metade da lista.
          check: porJanelaDeData ? 'C1b janela de data sem teto duro' : 'C1 consulta sem teto',
          porque: porJanelaDeData
            ? `${tab} limitado por janela de data, sem teto duro: confira se a janela nao pode passar de 1000`
            : `${tab} pode passar de 1000 linhas e o PostgREST corta em silencio`,
          grave: !porJanelaDeData })
      }
    }

    // ── C2 ── Timestamp cortado como string.
    // Origem: o bug do fechamento em que `slice(0, 10)` de `updated_at` jogava
    // uma aprovacao das 21h30 BRT para o dia seguinte.
    if (/\.slice\(0,\s*10\)/.test(l) && /data_|created_at|updated_at|_at\b|timestamp/.test(l)) {
      add({ arquivo: arq, linha: n, trecho: t.slice(0, 110), check: 'C2 slice em timestamp',
        porque: 'confira se este valor JA foi convertido para BRT. Se vier cru do banco, 21h30 BRT cai no dia seguinte', grave: false })
    }

    // ── C3 ── Timestamp comparado como TEXTO.
    // Origem: achado em 11/09/2026. `data_confirmacao` vem com fracao de
    // segundo e `data_entrega` sem; no segundo em que coincidem, '+' < '.' e a
    // comparacao de texto erra. Com fuso diferente, erra por horas.
    // ── C3 ── Timestamp comparado como TEXTO.
    // Origem: achado em 11/09/2026. `data_confirmacao` vem com fracao de
    // segundo e `data_entrega` sem; no segundo em que coincidem, '+' < '.' e a
    // comparacao de texto erra. Com fuso diferente, erra por horas.
    //
    // A primeira versao pegava qualquer linha que MENCIONASSE data - inclusive
    // lista de colunas de `select` e `<td` do JSX, por causa do `<`. Agora
    // procura comparacao de ORDEM de verdade.
    {
      const CAMPO = String.raw`[\w.?]*(?:data_\w+|created_at|updated_at)`
      const semConversao = !/new Date\(|\.getTime\(\)|Date\.parse/.test(l)
      // a) localeCompare entre campos DIFERENTES
      const lc = l.match(new RegExp(String.raw`(${CAMPO})[^)]{0,40}\.localeCompare\(\s*[^)]{0,40}(${CAMPO})`))
      if (lc && lc[1].replace(/^[\w]*\.?/, '') !== lc[2].replace(/^[\w]*\.?/, '')) {
        add({ arquivo: arq, linha: n, trecho: t.slice(0, 110), check: 'C3 data comparada como texto',
          porque: 'campos de data diferentes tem formatos diferentes; comparar por epoca', grave: true })
      }
      // b) operador de ordem entre campo de data e string ou outro campo
      const op = l.match(new RegExp(String.raw`(${CAMPO})\s*(>=|<=|>|<)\s*(['"\`]|${CAMPO})`))
      if (op && semConversao && !/=>/.test(l.slice(0, (op.index ?? 0) + 2))) {
        add({ arquivo: arq, linha: n, trecho: t.slice(0, 110), check: 'C3 data comparada como texto',
          porque: 'comparacao de ordem em texto: formato e fuso podem divergir; comparar por epoca', grave: true })
      }
    }

    // ── C4 ── Travessao longo em texto que o usuario le.
    // Regra do usuario: "sempre trocar esse travessao grande por '-'".
    // ── C4 ── Travessao longo em prosa, SO no que mudou.
    // Regra do usuario: "sempre trocar esse travessao grande por '-'", e ela
    // vale daqui pra frente. A base tem 137 ocorrencias antigas; acusar todas
    // afoga o relatorio e a ferramenta para de ser lida.
    if (MUDADOS.has(arq) && l.includes('—')) {
      const emProsa = /[a-zA-ZÀ-ÿ]{3,}[^—]{0,80}—[^—]{0,80}[a-zA-ZÀ-ÿ]{3,}/.test(l)
      if (emProsa) {
        add({ arquivo: arq, linha: n, trecho: t.slice(0, 110), check: 'C4 travessao longo em prosa (arquivo alterado)',
          porque: 'o usuario pediu hifen simples em texto que ele le', grave: false })
      }
    }

    // ── C5 ── `update` sem conferir o erro.
    // Origem: item 39 - "o erro do update das sessoes nao era conferido, entao
    // uma falha deixaria o pedido aprovado e as sessoes vivas na agenda, sem
    // nada na tela".
    if (/await\s+\w+[\s\S]{0,40}\.update\(/.test(l) && !/error/.test(l) && !/const\s*\{/.test(l)) {
      const bloco = linhas.slice(i, i + 6).join(' ')
      if (!/error/.test(bloco)) {
        add({ arquivo: arq, linha: n, trecho: t.slice(0, 110), check: 'C5 update sem checar erro',
          porque: 'falha silenciosa deixa o estado meio-ligado', grave: true })
      }
    }
  })
}

// ── C6 ── Campo em tipo PERSISTIDO que nao existe no mapeamento de colunas.
// Origem: achado em 11/09/2026. `prejuizoAbsorvidoPelaEmpresa` foi acrescentado
// a `Closing`, a tela prometia "fica registrado no fechamento", e `addClosing`
// e lista EXPLICITA de colunas - o campo era descartado em silencio.
{
  const tipos = readFileSync('types/index.ts', 'utf8')
  const services = readFileSync('lib/services.ts', 'utf8')
  const camelParaSnake = (s: string) => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
  for (const nome of ['Closing', 'Sale']) {
    const m = tipos.match(new RegExp(`export interface ${nome} \\{([\\s\\S]*?)\\n\\}`))
    if (!m) continue
    for (const linha of m[1].split('\n')) {
      const campo = linha.match(/^\s{2}(\w+)\??:/)
      if (!campo) continue
      const c = campo[1]
      if (['id', 'projetoId'].includes(c)) continue
      const variantes = [c, camelParaSnake(c)]
      if (!variantes.some(v => new RegExp(`\\b${v}\\s*:`).test(services))) {
        add({ arquivo: 'types/index.ts', linha: 0, trecho: `${nome}.${c}`, check: 'C6 campo nao persistido',
          porque: `${nome}.${c} nao aparece no mapeamento de lib/services.ts - e descartado em silencio ao gravar`, grave: true })
      }
    }
  }
}

// ── C7 ── Funcao exportada de `lib` que ninguem importa.
// Origem: itens 50.6 e 57 - "a rota estava certa e o dado existia; o que
// faltava era a tela LER o que a rota mandava". Regra sem fiacao e regra que
// nao vale.
{
  const todoCodigo = PASTAS.flatMap(d => arquivos(d)).map(a => readFileSync(a, 'utf8')).join('\n')
  const testes = readdirSync('lib').filter(f => f.endsWith('.test.ts')).map(f => readFileSync(join('lib', f), 'utf8')).join('\n')
  for (const arq of arquivos('lib')) {
    const texto = readFileSync(arq, 'utf8')
    for (const m of texto.matchAll(/^export (?:async )?function (\w+)/gm)) {
      const fn = m[1]
      const usos = (todoCodigo.match(new RegExp(`\\b${fn}\\b`, 'g')) ?? []).length
      const emTeste = new RegExp(`\\b${fn}\\b`).test(testes)
      // 1 uso = so a propria declaracao.
      if (usos <= 1) {
        // Testada e nao chamada e o caso que importa: alguem escreveu a regra,
        // provou que funciona, e ela nao esta ligada em nada. Foi o defeito do
        // item 57 (a rota mandava o dado e a tela nao lia).
        add({ arquivo: arq, linha: texto.slice(0, m.index).split('\n').length, trecho: fn,
          check: emTeste ? 'C7 regra testada e NAO ligada' : 'C8 codigo morto',
          porque: emTeste
            ? `${fn}() tem teste provando que funciona, e ninguem no sistema a chama`
            : `${fn}() nao e usada nem testada`, grave: false })
      }
    }
  }
}

// ── Relatorio ──
const graves = achados.filter(a => a.grave)
const leves = achados.filter(a => !a.grave)
const porCheck = new Map<string, Achado[]>()
for (const a of achados) { if (!porCheck.has(a.check)) porCheck.set(a.check, []); porCheck.get(a.check)!.push(a) }

console.log(`\nPRE-VOO — ${achados.length} achado(s): ${graves.length} grave(s), ${leves.length} leve(s)\n`)
for (const [check, lista] of [...porCheck].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${check}  (${lista.length})`)
  console.log(`  ${lista[0].porque}`)
  for (const a of lista.slice(0, 12)) console.log(`    ${a.arquivo}:${a.linha}  ${a.trecho}`)
  if (lista.length > 12) console.log(`    ... e mais ${lista.length - 12}`)
  console.log()
}
console.log('Cada achado e um LUGAR PARA OLHAR, nao um veredito: os checks sao')
console.log('heuristica, e alguns padroes estao certos em contexto. O que a lista')
console.log('garante e que nenhum deles passa sem alguem ter decidido.\n')
if (graves.length > 0) { console.log(`${graves.length} achado(s) GRAVE(s). Confira cada um antes de publicar.\n`); process.exit(1) }
console.log('Nenhum achado grave.\n')
