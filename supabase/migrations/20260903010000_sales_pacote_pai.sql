-- Vendas que fazem parte do MESMO pacote.
--
-- O caso que obrigou isto (Amanda da Silva Rios, 02/09/2026): ela comprou duas
-- ofertas de "Formato - 4 Sessão" em 24/08 as 21:28 e 25/08 as 12:43, por
-- R$ 2.600 e R$ 2.680. Sao 8 sessoes por R$ 5.280, exatamente o preco de tabela
-- do pacote de 8. As 8 sessoes foram agendadas numa das vendas, e a outra ficou
-- presa em "Pendentes de Agendamento" para sempre, porque a regra de pendente e
-- "venda sem nenhuma sessao".
--
-- `pacote_pai_id` aponta para a venda que carrega as sessoes. Venda com este
-- campo preenchido NAO aparece em Pendentes: ela ja foi agendada junto.
--
-- Por que uma coluna e nao uma tabela de ligacao: a relacao e sempre
-- "esta venda pertence aquele pacote", nunca muitos-para-muitos, e assim a
-- consulta de pendentes filtra sem join.
alter table sales add column if not exists pacote_pai_id text;

comment on column sales.pacote_pai_id is
  'Venda que carrega as sessoes deste pacote. Preenchido quando o paciente pagou o mesmo pacote em mais de uma compra. Venda com este campo nao entra em Pendentes de Agendamento.';

create index if not exists idx_sales_pacote_pai on sales (pacote_pai_id);
