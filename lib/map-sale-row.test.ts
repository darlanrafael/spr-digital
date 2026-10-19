import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapSaleRow } from './services'

// NASCEU DE UM ROMBO REAL (19/10/2026): getSales fazia `select('*')` (trazia tudo
// do banco), mas `mapSaleRow` montava o objeto Sale com uma LISTA EXPLICITA de
// campos e deixava varios de fora. Os campos dropados chegavam `undefined` na
// tela, e quem os lia caia num fallback silencioso:
//   - `oferta_nome`     -> o formato do Diagnostico nao era reconhecido -> o
//                          repasse da Denise (R$95/sessao) nao era deduzido.
//   - `valor_com_juros` -> a base do imposto caia para `valor_pago_cliente` ->
//                          imposto subestimado em toda venda parcelada.
// Somados, R$ 11.800,61 de lucro inflado em 13 fechamentos. A linha do banco e
// da funcao estavam certas - o furo era so o campo nao copiado aqui.

const linhaCompleta = () => ({
  id: 'kw-1',
  nome: 'Fulano',
  email: 'f@x.local',
  telefone: '11999',
  produto: 'Diagnóstico Guiado: Programa de acompanhamento Individual',
  plataforma: 'Kiwify',
  order_id: 'c1a15f89-3fe3-4e7b-8bb0-a638985e6d5c',
  oferta_nome: 'FORMATO 1',
  preco_base: 4997,
  valor_pago_cliente: 4997,
  valor_com_juros: 6201.72,
  valor_liquido: 4500,
  moeda: null,
  cambio_aplicado: 5.0179,
  valores_originais: { moeda: 'USD', normalizado: true },
  pacote_pai_id: 'pai-123',
  data_hora: '2026-10-16T13:00:00Z',
  utm_source: 'FB',
  utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
  status: 'aprovada',
  project_id: 'proj_1',
})

test('mapSaleRow preserva oferta_nome (formato do Diagnostico)', () => {
  assert.equal(mapSaleRow(linhaCompleta()).oferta_nome, 'FORMATO 1')
})

test('mapSaleRow preserva valor_com_juros (base do imposto)', () => {
  assert.equal(mapSaleRow(linhaCompleta()).valor_com_juros, 6201.72)
})

test('mapSaleRow preserva cambio_aplicado e valores_originais (moeda internacional)', () => {
  const s = mapSaleRow(linhaCompleta())
  assert.equal(s.cambio_aplicado, 5.0179)
  assert.deepEqual(s.valores_originais, { moeda: 'USD', normalizado: true })
})

test('mapSaleRow preserva pacote_pai_id', () => {
  assert.equal(mapSaleRow(linhaCompleta()).pacote_pai_id, 'pai-123')
})

// Guarda da CLASSE do bug: todo campo que o tipo Sale declara e que a linha do
// banco traz tem que sobreviver ao mapeamento. Sem este teste, o proximo campo
// novo e dropado em silencio como estes foram.
test('mapSaleRow nao dropa nenhum campo que a linha trouxe e o Sale declara', () => {
  const s = mapSaleRow(linhaCompleta()) as unknown as Record<string, unknown>
  for (const campo of [
    'oferta_nome', 'valor_com_juros', 'cambio_aplicado', 'valores_originais', 'pacote_pai_id',
  ]) {
    assert.ok(s[campo] !== undefined, `mapSaleRow dropou "${campo}" (chegaria undefined na tela)`)
  }
})

test('valor_com_juros ausente no banco vira undefined (nao quebra o fallback do imposto)', () => {
  const row = linhaCompleta() as Record<string, unknown>
  delete row.valor_com_juros
  assert.equal(mapSaleRow(row).valor_com_juros, undefined)
})
