-- Migration: adiciona custo de tráfego (Meta Ads por termos livres) à tabela closings
-- Cada fechamento pode puxar o gasto de tráfego de um período e termos de
-- filtro próprios (nome da campanha contém o termo), somando ao custo total.
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_total NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_periodo_inicio DATE;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_periodo_fim DATE;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_termos TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_campanhas JSONB NOT NULL DEFAULT '[]';
