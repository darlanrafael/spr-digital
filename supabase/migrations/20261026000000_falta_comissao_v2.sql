-- Falta ("nao compareceu") da Denise/Leomir passa a ir pra aprovacao do dono,
-- mas a comissao NAO e mais zerada na sessao. A v1 (20261025000000, nunca
-- aplicada em producao) zerava comissao_valor da sessao enquanto a falta
-- esperava decisao, e restaurava depois. Isso era fonte de bug (valor
-- sumia/voltava). Na v2 a sessao mantem a comissao e ganha uma trava
-- booleana: comissao_bloqueada = true enquanto a falta estiver pendente.
-- O fechamento le essa trava e nao paga a comissao bloqueada. Aprovar ou
-- negar so muda a trava e o status da solicitacao, sem reescrever valores.
--
-- Decisao do dono (25/10/2026): "Se o Leomir ou a Denise clicar em nao
-- compareceu, registra no prontuario daquela sessao de forma imediata, e manda
-- para aprovacao para eu decidir se eu aprovo a comissao deles ou nao. Porque
-- se o paciente nao compareceu a sessao, teoricamente ele perdeu o horario. E
-- ai e justo ele receber. Mas eu quero decidir isso." O Pedro nao entra: socio nao recebe
-- comissao de sessao por este fluxo (a dele fica travada); o acerto do socio e o
-- lucro/divisao no DRE, outra conta. Ver itens 123.3 e 125 do spr-digital.md.
--
-- Mesmo padrao das outras aprovacoes (solicitacoes_reembolso,
-- solicitacoes_lancamento_manual): uma tabela por tipo, a tela de Aprovacoes
-- junta todas. Os campos do paciente/sessao sao COPIADOS pra lista ser legivel
-- numa consulta so. comissao_valor aqui e so pra exibir na fila de aprovacao;
-- a fonte da verdade do valor continua sendo a sessao.

-- Trava da comissao: true = falta pendente (ou negada), nao entra no fechamento.
alter table sessoes add column if not exists comissao_bloqueada boolean not null default false;

create table if not exists solicitacoes_falta_comissao (
  id uuid primary key default gen_random_uuid(),

  sessao_id uuid not null references sessoes(id),
  -- sale_id guarda uuid, mas a coluna de sales e text/externa: sem FK de
  -- proposito, e so referencia pra abrir o prontuario do pacote.
  sale_id text,

  terapeuta_id uuid references terapeutas(id),
  terapeuta_nome text,
  paciente_nome text,
  paciente_email text,
  numero_sessao integer,
  total_sessoes integer,
  data_sessao timestamptz,

  -- Valor da comissao da sessao no momento da falta. So pra exibir na fila.
  comissao_valor numeric not null default 0,

  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'negado', 'cancelado')),

  solicitado_por_nome text,
  solicitado_por_email text,
  created_at timestamptz not null default now(),

  decidido_por_nome text,
  decidido_por_email text,
  decidido_em timestamptz,

  -- Trava de idempotencia: nao criar duas faltas pendentes pra mesma sessao.
  constraint uq_falta_sessao_pendente unique (sessao_id)
);

create index if not exists idx_solicitacoes_falta_status
  on solicitacoes_falta_comissao (status, created_at desc);

-- Tipos novos do prontuario: a falta registra 'nao_compareceu' (ja existente)
-- e a decisao do dono vira ocorrencia 'falta_comissao_aprovada' ou
-- 'falta_comissao_negada'. Lista = a anterior + os dois novos.
alter table ocorrencias_prontuario
  drop constraint if exists ocorrencias_prontuario_tipo_check;

alter table ocorrencias_prontuario
  add constraint ocorrencias_prontuario_tipo_check
  check (tipo = any (array[
    'nota'::text,
    'remarcacao'::text,
    'confirmacao_entrega'::text,
    'solicitacao_reembolso'::text,
    'reembolso_aprovado'::text,
    'reembolso_rejeitado'::text,
    'orientacao_sessao'::text,
    'nao_compareceu'::text,
    'falta_comissao_aprovada'::text,
    'falta_comissao_negada'::text
  ]));

-- tipo_acao da auditoria: 'nao_compareceu' nunca esteve na allow-list (o log
-- da falta falhava silencioso com 23514, mesmo bug ja corrigido antes em
-- 20260718010000/20260723000000/20260901000000). Corrige junto e adiciona os
-- tipos da solicitacao e da decisao. Lista = a anterior + os novos.
alter table atividades_log drop constraint if exists atividades_log_tipo_acao_check;
alter table atividades_log add constraint atividades_log_tipo_acao_check
  check (tipo_acao = any (array[
    'agendamento', 'remarcacao', 'confirmacao_entrega', 'cancelamento', 'reembolso',
    'cadastro_usuario', 'edicao_usuario', 'desativacao_usuario',
    'iniciar', 'lancamento_manual', 'fechamento_comissao',
    'reembolso_aprovado', 'reembolso_rejeitado', 'nota', 'solicitacao_reembolso',
    'compromisso_criado', 'compromisso_apagado',
    'orientacao_sessao', 'orientacao_sessao_editada', 'paciente_editado',
    'empurrar_seguintes',
    'nao_compareceu', 'solicitacao_falta_comissao',
    'falta_comissao_aprovada', 'falta_comissao_negada'
  ]));
