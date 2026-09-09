-- Lançamento manual passa a exigir aprovação do CEO.
--
-- Decisão do usuário em 09/09/2026: "toda vez que alguém for lançar um
-- agendamento manual precisa ir para aprovação. Eu aprovando, aí sim cria o
-- fluxo restante do Meet, prontuário etc. Não quero deixar o sistema aberto
-- para isso mais."
--
-- O que motivou: em 04/08 um lançamento manual duplicou uma venda real que já
-- existia (mesma paciente, mesmo produto, mesmo valor, dia seguinte), e nada
-- no sistema barrou nem avisou. Depois disso, um segundo caso criou sessão
-- marcada como "já entregue" com data no futuro, ocupando horário na agenda.
-- Lançamento manual cria venda, sessões, evento no Google e comissão sem
-- passar por nenhuma conferência - é o único caminho do sistema que faz isso.
--
-- A solicitação guarda o PAYLOAD INTEIRO. Nada é criado até a aprovação: nem
-- venda, nem sessão, nem evento no Google. Rejeitar não deixa resíduo.
create table if not exists solicitacoes_lancamento_manual (
  id uuid primary key default gen_random_uuid(),

  -- O pedido, exatamente como o comercial preencheu.
  payload jsonb not null,

  -- Cópia dos campos que a tela de aprovação precisa mostrar sem abrir o
  -- payload. Duplicados de propósito: a lista tem que ser legível numa
  -- consulta só, e o payload muda de formato quando a tela muda.
  paciente_nome text,
  paciente_email text,
  produto text,
  valor_pago_cliente numeric,
  total_sessoes integer,
  sessoes_entregues integer,
  proxima_sessao_data timestamptz,
  terapeuta_id uuid references terapeutas(id),
  terapeuta_nome text,

  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),

  solicitado_por_nome text not null,
  solicitado_por_email text not null,
  created_at timestamptz not null default now(),

  decidido_por_nome text,
  decidido_por_email text,
  decidido_em timestamptz,
  justificativa_decisao text,

  -- Os bloqueios criados para SEGURAR os horários enquanto a solicitação
  -- espera decisão. Sem eles, outra pessoa marca por cima e a aprovação falha
  -- por conflito - decisão do usuário em 09/09/2026, "pré-reserva a data e
  -- horário". São apagados na aprovação (viram sessão de verdade) e na
  -- rejeição (o horário volta a ficar livre).
  compromissos_reservados uuid[] not null default '{}',

  -- Preenchido na aprovação: o que foi efetivamente criado. Serve de trava de
  -- idempotência (aprovar duas vezes não cria dois pacotes) e de rastro.
  sale_id_criada text,
  sessoes_criadas integer
);

create index if not exists idx_solicitacoes_lanc_manual_status
  on solicitacoes_lancamento_manual (status, created_at desc);
create index if not exists idx_solicitacoes_lanc_manual_email
  on solicitacoes_lancamento_manual (paciente_email);
