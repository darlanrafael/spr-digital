import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDaOcorrencia, textoDaDiferenca, MARCA_DESFAZER } from './conferencia-de-pacote'

test('cada tipo tem o seu rotulo', () => {
  assert.equal(rotuloDaOcorrencia({ tipo: 'mesmo_pacote' }).texto, 'Compras juntadas')
  assert.equal(rotuloDaOcorrencia({ tipo: 'valor_divergente' }).texto, 'Valor divergente')
  assert.equal(rotuloDaOcorrencia({ tipo: 'compra_separada' }).texto, 'Compras separadas')
})

test('DESFAZER nao se disfarca de resposta do comercial', () => {
  // A coluna de tipo so aceita tres valores, entao o desfazer reusa
  // `compra_separada`. Sem distinguir, o CEO lia "Compras separadas" e concluia
  // que o comercial respondeu isso ao agendar.
  const o = { tipo: 'compra_separada', justificativa: `${MARCA_DESFAZER} por Rafael. Ela volta para Pendentes.` }
  assert.equal(rotuloDaOcorrencia(o).texto, 'Ligação desfeita')
  assert.equal(rotuloDaOcorrencia(o).cor, 'desfeita')
})

test('justificativa livre do comercial NAO vira desfazer por acidente', () => {
  const o = { tipo: 'compra_separada', justificativa: 'O paciente disse que a compra foi separada mesmo.' }
  assert.equal(rotuloDaOcorrencia(o).texto, 'Compras separadas')
})

test('tipo desconhecido nao se disfarca de nada', () => {
  // Se a migracao ganhar valor novo e a tela nao souber, e melhor mostrar o
  // valor cru do que um rotulo errado com confianca.
  assert.equal(rotuloDaOcorrencia({ tipo: 'algo_novo' }).texto, 'algo_novo')
})

test('o sinal da diferenca aponta para o lado certo', () => {
  // Positivo e o que FALTA para fechar o preco do pacote. O valor formatado e
  // montado com o mesmo Intl da funcao de proposito: o risco aqui e a PALAVRA
  // trocada, nao o espaco fino que o Intl usa entre "R$" e o numero.
  const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  assert.equal(textoDaDiferenca(180), `Faltaram ${fmt(180)}`)
  assert.equal(textoDaDiferenca(-180), `Entraram ${fmt(180)} a mais`)
  assert.ok(textoDaDiferenca(180)!.startsWith('Faltaram '))
  assert.ok(textoDaDiferenca(-180)!.endsWith(' a mais'))
  assert.equal(textoDaDiferenca(0), null)
  assert.equal(textoDaDiferenca(null), null)
  assert.equal(textoDaDiferenca(undefined), null)
})
