-- Fechamento com múltiplos períodos por produto (funil perpétuo): guarda
-- quais produtos usaram um período diferente do período principal do
-- fechamento, para auditoria no Histórico de Fechamento.
ALTER TABLE closings ADD COLUMN IF NOT EXISTS produtos_periodos JSONB NOT NULL DEFAULT '[]';
