import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoDoResumoMeta, AVISO_SEM_TOKEN, AVISO_META_INCOMPLETA } from './aviso-meta'

// Aviso amarelo da tela de Funis quando a Meta nao responde por completo (dono
// 10/11/2026, Task 5). Na visao geral o diario nao entra.

const base = { semToken: false, falhouCampanhas: false, falhouDiario: false, visaoGeral: false }

test('textos exatos', () => {
  assert.equal(AVISO_SEM_TOKEN, 'Os dados da Meta estão indisponíveis no momento. Verifique a conexão/token.')
  assert.equal(AVISO_META_INCOMPLETA, 'A Meta não respondeu por completo. O Investido, o ROAS e os anúncios podem estar menores do que o real. Clique em Atualizar.')
})

test('sem nada: null', () => assert.equal(avisoDoResumoMeta(base), null))
test('so token: texto do token', () => assert.equal(avisoDoResumoMeta({ ...base, semToken: true }), AVISO_SEM_TOKEN))
test('so campanhas: texto da Meta', () => assert.equal(avisoDoResumoMeta({ ...base, falhouCampanhas: true }), AVISO_META_INCOMPLETA))
test('token + campanhas: os dois, separados por espaco', () =>
  assert.equal(avisoDoResumoMeta({ ...base, semToken: true, falhouCampanhas: true }), `${AVISO_SEM_TOKEN} ${AVISO_META_INCOMPLETA}`))
test('visao geral com so diario: null', () => assert.equal(avisoDoResumoMeta({ ...base, visaoGeral: true, falhouDiario: true }), null))
test('visao geral com campanhas: texto da Meta', () =>
  assert.equal(avisoDoResumoMeta({ ...base, visaoGeral: true, falhouCampanhas: true }), AVISO_META_INCOMPLETA))
test('detalhe com so diario: texto da Meta', () => assert.equal(avisoDoResumoMeta({ ...base, falhouDiario: true }), AVISO_META_INCOMPLETA))
