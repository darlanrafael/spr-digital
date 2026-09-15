import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// A rota `marcar-enviado` grava a marca de "lembrete ja enviado". Ela e a UNICA
// coisa que impede o mesmo paciente de receber a mensagem duas vezes: a consulta
// de pendentes so devolve sessao sem marca.
//
// Em 14/09/2026 a vespera passou a rodar TRES vezes por noite para tolerar a
// falha intermitente do Supabase (525 no handshake). Isso tornou critico o que
// antes era teorico, e a varredura achou dois problemas na rota.

const rota = () => readFileSync(new URL('../app/api/whatsapp/marcar-enviado/route.ts', import.meta.url), 'utf8')

test('a marca so e gravada quando AINDA NAO existe', () => {
  // A primeira versao fazia `.update(...).eq('id', sessao_id)` sem condicao:
  // gravava por cima e a marca original se perdia. Sem ela, nao ha como saber
  // depois que houve envio duplicado - nem olhando o historico.
  const t = rota()
  assert.ok(/\.is\(coluna, null\)/.test(t), 'a rota nao condiciona a marca a coluna estar vazia')
  const trecho = t.slice(t.indexOf('.update('), t.indexOf('if (error)'))
  assert.ok(trecho.includes(".eq('id', sessao_id)"), 'perdeu o filtro por sessao')
  assert.ok(trecho.includes('.select('), 'sem `select` nao da para saber se afetou linha')
})

test('a resposta DIZ se marcou, para duplicata deixar rastro', () => {
  // Antes respondia `success: true` sempre, entao quem chamou nunca ficava
  // sabendo que estava marcando algo ja marcado.
  const t = rota()
  assert.ok(/marcou/.test(t), 'a resposta nao informa se marcou')
  assert.ok(/aviso/.test(t), 'a resposta nao avisa quando ja estava marcado')
  assert.ok(/envio repetido/i.test(t), 'o aviso nao explica o que significa')
})

test('"ja estava marcado" devolve 200, nao erro', () => {
  // Para o n8n, encontrar a sessao ja marcada e o resultado ESPERADO da segunda
  // e da terceira rodada da noite. Devolver erro faria a rodada de seguranca
  // parecer quebrada toda noite, e o alerta dispararia sem motivo.
  const t = rota()
  const depoisDoUpdate = t.slice(t.indexOf('const marcou'))
  assert.ok(!/status:\s*4\d\d/.test(depoisDoUpdate), 'nao pode devolver 4xx quando ja estava marcado')
  assert.ok(!/status:\s*5\d\d/.test(depoisDoUpdate), 'nao pode devolver 5xx quando ja estava marcado')
  assert.ok(/success:\s*true/.test(depoisDoUpdate), 'a resposta de sucesso sumiu')
})

test('a consulta de pendentes continua sendo a trava contra duplicata', () => {
  // A marca so serve porque a busca a respeita. Se a busca parar de filtrar,
  // rodar tres vezes por noite manda tres mensagens.
  const busca = readFileSync(new URL('../lib/whatsapp-pendentes.ts', import.meta.url), 'utf8')
  assert.ok(/colGrupo|colPaciente/.test(busca), 'a busca nao conhece as colunas de controle')
  assert.ok(/is\.null|is\(/.test(busca) || /ja_enviado/.test(busca),
    'a busca precisa excluir, ou ao menos marcar, o que ja foi enviado')
})
