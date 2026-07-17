-- atividades_log_tipo_acao_check só permitia 8 valores, mas o código já usa
-- vários outros ('iniciar', 'lancamento_manual', 'fechamento_comissao',
-- 'reembolso_aprovado', 'reembolso_rejeitado', 'nota', 'solicitacao_reembolso',
-- e agora 'compromisso_criado'/'compromisso_apagado') — todo insert com um
-- desses tipos vinha falhando em silêncio (o código não checa o erro do
-- insert), sem quebrar a ação em si, só sem deixar rastro de auditoria.
-- Amplia a constraint pra cobrir todo valor já usado no código.
alter table atividades_log drop constraint if exists atividades_log_tipo_acao_check;
alter table atividades_log add constraint atividades_log_tipo_acao_check
  check (tipo_acao = any (array[
    'agendamento', 'remarcacao', 'confirmacao_entrega', 'cancelamento', 'reembolso',
    'cadastro_usuario', 'edicao_usuario', 'desativacao_usuario',
    'iniciar', 'lancamento_manual', 'fechamento_comissao',
    'reembolso_aprovado', 'reembolso_rejeitado', 'nota', 'solicitacao_reembolso',
    'compromisso_criado', 'compromisso_apagado'
  ]));
