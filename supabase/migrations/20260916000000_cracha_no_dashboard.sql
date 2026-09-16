-- O login do DRE passa a emitir cracha, igual ao modulo de terapeutas ja faz em
-- usuarios_sistema. Mesmas duas colunas, mesmo significado.
alter table usuarios_dashboard
  add column if not exists session_token text,
  add column if not exists session_token_expira_em timestamptz;

-- O cracha e a credencial: dois usuarios nao podem ter o mesmo. O indice e
-- parcial porque a maioria das linhas fica com NULL ate a pessoa entrar.
create unique index if not exists usuarios_dashboard_session_token_unico
  on usuarios_dashboard (session_token)
  where session_token is not null;
