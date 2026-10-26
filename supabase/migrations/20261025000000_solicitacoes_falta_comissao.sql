-- "Nao compareceu" (falta) passa a mandar a COMISSAO da Denise/Leomir pra
-- aprovacao do dono, e a sessao a ser consumida (paciente perde, pacote anda).
--
-- Decisao do dono (25/10/2026): "Se o Leomir ou a Denise clicar em nao
-- compareceu, registra no prontuario daquela sessao de forma imediata, e manda
-- para aprovacao para eu decidir se eu aprovo a comissao deles ou nao. Porque
-- se o paciente nao compareceu a sessao, teoricamente ele perdeu o horario. E
-- ai e justo ele receber. Mas eu quero decidir isso." O Pedro nao entra: recebe
-- como socio no fechamento. Ver itens 123.3 e 125 do spr-digital.md.
--
-- Mesmo padrao das outras aprovacoes (solicitacoes_reembolso,
-- solicitacoes_lancamento_manual): uma tabela por tipo, a tela de Aprovacoes
-- junta todas. Os campos do paciente/sessao sao COPIADOS pra lista ser legivel
-- numa consulta so. A sessao ja foi consumida quando a falta e criada; o
-- `comissao_valor` guardado aqui e o que VOLTA pra sessao se o dono aprovar
-- (na sessao ela saiu zerada pra nao contar enquanto espera decisao).
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

  -- A comissao que VOLTA pra sessao se for aprovada (na sessao ela esta 0).
  comissao_valor numeric not null default 0,

  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'negado')),

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

-- tipo_acao da auditoria: a allow-list nunca teve 'nao_compareceu' (o log da
-- falta falhava silencioso com 23514 - mesmo bug ja corrigido 3x antes, ver
-- 20260718010000/20260723000000/20260901000000). Corrige junto e adiciona os
-- tres tipos novos da aprovacao de falta. Lista = a anterior + os novos.
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
