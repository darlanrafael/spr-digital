-- Fechamento de comissão por terapeuta: marca sessões entregues como pagas e
-- guarda um snapshot de quais sessões/pacientes compuseram o valor pago,
-- para consulta posterior tanto pelo admin quanto pelo próprio terapeuta.
CREATE TABLE IF NOT EXISTS fechamentos_terapeutas (
  id UUID PRIMARY KEY,
  terapeuta_id UUID NOT NULL REFERENCES terapeutas(id),
  terapeuta_nome TEXT NOT NULL,
  data_confirmacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  valor_total NUMERIC NOT NULL DEFAULT 0,
  quantidade_sessoes INTEGER NOT NULL DEFAULT 0,
  sessoes JSONB NOT NULL DEFAULT '[]',
  criado_por_nome TEXT,
  criado_por_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fechamentos_terapeutas_terapeuta ON fechamentos_terapeutas(terapeuta_id);
