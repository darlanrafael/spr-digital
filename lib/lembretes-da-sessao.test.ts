import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEMBRETES_ZERADOS, COLUNAS_LEMBRETE, comLembretesZerados } from './lembretes-da-sessao'

// Bug real (09/10/2026): a sessao da Aline Damam foi remarcada em 06/10 para
// 09/10, mas os 4 carimbos de "lembrete enviado" ficaram com a data antiga.
// O disparo (lib/whatsapp-pendentes) so pega sessao com ALGUM carimbo nulo,
// entao ela entrou como "ja avisada" e o paciente nao recebeu lembrete na data
// nova. Este modulo e a fonte unica dos campos que precisam ser zerados quando
// a sessao muda de data (remarcar + empurrar-seguintes).

// Os 4 nomes TEM de ser exatamente os que o disparo confere em
// lib/whatsapp-pendentes.ts (colGrupo/colPaciente de vespera e de 30min). Se um
// nome divergir, o reset nao limpa a coluna que o disparo olha e o bug volta.
test('cobre exatamente as 4 colunas de controle de lembrete', () => {
  assert.deepEqual([...COLUNAS_LEMBRETE].sort(), [
    'lembrete_grupo_30min_enviado_em',
    'lembrete_grupo_vespera_enviado_em',
    'lembrete_paciente_30min_enviado_em',
    'lembrete_paciente_vespera_enviado_em',
  ])
})

test('LEMBRETES_ZERADOS tem as 4 colunas, todas null', () => {
  assert.equal(Object.keys(LEMBRETES_ZERADOS).length, 4)
  for (const col of COLUNAS_LEMBRETE) {
    assert.ok(col in LEMBRETES_ZERADOS, `${col} ausente`)
    assert.equal((LEMBRETES_ZERADOS as Record<string, unknown>)[col], null, `${col} deveria ser null`)
  }
})

test('comLembretesZerados preserva o resto do payload e acrescenta os nulls', () => {
  const patch = { data_agendada: '2026-10-09T14:20:00+00:00', status: 'agendada', updated_at: 'x' }
  const r = comLembretesZerados(patch)
  // o que veio fica intacto
  assert.equal(r.data_agendada, '2026-10-09T14:20:00+00:00')
  assert.equal(r.status, 'agendada')
  assert.equal(r.updated_at, 'x')
  // os 4 carimbos entram zerados
  for (const col of COLUNAS_LEMBRETE) {
    assert.equal((r as Record<string, unknown>)[col], null)
  }
})

test('uma sessao com os 4 carimbos cheios volta a ser elegivel apos o reset', () => {
  // replica a regra do disparo: elegivel = ALGUM carimbo nulo
  const elegivel = (s: Record<string, unknown>) =>
    COLUNAS_LEMBRETE.some(c => s[c] == null)
  const stale = {
    lembrete_grupo_vespera_enviado_em: '2026-09-30T00:30:54.585+00:00',
    lembrete_paciente_vespera_enviado_em: '2026-09-30T00:30:54.455+00:00',
    lembrete_grupo_30min_enviado_em: '2026-09-30T13:50:57.903+00:00',
    lembrete_paciente_30min_enviado_em: '2026-09-30T13:50:57.903+00:00',
  }
  assert.equal(elegivel(stale), false, 'com os 4 cheios o disparo pula')
  assert.equal(elegivel(comLembretesZerados(stale)), true, 'apos o reset volta a entrar')
})
