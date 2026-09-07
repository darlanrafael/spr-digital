-- A quantidade de sessões informada pelo comercial, quando o sistema não
-- consegue determiná-la.
--
-- A regra continua sendo a de 03/09/2026: o comercial NÃO decide a quantidade
-- de uma venda cuja quantidade o sistema conhece. O que mudou (usuário,
-- 06/09/2026) é o caso em que o sistema NÃO conhece:
--
--   "pensei em deixar em situações assim, o próprio Felipe informar na tela do
--    próprio agendamento, uma vez que o sistema não consegue identificar.
--    Estamos tentando aumentar alguns pacotes progressivamente. Então vai
--    acontecer novamente isso. E como não temos uma tabela de quanto irá
--    aumentar, pois estamos ainda testando."
--
-- Travar seria travar a venda: o pacote novo existe, foi vendido, e a tabela
-- de preços ainda não existe porque ele está em teste. Quem sabe quantas
-- sessões são é quem vendeu.
--
-- O tipo é próprio, e não `valor_divergente`, porque são duas coisas
-- diferentes na conferência do CEO: uma é "o valor não fechou com o pacote",
-- a outra é "não havia pacote nenhum a fechar, e alguém informou".
alter table ocorrencias_pacote drop constraint if exists ocorrencias_pacote_tipo_check;
alter table ocorrencias_pacote add constraint ocorrencias_pacote_tipo_check
  check (tipo in ('mesmo_pacote', 'compra_separada', 'valor_divergente', 'quantidade_informada'));
