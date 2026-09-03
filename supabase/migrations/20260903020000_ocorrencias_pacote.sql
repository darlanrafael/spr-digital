-- Registro das respostas do comercial sobre pacote pago em mais de uma compra.
--
-- Pedido do usuario em 03/09/2026: "eu pensei em registrar uma ocorrencia, e
-- notificar pra mim em solicitacoes, assim como ja acontece com os reembolsos".
--
-- Nao vai em `solicitacoes_reembolso` porque nao e reembolso e nao tem
-- aprovacao pendente: o comercial ja respondeu e ja agendou. E registro para o
-- CEO conferir depois, nao autorizacao previa - misturar os dois faria a fila
-- de aprovacao mostrar coisa que nao precisa de decisao.
create table if not exists ocorrencias_pacote (
  id uuid primary key default gen_random_uuid(),
  sale_id text not null,
  -- Venda irma, quando o comercial disse que e o mesmo pacote.
  sale_irma_id text,
  paciente_nome text not null,
  produto text not null,
  -- 'mesmo_pacote' | 'compra_separada' | 'valor_divergente'
  tipo text not null check (tipo in ('mesmo_pacote', 'compra_separada', 'valor_divergente')),
  -- Quanto faltou (positivo) ou sobrou (negativo) em relacao ao preco de tabela.
  diferenca numeric,
  sessoes_do_pacote int,
  -- Respostas do comercial quando o valor nao fechou.
  paciente_paga_diferenca boolean,
  havera_outra_compra boolean,
  justificativa text,
  respondido_por_nome text not null,
  respondido_por_email text not null,
  created_at timestamptz not null default now()
);

comment on table ocorrencias_pacote is
  'Respostas do comercial no agendamento quando o sistema identificou outra compra do mesmo paciente ou valor divergente do pacote. Registro para conferencia posterior, nao aprovacao previa.';

create index if not exists idx_ocorrencias_pacote_sale on ocorrencias_pacote (sale_id);
create index if not exists idx_ocorrencias_pacote_created on ocorrencias_pacote (created_at desc);
