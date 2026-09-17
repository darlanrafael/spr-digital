// lib/rotas-abertas.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehRotaAberta, ROTAS_ABERTAS } from './rotas-abertas'

test('as OITO rotas que nao podem exigir cracha estao abertas', () => {
  // Exigir cracha nos dois webhooks PARA A ENTRADA DE VENDAS EM SILENCIO:
  // a Hubla e a Kiwify nao tem login, e nenhum erro apareceria em tela.
  for (const r of [
    '/api/webhooks/hubla',
    '/api/webhooks/kiwify',
    '/api/webhooks/reconciliar',
    '/api/whatsapp/pendentes-vespera',
    '/api/whatsapp/pendentes-30min',
    '/api/whatsapp/marcar-enviado',
    '/api/dashboard-usuarios/login',
    '/api/terapeutas/login',
  ]) {
    assert.equal(ehRotaAberta(r), true, `${r} tem de ficar aberta`)
  }
  assert.equal(ROTAS_ABERTAS.length, 8, 'sao exatamente oito, nem mais nem menos')
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
test('FUZZING: nenhuma variacao maliciosa abre uma rota fechada', () => {
  const abertasExatas = [
    '/api/webhooks/hubla','/api/webhooks/kiwify','/api/webhooks/reconciliar','/api/whatsapp/pendentes-vespera',
    '/api/whatsapp/pendentes-30min','/api/whatsapp/marcar-enviado',
    '/api/dashboard-usuarios/login','/api/terapeutas/login',
  ]
  const fechadas = ['/api/sales','/api/closings','/api/terapeutas/dashboard','/api/terapeutas/admin/usuarios','/api/costs','/api/cashflow']
  // gera variacoes de cada rota fechada que um atacante tentaria
  const truques = (r: string) => [
    r, r+'/', r+'//', r.toUpperCase(), r+'/..', r+'/../webhooks/hubla',
    r+'?x=1', r+'#frag', ' '+r, r+' ', r+'%20', '/'+r, r.replace('/api/','/api//'),
    r+'/../../api/webhooks/hubla',
  ]
  let vazou = 0
  for (const f of fechadas) {
    for (const t of truques(f)) {
      // ehRotaAberta so pode dizer true para as 8 exatas (apos limpeza).
      if (ehRotaAberta(t)) {
        // so e aceitavel se a forma LIMPA for uma das 8 exatas
        const limpo = t.split('?')[0].split('#')[0].trim().replace(/\/+$/,'')
        if (!abertasExatas.includes(limpo)) { vazou++; console.error('VAZOU:', JSON.stringify(t)) }
      }
    }
  }
  assert.equal(vazou, 0, 'alguma variacao de rota fechada foi tratada como aberta')
})

test('FUZZING inverso: as 8 abertas continuam abertas com querystring e barra', () => {
  const abertas = [
    '/api/webhooks/hubla','/api/webhooks/kiwify','/api/webhooks/reconciliar','/api/whatsapp/pendentes-vespera',
    '/api/whatsapp/pendentes-30min','/api/whatsapp/marcar-enviado',
    '/api/dashboard-usuarios/login','/api/terapeutas/login',
  ]
  for (const a of abertas) {
    assert.equal(ehRotaAberta(a), true, a)
    assert.equal(ehRotaAberta(a+'/'), true, a+' com barra')
    assert.equal(ehRotaAberta(a+'?x=1'), true, a+' com querystring')
  }
})
