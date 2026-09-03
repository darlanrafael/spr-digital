-- Nome da oferta na venda.
--
-- Ele ja chega nos dois webhooks e era jogado fora:
--   Hubla:  event.products[].offers[].name   ("Formato - 4 Sessão")
--   Kiwify: Product.product_offer_name       ("A Reaproximação 14 Julho")
--
-- Por que passa a ser guardado: a quantidade de sessoes de um pacote e regra do
-- negocio, nao escolha de quem agenda. Hoje ela e deduzida do `preco_base`
-- contra uma tabela de precos, e o campo fica EDITAVEL na tela, com um aviso
-- mandando o comercial conferir numa planilha. Medido em 02/09/2026 sobre as
-- 232 vendas de Mentoria aprovadas: 202 batem exato na tabela, 30 nao - e as
-- diferencas vao de R$ 1 (arredondamento da plataforma) a R$ 1.140.
--
-- O nome da oferta diz a quantidade sem ambiguidade ("Formato - 2 Sessão",
-- "Formato - 8 Sessão", "FORMATO 1"), sem depender de arredondamento nem de
-- promocao. Com ele, o valor deixa de ser a fonte e passa a ser a CONFERENCIA:
-- quando os dois discordam acima de R$ 5, o sistema pergunta ao comercial em
-- vez de escolher sozinho.
alter table sales add column if not exists oferta_nome text;

comment on column sales.oferta_nome is
  'Nome da oferta na plataforma. Hubla: products[].offers[].name. Kiwify: Product.product_offer_name. Fonte da quantidade de sessoes do pacote.';

-- Consultas de reconciliacao filtram por nome de oferta.
create index if not exists idx_sales_oferta_nome on sales (oferta_nome);
