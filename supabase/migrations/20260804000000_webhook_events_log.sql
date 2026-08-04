-- supabase/migrations/20260804000000_webhook_events_log.sql
-- Auditoria permanente de todo webhook recebido de Hubla/Kiwify — hoje só
-- existe console.log (expira nos logs da Vercel), então uma vez que um
-- evento é processado como "duplicata" ou "ignorado" não há mais como saber
-- depois se aquilo foi correto ou uma venda real jogada fora silenciosamente.
create table if not exists webhook_events (
  id          uuid        primary key default gen_random_uuid(),
  plataforma  text        not null check (plataforma in ('hubla', 'kiwify')),
  tipo_evento text        not null,
  resultado   text        not null,
  sale_id     text,
  detalhe     text,
  payload     jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_webhook_events_plataforma_created on webhook_events(plataforma, created_at);
create index if not exists idx_webhook_events_resultado on webhook_events(resultado);
