-- Custos específicos de um funil perpétuo, lançados manualmente dentro do
-- próprio fechamento (mesmo padrão do custo de tráfego): não misturam com
-- os Custos Fixos/Variáveis gerais da empresa.
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_funil_total NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_funil_itens JSONB NOT NULL DEFAULT '[]';
