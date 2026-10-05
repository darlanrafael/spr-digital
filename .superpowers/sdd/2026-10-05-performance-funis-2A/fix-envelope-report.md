# Fix: envelope do webhook no seeding e backfill

Bug: seeding passava o payload cru; Hubla aninha o produto em payload.event, logo catalogo saia com hubla:0 (medido: kiwify 16, hubla 0; desembrulhado: 16/17).
Correcao: lib/evento-do-webhook.ts (helper puro) usado em scripts/semear-catalogo-produtos.ts e scripts/backfill-produto-id-vendas.ts (type-guards mantidos, incluindo retorno nulo quando hubla nao tem event).
Testes: evento-do-webhook 5/5; npm test 862/862; tsc --noEmit limpo; tsc isolado incluindo os dois scripts limpo.
Nenhum script foi executado contra o banco. O seeding precisa ser reexecutado (idempotente) para incluir os produtos Hubla.
