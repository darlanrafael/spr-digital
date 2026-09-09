-- Trocar quem e o paciente de um prontuario passa a exigir aprovacao do CEO.
--
-- Decisao do usuario em 09/09/2026: "sobre editar o prontuario pode deixar..
-- desde que ele registre uma ocorrencia e detalhe ao maximo.. apos isso, deve
-- ir para aprovacao para mim".
--
-- E a acao que, em 04/08/2026, sobrescreveu uma paciente inteira pela outra -
-- nome, e-mail e telefone de uma vez. So foi possivel reconstruir aquele caso
-- porque as sessoes ainda guardavam o nome antigo, por causa de OUTRO defeito
-- (corrigido em d238ef5). Sem aquele defeito, nao haveria rastro nenhum.
--
-- ENQUANTO ESPERA, OS DADOS ANTIGOS FICAM. Nada e alterado ate a aprovacao -
-- escolha explicita do usuario ("espera sua aprovacao pra valer"). O custo
-- aceito: o terapeuta pode atender vendo o nome antigo nesse intervalo.
--
-- Corrigir TELEFONE ou acento no nome nao passa por aqui: so a troca de
-- identidade (nome ou e-mail).
create table if not exists solicitacoes_edicao_paciente (
  id uuid primary key default gen_random_uuid(),

  sale_id text not null,

  -- Como esta hoje. Copiado no momento do pedido para a tela de aprovacao
  -- mostrar o antes e o depois sem depender de o dado nao ter mudado.
  nome_atual text,
  email_atual text,
  telefone_atual text,

  -- Como vai ficar.
  nome_novo text not null,
  email_novo text not null,
  telefone_novo text,

  -- Contexto da COMPRA, para o CEO decidir sem abrir outra tela: e o que
  -- distingue "a esposa comprou para o marido" de "sobrescreveu a venda errada".
  produto text,
  plataforma text,
  valor_pago_cliente numeric,
  data_compra timestamptz,

  -- Obrigatoria. Vira o corpo da ocorrencia de prontuario na aprovacao.
  motivo text not null,

  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),

  solicitado_por_nome text not null,
  solicitado_por_email text not null,
  created_at timestamptz not null default now(),

  decidido_por_nome text,
  decidido_por_email text,
  decidido_em timestamptz,
  justificativa_decisao text,

  -- Preenchido na aprovacao: quantas sessoes receberam o nome novo. Trava de
  -- idempotencia e rastro.
  sessoes_atualizadas integer
);

create index if not exists idx_solicitacoes_edicao_status
  on solicitacoes_edicao_paciente (status, created_at desc);
create index if not exists idx_solicitacoes_edicao_sale
  on solicitacoes_edicao_paciente (sale_id);
