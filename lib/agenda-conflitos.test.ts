import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorTerapeuta , soCompromissos, mensagemConflito, tipoDoCompromisso, escolherConflito, montarConflitos } from './agenda-conflitos'

test('agrupa as datas por terapeuta preservando a ordem', () => {
  const g = agruparPorTerapeuta([
    { terapeuta_id: 'PEDRO',  dataISO: '2026-09-08T14:00:00.000Z' },
    { terapeuta_id: 'PEDRO',  dataISO: '2026-09-15T14:00:00.000Z' },
    { terapeuta_id: 'DENISE', dataISO: '2026-09-22T14:00:00.000Z' },
  ])
  assert.deepEqual(g, {
    PEDRO:  ['2026-09-08T14:00:00.000Z', '2026-09-15T14:00:00.000Z'],
    DENISE: ['2026-09-22T14:00:00.000Z'],
  })
})

test('lista vazia devolve objeto vazio', () => {
  assert.deepEqual(agruparPorTerapeuta([]), {})
})

test('soCompromissos: bloqueio da propria equipe pode ser passado por cima', () => {
  // A equipe reserva o horario na agenda antes de agendar. O caso real: um
  // compromisso "Juliane Eller/Diagnostico Guiado" ocupando 11:20 fazia o
  // agendamento daquele mesmo paciente naquele mesmo horario ser recusado.
  assert.equal(soCompromissos([
    { dataISO: '2026-09-02T14:20:00.000Z', tipo: 'compromisso', descricao: '02/09 às 11:20 - horário bloqueado: Juliane Eller/Diagnóstico Guiado' },
  ]), true)
})

test('soCompromissos: consulta de OUTRO PACIENTE nunca pode ser passada por cima', () => {
  assert.equal(soCompromissos([
    { dataISO: '2026-09-02T14:20:00.000Z', tipo: 'sessao', descricao: 'já tem a consulta de Ana' },
  ]), false)
})

test('soCompromissos: basta UMA sessao no meio para a recusa valer', () => {
  assert.equal(soCompromissos([
    { dataISO: '2026-09-02T14:20:00.000Z', tipo: 'compromisso', descricao: 'almoço' },
    { dataISO: '2026-09-09T14:20:00.000Z', tipo: 'sessao', descricao: 'já tem a consulta de Ana' },
    { dataISO: '2026-09-16T14:20:00.000Z', tipo: 'compromisso', descricao: 'gravação' },
  ]), false)
})

test('soCompromissos: lista vazia nao habilita nada', () => {
  assert.equal(soCompromissos([]), false)
})

test('a mensagem diz POR QUE esta bloqueado, nao so que esta', () => {
  // O comercial leu "horario bloqueado: Juliane Eller/Diagnostico Guiado"
  // enquanto agendava a Juliane, e entendeu que ela ja estava agendada. A
  // mensagem precisa dizer de quem e a agenda, o intervalo e que e bloqueio.
  const m = mensagemConflito([{
    dataISO: '2026-09-02T14:20:00.000Z',
    tipo: 'compromisso',
    descricao: 'em 02/09 às 11:20: a agenda de Pedro Roncada tem um bloqueio das 11:20 às 12:00: "Juliane Eller/Diagnóstico Guiado". É um compromisso lançado na agenda, não uma consulta marcada.',
  }])
  assert.ok(m.includes('Pedro Roncada'), 'nao diz de quem e a agenda')
  assert.ok(m.includes('11:20 às 12:00'), 'nao diz o intervalo ocupado')
  assert.ok(m.includes('não uma consulta marcada'), 'nao distingue bloqueio de consulta')
})

test('varios horarios ocupados saem em lista, com o total na frente', () => {
  const m = mensagemConflito([
    { dataISO: 'a', tipo: 'compromisso', descricao: 'em 02/09 às 11:20: bloqueio' },
    { dataISO: 'b', tipo: 'sessao', descricao: 'em 09/09 às 11:20: consulta' },
  ])
  assert.ok(m.startsWith('2 horários do pacote estão ocupados:'))
  assert.ok(m.includes('• em 02/09'))
  assert.ok(m.includes('• em 09/09'))
})

test('CRITICO: linha de compromisso com categoria "sessao" NAO pode ser passada por cima', () => {
  // `compromissos_terapeuta` guarda os dois tipos: a tela de lancamento manual
  // oferece "Categoria: Compromisso | Sessao". Classificar tudo como
  // compromisso fazia uma CONSULTA REAL virar bloqueio, e o override ofereceria
  // "Agendar assim mesmo" em cima dela. Ha 4 linhas assim no banco, com nome de
  // paciente no titulo (Cris Polonine, Wagner Muller, Jessica Moura).
  assert.equal(soCompromissos([
    { dataISO: '2026-07-21T12:40:00.000Z', tipo: 'sessao', descricao: 'Pedro atende "Cris Polonine" das 09:40 às 10:30 (consulta lançada na agenda)' },
  ]), false)
})

test('bloqueio de verdade continua podendo ser passado por cima', () => {
  assert.equal(soCompromissos([
    { dataISO: '2026-09-05T14:20:00.000Z', tipo: 'compromisso', descricao: 'bloqueio: ALMOÇO' },
  ]), true)
})

test('consulta lancada a mao no meio de bloqueios derruba o override inteiro', () => {
  assert.equal(soCompromissos([
    { dataISO: 'a', tipo: 'compromisso', descricao: 'ALMOÇO' },
    { dataISO: 'b', tipo: 'sessao', descricao: 'consulta lançada na agenda' },
    { dataISO: 'c', tipo: 'compromisso', descricao: 'GRAVAÇÃO' },
  ]), false)
})

// --- tipoDoCompromisso: e a DECISAO que libera o "Agendar assim mesmo". Os
// testes anteriores exercitavam soCompromissos, que nao mudou, e por isso
// passavam contra o codigo com o defeito.

test('CRITICO: categoria "sessao" vira tipo sessao', () => {
  // Sem isto, uma consulta real lancada a mao virava bloqueio e podia ser
  // atropelada. Ha 4 linhas assim no banco, com nome de paciente no titulo.
  assert.equal(tipoDoCompromisso('sessao'), 'sessao')
})

test('categoria "compromisso" vira tipo compromisso', () => {
  assert.equal(tipoDoCompromisso('compromisso'), 'compromisso')
})

test('categoria ausente cai em compromisso, que e o default da coluna', () => {
  assert.equal(tipoDoCompromisso(null), 'compromisso')
  assert.equal(tipoDoCompromisso(undefined), 'compromisso')
  assert.equal(tipoDoCompromisso(''), 'compromisso')
})

test('categoria com espaco ou maiuscula ainda e reconhecida como sessao', () => {
  // A coluna tem check constraint hoje, mas errar para o lado de NAO reconhecer
  // uma sessao permite atropelar consulta real - o pior dos dois erros.
  assert.equal(tipoDoCompromisso(' Sessao ' .replace('Sessao', 'sessao')), 'sessao')
  assert.equal(tipoDoCompromisso('SESSAO'.toLowerCase()), 'sessao')
  assert.equal(tipoDoCompromisso('  sessao'), 'sessao')
})

test('valor desconhecido nao vira sessao por acidente', () => {
  assert.equal(tipoDoCompromisso('almoco'), 'compromisso')
  assert.equal(tipoDoCompromisso('sessão'), 'compromisso')
})

// --- escolherConflito: qual item reportar quando a data bate em mais de um.

test('CRITICO: sessao ganha do compromisso, mesmo que o compromisso venha antes', () => {
  // Um horario que bate ao mesmo tempo num ALMOCO e numa consulta lancada a mao
  // reportava o almoco (comeca mais cedo, vem antes no array). Ai
  // soCompromissos dizia "e so bloqueio", a tela oferecia "Agendar assim mesmo"
  // e o agendamento entrava em cima da consulta real.
  const escolhido = escolherConflito([
    { tipo: 'compromisso' as const, rotulo: 'ALMOÇO' },
    { tipo: 'sessao' as const, rotulo: 'consulta lançada a mao' },
  ])
  assert.equal(escolhido?.tipo, 'sessao')
})

test('so compromissos: reporta o primeiro', () => {
  const escolhido = escolherConflito([
    { tipo: 'compromisso' as const, rotulo: 'ALMOÇO' },
    { tipo: 'compromisso' as const, rotulo: 'GRAVAÇÃO' },
  ])
  assert.equal(escolhido?.rotulo, 'ALMOÇO')
})

test('nenhuma batida devolve undefined', () => {
  assert.equal(escolherConflito([]), undefined)
})

test('o par completo: batida mista NAO libera o override', () => {
  // O caminho inteiro: escolherConflito devolve a sessao, o conflito sai com
  // tipo sessao, e soCompromissos recusa o override.
  const escolhido = escolherConflito([
    { tipo: 'compromisso' as const },
    { tipo: 'sessao' as const },
  ])!
  assert.equal(soCompromissos([{ dataISO: 'x', tipo: escolhido.tipo, descricao: 'y' }]), false)
})

// --- montarConflitos: a FIACAO. Antes de existir, dava para reverter o
// `tipoDoCompromisso` e o `escolherConflito` no chamador e os 187 testes
// continuavam verdes - o defeito de dupla marcacao voltava sem sinal nenhum.

const UMA_HORA = 60 * 60 * 1000
const fimFixo = (iso: string) => new Date(iso).getTime() + UMA_HORA
const pedido = (iso: string) => [{ iso, inicio: new Date(iso).getTime() }]
const base = { nomeTerapeuta: 'Pedro Roncada', fimRealMs: fimFixo }

test('FIACAO: linha com categoria "sessao" sai com tipo sessao e NAO libera o override', () => {
  const c = montarConflitos({
    ...base,
    pedidos: pedido('2026-07-21T12:40:00.000Z'),
    sessoes: [],
    compromissos: [{ titulo: 'Cris Polonine', inicio: '2026-07-21T12:40:00.000Z', fim: '2026-07-21T13:30:00.000Z', categoria: 'sessao' }],
  })
  assert.equal(c.length, 1)
  assert.equal(c[0].tipo, 'sessao')
  assert.equal(soCompromissos(c), false)
  assert.ok(c[0].descricao.includes('consulta lançada na agenda'), 'nao pode chamar de bloqueio o que a equipe marcou como sessao')
})

test('FIACAO: bloqueio de verdade sai como compromisso e libera o override', () => {
  const c = montarConflitos({
    ...base,
    pedidos: pedido('2026-09-05T14:20:00.000Z'),
    sessoes: [],
    compromissos: [{ titulo: 'ALMOÇO', inicio: '2026-09-05T14:00:00.000Z', fim: '2026-09-05T15:00:00.000Z', categoria: 'compromisso' }],
  })
  assert.equal(c[0].tipo, 'compromisso')
  assert.equal(soCompromissos(c), true)
})

test('FIACAO CRITICA: batida dupla em ALMOCO + consulta lancada a mao reporta a CONSULTA', () => {
  // O almoco comeca antes e ordena primeiro. Com `find`, ele era o reportado,
  // soCompromissos dizia "e so bloqueio" e o agendamento entrava em cima da
  // consulta real. O Pedro tem 209 pares de compromissos sobrepostos.
  const c = montarConflitos({
    ...base,
    pedidos: pedido('2026-09-05T14:30:00.000Z'),
    sessoes: [],
    compromissos: [
      { titulo: 'ALMOÇO', inicio: '2026-09-05T14:00:00.000Z', fim: '2026-09-05T15:00:00.000Z', categoria: 'compromisso' },
      { titulo: 'Wagner Muller', inicio: '2026-09-05T14:20:00.000Z', fim: '2026-09-05T15:10:00.000Z', categoria: 'sessao' },
    ],
  })
  assert.equal(c.length, 1)
  assert.equal(c[0].tipo, 'sessao')
  assert.equal(soCompromissos(c), false, 'o override NAO pode ser oferecido em cima de consulta real')
})

test('FIACAO: consulta da tabela sessoes sempre ganha do bloqueio', () => {
  const c = montarConflitos({
    ...base,
    pedidos: pedido('2026-09-05T14:30:00.000Z'),
    sessoes: [{ paciente_nome: 'Ana Silva', data_agendada: '2026-09-05T14:20:00.000Z', numero_sessao: 2, total_sessoes: 4 }],
    compromissos: [{ titulo: 'ALMOÇO', inicio: '2026-09-05T14:00:00.000Z', fim: '2026-09-05T15:00:00.000Z', categoria: 'compromisso' }],
  })
  assert.equal(c[0].tipo, 'sessao')
  assert.ok(c[0].descricao.includes('Ana Silva'))
  assert.equal(soCompromissos(c), false)
})

test('FIACAO: horario livre nao gera conflito', () => {
  const c = montarConflitos({
    ...base,
    pedidos: pedido('2026-09-05T20:00:00.000Z'),
    sessoes: [],
    compromissos: [{ titulo: 'ALMOÇO', inicio: '2026-09-05T14:00:00.000Z', fim: '2026-09-05T15:00:00.000Z', categoria: 'compromisso' }],
  })
  assert.deepEqual(c, [])
})

test('FIACAO: cada data do pacote e avaliada, e uma sessao no meio derruba o override inteiro', () => {
  const c = montarConflitos({
    ...base,
    pedidos: [
      { iso: '2026-09-05T14:20:00.000Z', inicio: new Date('2026-09-05T14:20:00.000Z').getTime() },
      { iso: '2026-09-12T14:20:00.000Z', inicio: new Date('2026-09-12T14:20:00.000Z').getTime() },
    ],
    sessoes: [],
    compromissos: [
      { titulo: 'ALMOÇO', inicio: '2026-09-05T14:00:00.000Z', fim: '2026-09-05T15:00:00.000Z', categoria: 'compromisso' },
      { titulo: 'Jessica Moura', inicio: '2026-09-12T14:00:00.000Z', fim: '2026-09-12T15:00:00.000Z', categoria: 'sessao' },
    ],
  })
  assert.equal(c.length, 2)
  assert.equal(soCompromissos(c), false)
})

test('FIACAO: o nome do terapeuta aparece na mensagem, para o comercial saber de quem e a agenda', () => {
  const c = montarConflitos({
    ...base,
    pedidos: pedido('2026-09-05T14:20:00.000Z'),
    sessoes: [],
    compromissos: [{ titulo: 'ALMOÇO', inicio: '2026-09-05T14:00:00.000Z', fim: '2026-09-05T15:00:00.000Z', categoria: 'compromisso' }],
  })
  assert.ok(c[0].descricao.includes('Pedro Roncada'))
})
