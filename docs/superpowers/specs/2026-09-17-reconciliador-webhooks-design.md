# Reconciliador de webhooks perdidos + alerta - Desenho

**Data:** 17/09/2026. **Arquivos:** `app/api/webhooks/hubla/route.ts`, `app/api/webhooks/kiwify/route.ts`, novos em `lib/` e `app/api/webhooks/reconciliar/`. **Toca dinheiro** (webhooks gravam vendas reais): a refatoracao dos webhooks tem que ser byte-a-byte comportamento-preservado.

## O problema (achado num levantamento de produção, 17/09/2026)

Duas vendas pagas na Hubla (COMO SER PERDOADO, R$ 297 cada - Mauricio 12/09, Guilherme 13/09) nunca entraram no sistema. Causa raiz provada no `webhook_events`: a Hubla ENVIOU o evento, o webhook TENTOU inserir, e o banco (Supabase) devolveu **"Gateway Timeout"** - o insert falhou (`resultado: insert_error`) e a venda se perdeu. Ao todo, 6 falhas de timeout na historia: 4 Kiwify (recuperadas - a Kiwify reenvia o webhook) e 2 Hubla (perdidas - a Hubla nao reenviou). **Cada falha ja fica salva em `webhook_events` com o payload completo**, entao o dado pra recuperar ja existe.

## Objetivo

Que uma venda nunca mais se perca por timeout transitorio, com **recuperacao automatica** (auto-cura) e **visibilidade** (alerta). Decisao do dono: reconciliador + alerta.

## Componentes

### 1. Refatorar: extrair "payload -> objeto de venda" (compartilhado)

Hoje cada webhook monta o objeto `sale` inline. Extrair essa montagem em funcoes puras, usadas pelo webhook E pelo reconciliador (pra a venda recuperada ser identica a que o webhook teria gravado):

- `lib/hubla-sale.ts`: `parseHublaSale(event: Record<string, unknown>): SaleInsert | null` - toda a logica que hoje monta o `const sale` no handler `invoice.payment_succeeded` (incluindo moeda internacional, offerItemId, canonicalParentId/orderId). Devolve `null` para os casos que o webhook hoje IGNORA sem inserir (fatura pai com filhos).
- `lib/kiwify-sale.ts`: `parseKiwifySale(order: Record<string, unknown>): SaleInsert` - a montagem do `const sale` do handler `order_approved`.
- Tipo `SaleInsert` compartilhado (o shape que vai pra `sales`).

**Restricao dura:** os webhooks passam a chamar essas funcoes, e a saida tem que ser IDENTICA a de hoje - a refatoracao NAO muda o que o webhook grava. Cada funcao ganha um teste que trava o shape com um payload real capturado (fixture).

### 2. Reconciliador - `app/api/webhooks/reconciliar/route.ts`

Endpoint protegido por secret de cron (mesmo padrao de `verificarSecretCron` em `lib/whatsapp-pendentes.ts`). Fluxo:

1. Le `webhook_events` onde `resultado IN ('insert_error','exception')` e `tipo_evento` de pagamento (`invoice.payment_succeeded` da Hubla, `order_approved` da Kiwify).
2. Para cada evento: reconstroi o `sale` do payload via `parseHublaSale`/`parseKiwifySale` (pela `plataforma` do log).
3. Checa se a venda ja existe em `sales` por `order_id` (o mesmo dedup do webhook). **Se ja existe** (recuperada antes, ou pelo retry da Kiwify) -> pula. **Se falta** -> insere.
4. Coleta `recuperadas[]` e `naoRecuperadas[]` (ex.: payload sem order_id, ou insert que falhou de novo).
5. Se `recuperadas.length > 0 || naoRecuperadas.length > 0` -> dispara o alerta (componente 4).
6. Devolve um resumo JSON (quantas varridas, recuperadas, ainda faltando).

**Idempotente e seguro:** so INSERE venda que falta; nunca altera venda existente; o dedup por `order_id` impede duplicar (inclusive o caso em que o timeout na verdade inseriu a linha mas a resposta estourou). Read-only em todo o resto.

**Escopo:** o reconciliador previne perdas FUTURAS e recupera vendas que estao faltando na tabela `sales`. Ele NAO edita fechamentos ja confirmados - uma venda recuperada entra no faturamento dali pra frente (igual a venda que chega depois do corte do fechamento). Consertar as 2 vendas ja perdidas dentro do fechamento `close_1789620878154` e uma operacao manual SEPARADA (fora desta spec).

### 3. Cron

Agendar o reconciliador a cada 15 min. Duas formas (escolher na implementacao conforme o que o projeto ja usa): entrada em `vercel.json` -> `crons` apontando pra `/api/webhooks/reconciliar`, OU cron externo batendo no endpoint com o secret. Como nao ha `crons` no `vercel.json` hoje e ja existe o padrao de secret de cron, usar o secret e agendar via `vercel.json` (ou documentar o cron externo se a conta Vercel nao tiver cron no plano).

### 4. Alerta - `lib/alerta-reconciliacao.ts`

`async function alertarReconciliacao(resumo): Promise<void>` - best-effort (nunca derruba o reconciliador), no mesmo molde de `notificarEncaixe`: `POST` para `process.env.N8N_RECONCILIACAO_WEBHOOK_URL` (nova env; se ausente, no-op) com o corpo `{ recuperadas: [{plataforma,cliente,produto,valor,data}], naoRecuperadas: [...] }`. O n8n monta e envia a mensagem de WhatsApp. Rodada sem nada a reportar = nenhuma chamada (sem ruido).

## Nao-objetivos
- Nao editar fechamentos confirmados (a insercao das 2 vendas atuais no fechamento e manual, a parte).
- Nao mudar o comportamento vivo dos webhooks (so extrair a montagem do `sale`, identica).
- Nao adicionar retry sincrono no webhook (o dono escolheu reconciliador+alerta; retry ficou fora).

## Testes e validacao
- `lib/hubla-sale.test.ts` e `lib/kiwify-sale.test.ts`: dado um payload real (fixture), a funcao produz o `sale` esperado (trava o shape - garante a refatoracao byte-a-byte).
- `lib/reconciliador.test.ts` (logica pura extraida): dado um conjunto de eventos falhos + um conjunto de order_ids ja existentes, decide corretamente quais inserir (os que faltam) e quais pular (os que existem).
- `npx tsc --noEmit` limpo; `npm test` verde.
- Validacao rodando: bater no endpoint do reconciliador (com o secret) contra o ESPELHO, com um `webhook_events` de insert_error semeado cuja venda nao existe -> confirma que a venda e inserida uma vez, e uma segunda chamada NAO duplica (idempotencia). NUNCA rodar o reconciliador com escrita contra producao durante o desenvolvimento.
