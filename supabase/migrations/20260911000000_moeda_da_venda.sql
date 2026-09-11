-- Venda em moeda estrangeira: a moeda, o cambio usado e os valores originais.
--
-- Motivo (item 57 do spr-digital.md): em 05/09/2026 a primeira venda
-- internacional da Hubla entrou com tres campos em euro e um em dolar, todos
-- gravados como se fossem reais. O fechamento contou R$ 278,73 onde havia
-- USD 278,73. So foi pego porque uma trava de conferencia disparou.
--
-- `moeda` NULL significa venda em reais - o caso normal, e o comportamento de
-- todas as 10.768 vendas existentes nao muda.
--
-- Quando `moeda` esta preenchida, os QUATRO campos de dinheiro da venda estao
-- naquela moeda, nunca misturados: e o que permite converter a linha inteira
-- com um cambio so. O webhook e responsavel por garantir isso.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS moeda text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cambio_aplicado numeric;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS valores_originais jsonb;

COMMENT ON COLUMN sales.moeda IS
  'Moeda dos valores da venda quando NAO e real (ex: USD). NULL = BRL. Enquanto preenchida, a venda precisa ser convertida antes de entrar num fechamento.';
COMMENT ON COLUMN sales.cambio_aplicado IS
  'Cambio usado na conversao para reais. Preenchido junto com a limpeza de `moeda`.';
COMMENT ON COLUMN sales.valores_originais IS
  'Os valores como vieram da plataforma, antes da conversao. Auditoria: permite refazer a conta com outro cambio.';

-- So as nao convertidas precisam ser varridas, e elas sao raras.
CREATE INDEX IF NOT EXISTS idx_sales_moeda_pendente ON sales (moeda) WHERE moeda IS NOT NULL;
