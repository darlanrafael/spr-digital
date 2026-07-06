-- Custos fixos deixam de ser um "molde sempre ativo" (coluna ativo) e passam a
-- ser lançamentos presos a um mês de referência (mesmo padrão de variable_costs,
-- que já usa a coluna `data`), permitindo custos fixos diferentes por mês e
-- corrigindo o DRE (antes usava sempre o valor "ativo" atual em todos os meses).
ALTER TABLE fixed_costs ADD COLUMN IF NOT EXISTS data DATE;

-- Linhas existentes não tinham nenhum mês associado — atribuídas ao mês atual
-- (07/2026) como ponto de partida; meses anteriores precisam ser lançados
-- manualmente se for necessário reconstruir o histórico do DRE.
UPDATE fixed_costs SET data = '2026-07-01' WHERE data IS NULL;

ALTER TABLE fixed_costs ALTER COLUMN data SET NOT NULL;
ALTER TABLE fixed_costs DROP COLUMN IF EXISTS ativo;
