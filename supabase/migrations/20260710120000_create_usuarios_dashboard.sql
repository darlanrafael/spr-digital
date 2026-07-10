-- Usuários do dashboard principal (Dashboard, Vendas, DRE, Caixa, Fechamentos
-- da empresa, etc.) — separado de usuarios_sistema (módulo de Terapeutas) de
-- propósito: os dois têm checagens de permissão diferentes e não devem se
-- misturar (ex.: usuarios_sistema.tipo !== 'terapeuta' já libera ações
-- administrativas do módulo de terapeutas, o que não faz sentido aqui).
CREATE TABLE IF NOT EXISTS usuarios_dashboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'socio',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
