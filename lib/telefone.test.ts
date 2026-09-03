import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarTelefoneBR, paraWhatsApp } from './telefone'

// Todos os casos abaixo saíram da tabela `sales` em 17/08/2026, quando o
// usuário reportou que mensagem não chegava em número de fora do Brasil.

test('celular brasileiro sem código do país ganha o 55', () => {
  assert.equal(normalizarTelefoneBR('(11) 99198-6114'), '5511991986114')
  assert.equal(normalizarTelefoneBR('11991986114'), '5511991986114')
})

test('número que já vem completo não é alterado', () => {
  assert.equal(normalizarTelefoneBR('5511976411277'), '5511976411277')
  assert.equal(normalizarTelefoneBR('+55 11 97641-1277'), '5511976411277')
})

test('EUA/Canadá não recebe 55 na frente', () => {
  // O bug: +1 973 771-4399 tem 11 dígitos igual a um celular BR com DDD, e
  // virava 5519737714399 — número inexistente. A Z-API aceitava e a mensagem
  // sumia. Cinco pacientes com sessão agendada nunca receberam lembrete.
  assert.equal(normalizarTelefoneBR('+19737714399'), '19737714399') // Fernanda Lima
  assert.equal(normalizarTelefoneBR('+19548122342'), '19548122342') // Camila Queiroz
  assert.equal(normalizarTelefoneBR('+12014234188'), '12014234188') // Fabiano Souza
  assert.equal(normalizarTelefoneBR('+17747078167'), '17747078167') // Ana Assis
  assert.equal(normalizarTelefoneBR('+12677613457'), '12677613457') // Giselle Ildefonso
})

test('"+" sem código do país continua sendo tratado como brasileiro', () => {
  // Metade da base tem "+" sem o 55. Confiar no "+" pra decidir quebraria
  // esses números, que hoje funcionam — foi a primeira hipótese, descartada
  // ao conferir os dados.
  assert.equal(normalizarTelefoneBR('+64999067729'), '5564999067729') // DDD 64, Goiás
  assert.equal(normalizarTelefoneBR('+11948498485'), '5511948498485') // DDD 11, SP
  assert.equal(normalizarTelefoneBR('+17992585665'), '5517992585665') // DDD 17, Rio Preto
  assert.equal(normalizarTelefoneBR('+81982203024'), '5581982203024') // DDD 81, PE
})

test('DDD 55 (Rio Grande do Sul) não é confundido com código do país', () => {
  assert.equal(normalizarTelefoneBR('+55986837406'), '5555986837406')
})

test('número com 11 dígitos começando em 1 mas com DDD válido e 9 é brasileiro', () => {
  // "17992585665": DDD 17 + 9 + 8 dígitos. O 9 na terceira posição é o que
  // separa do +1 americano, que nunca tem 9 ali.
  assert.equal(normalizarTelefoneBR('17992585665'), '5517992585665')
  assert.equal(normalizarTelefoneBR('12991234567'), '5512991234567')
})

test('estrangeiro com 12+ dígitos passa direto', () => {
  assert.equal(normalizarTelefoneBR('+351912345678'), '351912345678') // Portugal
  assert.equal(normalizarTelefoneBR('+595981123456'), '595981123456') // Paraguai
})

test('fixo brasileiro sem código do país ganha o 55', () => {
  assert.equal(normalizarTelefoneBR('(11) 3255-4400'), '551132554400')
})

test('vazio e lixo devolvem null', () => {
  assert.equal(normalizarTelefoneBR(''), null)
  assert.equal(normalizarTelefoneBR(null), null)
  assert.equal(normalizarTelefoneBR(undefined), null)
  assert.equal(normalizarTelefoneBR('sem número'), null)
})

test('caso ambíguo mantém o comportamento antigo em vez de deixar de enviar', () => {
  // "+4790072134": pode ser celular antigo de Santa Catarina (DDD 47) ou
  // celular da Noruega (código 47). Sem como decidir, preserva o que já
  // acontecia — não vale arriscar parar de enviar pra quem talvez receba.
  assert.equal(normalizarTelefoneBR('+4790072134'), '554790072134')
})

test('estrangeiro de 11 digitos com "+" nao vira brasileiro', () => {
  // Todo pais cujo numero completo tem 11 digitos caia no chute "cola 55 na
  // frente" e nunca chegava. Casos reais de paises onde a SPR ja vendeu ou
  // pode vender.
  assert.equal(normalizarTelefoneBR('+56 9 8765 4321'), '56987654321')   // Chile
  assert.equal(normalizarTelefoneBR('+34 612 345 678'), '34612345678')   // Espanha
  assert.equal(normalizarTelefoneBR('+33 6 12 34 56 78'), '33612345678') // Franca
  assert.equal(normalizarTelefoneBR('+598 91 234 567'), '59891234567')   // Uruguai
  assert.equal(normalizarTelefoneBR('+591 71234567'), '59171234567')     // Bolivia
})

test('o "+" so decide o EMPATE, nunca antes dos testes fortes', () => {
  // A metade da base que tem "+" sem codigo de pais continua funcionando: o
  // teste de celular brasileiro (DDD valido + 9) roda ANTES e vence.
  assert.equal(normalizarTelefoneBR('+64999067729'), '5564999067729')  // Goias
  assert.equal(normalizarTelefoneBR('+11948498485'), '5511948498485')  // Sao Paulo
  assert.equal(normalizarTelefoneBR('+55986837406'), '5555986837406')  // DDD 55, RS
  // E o +1 dos EUA continua vencendo o "+" tambem.
  assert.equal(normalizarTelefoneBR('+17747078167'), '17747078167')
})

test('sem o "+", o comportamento antigo e mantido', () => {
  // Nao inventar pais para quem digitou so digitos: 10.055 dos 10.059 telefones
  // da base devolvem exatamente o mesmo valor de antes.
  assert.equal(normalizarTelefoneBR('34642995601'), '5534642995601')
})

test('CASO REAL: numero dos EUA de 10 digitos, digitado sem o +1', () => {
  // Medido na Z-API: nenhum dos dois existe no WhatsApp como "55..." nem cru;
  // os dois existem como "1...". Colar 55 era garantia de nao entregar.
  assert.equal(normalizarTelefoneBR('8044020277'), '18044020277')  // area 804, Virginia
  assert.equal(normalizarTelefoneBR('7814993955'), '17814993955')  // area 781, Massachusetts
  // DDD brasileiro de verdade continua ganhando o 55.
  assert.equal(normalizarTelefoneBR('1133334444'), '551133334444') // fixo de Sao Paulo
  assert.equal(normalizarTelefoneBR('4733334444'), '554733334444') // fixo de SC
})

test('COLISAO QUE NENHUMA REGRA RESOLVE: Peru e Porto Alegre', () => {
  // +51 9XX XXX XXX (Peru) e DDD 51 + 9 + 8 digitos (Porto Alegre) sao a MESMA
  // sequencia de 11 digitos. Nao ha sinal no numero que os separe. Este teste
  // existe para registrar a escolha - vence o Brasil, que e o caso comum - e
  // para quem mexer aqui depois nao achar que e descuido.
  assert.equal(normalizarTelefoneBR('+51 987 654 321'), '5551987654321')
  // Mesma sequencia, sem o "+": mesmo resultado.
  assert.equal(normalizarTelefoneBR('51987654321'), '5551987654321')
})

test('WHATSAPP: DDD de 31 pra cima perde o nono digito', () => {
  // Medido na Z-API em 53 DDDs, um numero real por DDD, sem excecao. Caso real:
  // Marcio de Castro, DDD 84 - mandavamos 5584981114243, o WhatsApp usa
  // 558481114243, e ele nao recebeu o lembrete de 26/08.
  assert.equal(paraWhatsApp('5584981114243'), '558481114243')  // DDD 84
  assert.equal(paraWhatsApp('5547984792382'), '554784792382')  // DDD 47
  assert.equal(paraWhatsApp('5531999999999'), '553199999999')  // DDD 31, a fronteira
  assert.equal(paraWhatsApp('5599991227096'), '559991227096')  // DDD 99
})

test('WHATSAPP: DDD ate 28 mantem o nono digito', () => {
  assert.equal(paraWhatsApp('5511948938242'), '5511948938242')  // DDD 11
  assert.equal(paraWhatsApp('5521999999999'), '5521999999999')  // DDD 21
  assert.equal(paraWhatsApp('5528999999999'), '5528999999999')  // DDD 28, a fronteira
})

test('WHATSAPP: fixo brasileiro nao perde digito nenhum', () => {
  // 12 digitos: 55 + DDD + 8. Nao tem nono digito para tirar.
  assert.equal(paraWhatsApp('554733334444'), '554733334444')
  // E um celular de DDD alto que JA veio sem o 9 fica como esta.
  assert.equal(paraWhatsApp('558481114243'), '558481114243')
})

test('WHATSAPP: Mexico ganha o 1 depois do codigo do pais', () => {
  // Caso real: Natalia Rezende. Mandavamos 525579077715, o WhatsApp usa
  // 5215579077715.
  assert.equal(paraWhatsApp('525579077715'), '5215579077715')
  // E nao ganha duas vezes.
  assert.equal(paraWhatsApp('5215579077715'), '5215579077715')
})

test('WHATSAPP: o que nao e Brasil nem Mexico passa intacto', () => {
  assert.equal(paraWhatsApp('17747078167'), '17747078167')     // EUA
  assert.equal(paraWhatsApp('351925887255'), '351925887255')   // Portugal
  assert.equal(paraWhatsApp(null), null)
  assert.equal(paraWhatsApp(''), null)
})
