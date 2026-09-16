// lib/rotas-abertas.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehRotaAberta, ROTAS_ABERTAS } from './rotas-abertas'

test('as SETE rotas que nao podem exigir cracha estao abertas', () => {
  // Exigir cracha nos dois webhooks PARA A ENTRADA DE VENDAS EM SILENCIO:
  // a Hubla e a Kiwify nao tem login, e nenhum erro apareceria em tela.
  for (const r of [
    '/api/webhooks/hubla',
    '/api/webhooks/kiwify',
    '/api/whatsapp/pendentes-vespera',
    '/api/whatsapp/pendentes-30min',
    '/api/whatsapp/marcar-enviado',
    '/api/dashboard-usuarios/login',
    '/api/terapeutas/login',
  ]) {
    assert.equal(ehRotaAberta(r), true, `${r} tem de ficar aberta`)
  }
  assert.equal(ROTAS_ABERTAS.length, 7, 'sao exatamente sete, nem mais nem menos')
})

test('as rotas que DEVEM exigir cracha nao estao na lista', () => {
  for (const r of [
    '/api/terapeutas/dashboard',
    '/api/terapeutas/admin/usuarios',
    '/api/terapeutas/admin/terapeutas',
    '/api/closings',
    '/api/sales',
    '/api/costs',
    '/api/cashflow',
    '/api/dashboard-usuarios',
  ]) {
    assert.equal(ehRotaAberta(r), false, `${r} NAO pode ficar aberta`)
  }
})

test('ARMADILHA: /api/dashboard-usuarios NAO pode pegar carona no /login', () => {
  // `dashboard-usuarios/login` e aberta; `dashboard-usuarios` cria e altera
  // usuario do DRE. Se a comparacao fosse por prefixo, a segunda entraria junto.
  assert.equal(ehRotaAberta('/api/dashboard-usuarios/login'), true)
  assert.equal(ehRotaAberta('/api/dashboard-usuarios'), false)
  assert.equal(ehRotaAberta('/api/dashboard-usuarios/qualquer-coisa'), false)
})

test('barra no fim nao muda o resultado', () => {
  assert.equal(ehRotaAberta('/api/webhooks/hubla/'), true)
  assert.equal(ehRotaAberta('/api/terapeutas/dashboard/'), false)
})

test('endereco com parametro continua sendo a mesma rota', () => {
  assert.equal(ehRotaAberta('/api/whatsapp/pendentes-30min'), true)
  assert.equal(ehRotaAberta('/api/terapeutas/dashboard'), false)
})