-- Migration: adiciona coluna valor_com_juros à tabela sales
-- Hubla: totalCents / 100 (valor pago com juros parcelamento)
-- Kiwify: charge_amount / 100 (já inclui juros)
-- Histórico (null): cálculo de imposto usa fallback para valor_pago_cliente
ALTER TABLE sales ADD COLUMN IF NOT EXISTS valor_com_juros NUMERIC;
