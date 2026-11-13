# Alíquota de imposto nova, etapa 1 - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechamento, DRE, Dashboard e Funis passam a usar a alíquota nova (3,8% até R$ 167; 8,71% acima; Funis CSP 8,71% e Imersão 3,8%), cada tela pela regra que o dono escolheu, sem mudar comissão de terapeuta, e o DRE passa a descontar o imposto do resultado.

**Architecture:** Um módulo puro `lib/aliquota-imposto.ts` concentra as duas tabelas de alíquota, a regra por venda do Fechamento (conjunto de ids da regra antiga), a regra por data do DRE/Dashboard, a alíquota exibida por linha e o formato. `lib/dre-do-mes.ts` concentra a conta corrigida do DRE. A lista de ids da regra antiga vem de uma busca própria de todos os fechamentos que lança erro. As telas só chamam essas funções.

**Tech Stack:** Next.js 16, TypeScript, Supabase JS, testes `node:test` via `tsx --test` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-13-aliquota-imposto-nova-design.md`

## Global Constraints

- Regra antiga: `preco_base <= 167` -> 3%; acima -> 12,85%. Regra nova: `<= 167` -> 3,8%; acima -> 8,71%. R$ 167 fica na faixa baixa; R$ 167,01 na alta.
- Base do imposto sempre `getImpostoBase` (maior entre `valor_com_juros` e `valor_pago_cliente`).
- Fechamento: regra antiga só para venda cujo `id` está em `compradores[].id` de fechamento SEM a marca; marca = algum item de `by_product` com `regraImposto === 'nova-2026-11'`.
- DRE e Dashboard: `data_hora.slice(0, 10) >= '2026-10-20'` -> regra nova; antes -> antiga. Não olham fechamentos.
- Funis: CSP `impostoRate: 0.0871`; Imersão `impostoRate: 0.038`.
- Comissão/repasse de terapeuta: conta igual à de hoje (regra antiga) em todo lugar; módulo dos terapeutas não é tocado.
- Acréscimo de 13,85% da Meta não muda.
- Textos de tela: português, sem travessão. Detalhe do repasse percentual: `N% sobre R$ X (imposto pela regra antiga)`.
- Sem migração de banco. Sem commit de credencial. Push/deploy só com pedido do dono. Localhost é banco de produção: não confirmar fechamento na prévia.

## Review Focus

1. Lista da regra antiga que falhou ou ainda não carregou nunca pode ser tratada como vazia: o Fechamento fica sem números e sem botão de confirmar (Task 3, teste do estado + leitura do JSX).
2. Fechamento confirmado depois da publicação por aba com código antigo (sem marca) mantém suas vendas na regra antiga (Task 1, teste de `idsDaRegraAntiga`).
3. Linha de produto com vendas em duas regras ou duas faixas mostra a alíquota efetiva, não a da primeira venda; cortesia não vira NaN (Task 1, testes de `aliquotaDaLinha`).
4. Venda com líquido maior que o bruto: taxa do DRE fica negativa e a identidade receita líquida = líquido - imposto continua (Task 4, teste).
5. Venda das 23:59 de 19/10 (BRT) fica na regra antiga no DRE; a de 00:00 de 20/10 na nova, inclusive Kiwify (Task 1, teste com `data_hora` já normalizada).

---

### Task 1: Módulo puro da alíquota

**Files:**
- Create: `lib/aliquota-imposto.ts`
- Modify: `lib/formatters.ts:59-61` (renomear `getAliquotaByPreco` para `getAliquotaRegraAntiga`, mesmo corpo), `lib/formatters.test.ts:20-35` (nome novo)
- Test: `lib/aliquota-imposto.test.ts`

**Interfaces:**
- Produces:
  - `REGRA_IMPOSTO_NOVA = 'nova-2026-11' as const`; `INICIO_REGRA_NOVA_DRE = '2026-10-20'`
  - `getAliquotaRegraAntiga(preco: number): number` (em `lib/formatters.ts`, 3 | 12.85)
  - `aliquotaRegraNova(preco: number): number` (3.8 | 8.71)
  - `fechamentoEhDaRegraNova(c: { byProduct?: { regraImposto?: string }[] }): boolean`
  - `idsDaRegraAntiga(closings: { byProduct?: { regraImposto?: string }[]; compradores?: { id?: string }[] }[]): Set<string>`
  - `aliquotaNoFechamento(venda: Pick<Sale, 'id' | 'preco_base'>, idsAntigos: ReadonlySet<string>): number`
  - `aliquotaNoDre(venda: Pick<Sale, 'data_hora' | 'preco_base'>): number`
  - `aliquotaDaLinha(itens: { base: number; aliquota: number }[]): { aliquota: number; efetiva: boolean }` (uniforme entre os itens com base > 0 -> essa alíquota, efetiva false; mais de uma -> soma(base x aliquota)/soma(base) arredondada a 2 casas, efetiva true; nenhuma base > 0 -> 0, efetiva false)
  - `formatAliquota(aliquota: number, efetiva?: boolean): string` (efetiva: sempre 2 casas com vírgula; senão até 2 casas sem zero sobrando; sufixo `%`)

- [ ] **Step 1: Write the failing tests** em `lib/aliquota-imposto.test.ts`:
  - `aliquotaRegraNova`: 166.99 -> 3.8; 167 -> 3.8; 167.01 -> 8.71; 0 -> 3.8; 5000 -> 8.71.
  - `getAliquotaRegraAntiga` (importada de `./formatters`): 167 -> 3; 167.01 -> 12.85.
  - `idsDaRegraAntiga`: fechamento sem marca com compradores `a`,`b` + fechamento com um item marcado `regraImposto: 'nova-2026-11'` e comprador `c` + fechamento sem `byProduct` com comprador `d` + comprador sem id -> `{a, b, d}` (o `c` fica de fora; aba velha sem marca entra).
  - `aliquotaNoFechamento`: id em `idsAntigos` com preço 297 -> 12.85; id fora com preço 297 -> 8.71; id fora com preço 97 -> 3.8; id em `idsAntigos` com 97 -> 3.
  - `aliquotaNoDre`: `data_hora: '2026-10-19T23:59:59'` preço 297 -> 12.85; `'2026-10-20T00:00:00'` -> 8.71; `'2026-11-05T10:00:00'` preço 97 -> 3.8; `'2026-09-01T00:00:00'` preço 97 -> 3.
  - `aliquotaDaLinha`: `[{base:100,aliquota:8.71},{base:50,aliquota:8.71}]` -> `{aliquota:8.71, efetiva:false}`; `[{base:100,aliquota:8.71},{base:100,aliquota:12.85}]` -> `{aliquota:10.78, efetiva:true}`; `[{base:200,aliquota:3.8},{base:100,aliquota:8.71}]` -> `{aliquota:5.44, efetiva:true}` (5,4366...); `[{base:0,aliquota:8.71},{base:100,aliquota:3.8}]` -> `{aliquota:3.8, efetiva:false}`; `[]` e `[{base:0,aliquota:3}]` -> `{aliquota:0, efetiva:false}`.
  - `formatAliquota`: (3) -> `'3%'`; (3.8) -> `'3,8%'`; (8.71) -> `'8,71%'`; (12.85) -> `'12,85%'`; (10.78, true) -> `'10,78%'`; (10.1, true) -> `'10,10%'`; (0) -> `'0%'`.
  - Caso de aceitação do repasse (doc do spec): venda fora dos ids, base 1000, preço 1000 -> imposto `1000 * aliquotaNoFechamento / 100` = 87.1; imposto do repasse `1000 * getAliquotaRegraAntiga(1000) / 100` = 128.5; repasse 30% de (900 - 128.5) = 231.45; sobra 900 - 87.1 - 231.45 = 581.45 (comparar com `Math.round(x*100)/100`).

- [ ] **Step 2: Run** `npx tsx --test lib/aliquota-imposto.test.ts lib/formatters.test.ts` -> FAIL (módulo e nome novo não existem).

- [ ] **Step 3: Implement** `lib/aliquota-imposto.ts` e o rename em `lib/formatters.ts`. Atualizar os 3 imports antigos (`app/page.tsx:15`, `app/dre/page.tsx:11`, `app/fechamentos/page.tsx:13`) para `getAliquotaRegraAntiga` sem mudar comportamento ainda (as Tasks 3 a 5 trocam a regra).

- [ ] **Step 4: Run** os dois arquivos de teste -> PASS; `npx tsc --noEmit` -> sem erro; `npm test` -> tudo passa.

- [ ] **Step 5: Commit** `feat(imposto): modulo da aliquota nova e regra antiga com nome proprio`.

### Task 2: Busca da lista da regra antiga

**Files:**
- Modify: `lib/services.ts` (função nova perto de `getClosings`, linha 558)
- Test: `lib/ids-da-regra-antiga.test.ts`

**Interfaces:**
- Consumes: `idsDaRegraAntiga` (Task 1).
- Produces: `buscarIdsDaRegraAntiga(client?: Pick<SupabaseClient, 'from'> | null): Promise<Set<string>>`. Sem `client` usa `getSupabaseClient()`. `client` null -> lança `Error('Banco indisponível para ler os fechamentos.')`. Lê `closings` com `select('id,by_product,compradores')`, SEM filtro de projeto, paginado por `.range(i, i+999)` até vir menos de 1000; `error` da consulta -> lança. Converte `by_product` -> `byProduct` e chama `idsDaRegraAntiga`.

- [ ] **Step 1: Write the failing tests** com um cliente falso (objeto com `from(t).select(cols).range(a,b)` devolvendo páginas): duas páginas (1000 + 1 linhas) -> ids das duas; linha com `by_product` marcado fica de fora; cliente null -> rejeita com a mensagem exata; página com `error` -> rejeita; confere que `select` recebeu `'id,by_product,compradores'` e que não houve chamada `.eq`.
- [ ] **Step 2: Run** `npx tsx --test lib/ids-da-regra-antiga.test.ts` -> FAIL.
- [ ] **Step 3: Implement** `buscarIdsDaRegraAntiga`.
- [ ] **Step 4: Run** o teste -> PASS; `npm test` -> passa.
- [ ] **Step 5: Commit** `feat(imposto): busca a lista de vendas da regra antiga em todos os fechamentos`.

### Task 3: Fechamento

**Files:**
- Modify: `app/fechamentos/page.tsx` (`byProduct` 546-640, `efectivaAliquota` 861, `handleConfirm` 860-1000, colunas de alíquota 1783 e 3136, botão confirmar ~2459), `types/index.ts:200-221`
- Test: `lib/linha-do-fechamento.test.ts`

**Interfaces:**
- Consumes: Tasks 1 e 2.
- Produces:
  - `types/index.ts` `ClosingProductRow` ganha `regraImposto?: 'nova-2026-11'` e `aliquotaEfetiva?: boolean`.
  - `lib/linha-do-fechamento.ts`: `impostoDaVendaNoFechamento(venda: Sale, idsAntigos: ReadonlySet<string>): { base: number; aliquota: number; imposto: number; impostoDoRepasse: number }` (`impostoDoRepasse` = base x `getAliquotaRegraAntiga(preco_base)` / 100).

- [ ] **Step 1: Write the failing tests** em `lib/linha-do-fechamento.test.ts`: venda fora dos ids, base 1000, preço 1000 -> `{ base: 1000, aliquota: 8.71, imposto: 87.1, impostoDoRepasse: 128.5 }`; mesma venda com id nos ids antigos -> `aliquota 12.85, imposto 128.5, impostoDoRepasse 128.5`; venda de R$ 97 fora -> `aliquota 3.8, impostoDoRepasse` com 3%.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** `lib/linha-do-fechamento.ts` e, na página:
  - Estado `idsAntigos: { estado: 'carregando' | 'pronto' | 'erro'; ids: Set<string>; erro?: string }` carregado uma vez por `buscarIdsDaRegraAntiga()`; botão "Tentar de novo" no erro.
  - Enquanto não `pronto`: o bloco de números da etapa de resultado mostra "Carregando a regra de imposto..." ou o erro em vermelho no estilo de erro da página, e "Confirmar fechamento" fica desativado; `handleConfirm` sai no início se não `pronto`.
  - `byProduct`: imposto por `impostoDaVendaNoFechamento`; linha guarda itens `{ base, aliquota }` para `aliquotaDaLinha`; `liquido_pos_impostos` com o imposto real; nova soma `base_do_repasse` (líquido - `impostoDoRepasse`) usada SÓ no repasse percentual (`row.repasse_terapeuta = row.base_do_repasse * pct/100`, com `repasse_detalhe = \`${pct}% sobre ${formatCurrency(base_do_repasse)} (imposto pela regra antiga)\``). Diagnóstico e Mentoria por sessão intactos.
  - `newClosing.byProduct[]`: `aliquota` e `aliquotaEfetiva` de `aliquotaDaLinha`, e `regraImposto: REGRA_IMPOSTO_NOVA` em cada item.
  - `handleConfirm`: `svcAddClosing` falhou -> mostra o erro na tela e `return` antes de `setClosings`, marcar custos e lançar caixa.
  - Colunas de alíquota (1783 e histórico 3136): `formatAliquota(row.aliquota, row.aliquotaEfetiva)`.
- [ ] **Step 4: Run** `npx tsx --test lib/linha-do-fechamento.test.ts`, `npx tsc --noEmit`, `npm test` -> passam. Conferir com `grep -n "getAliquotaRegraAntiga\|impostoDaVendaNoFechamento" app/fechamentos/page.tsx` que o imposto da empresa não usa mais a regra antiga direto.
- [ ] **Step 5: Commit** `feat(fechamento): aliquota nova para venda sem fechamento, repasse com a regra antiga`.

### Task 4: DRE

**Files:**
- Create: `lib/dre-do-mes.ts`
- Modify: `app/dre/page.tsx:104-134`
- Test: `lib/dre-do-mes.test.ts`

**Interfaces:**
- Consumes: `aliquotaNoDre` (Task 1).
- Produces: `receitaDoMesNoDre(vendas: Pick<Sale, 'plataforma' | 'valor_pago_cliente' | 'preco_base' | 'valor_com_juros' | 'valor_liquido' | 'data_hora'>[]): { receitaBruta: number; impostos: number; taxasPlataforma: number; receitaLiquida: number; liquidoPosImpostos: number }` com `taxasPlataforma = soma(bruto - valor_liquido)` (com sinal), `receitaLiquida = receitaBruta - impostos - taxasPlataforma`, `liquidoPosImpostos = receitaLiquida`.

- [ ] **Step 1: Write the failing tests:** duas vendas Hubla (bruto 297, líquido 280, 05/11) e (bruto 97, líquido 90, 15/10): impostos = 297 x 8,71% + 97 x 3% ; taxas = 24; receitaLiquida = 370 - impostos; `liquidoPosImpostos === receitaLiquida`; venda com líquido 110 e bruto 100 -> taxas -10 e receitaLiquida = 110 - imposto; Kiwify usa `preco_base` como bruto.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** e trocar o bloco da página por `receitaDoMesNoDre(monthSales)`; `resultado` e Fluxo seguem usando os mesmos campos (resultado = receitaLiquida - meta - fixos - variáveis - outros; `saidaImpostos = impostos`).
- [ ] **Step 4: Run** testes, `tsc`, `npm test` -> passam.
- [ ] **Step 5: Commit** `fix(dre): resultado desconta o imposto e aliquota nova a partir de 20/10`.

### Task 5: Dashboard e Funis

**Files:**
- Modify: `app/page.tsx:310-352` e coluna 605; `lib/funis/funis-config.ts:66-71,95,120,156`
- Test: `lib/funis/funis-config.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `aliquotaNoDre`, `aliquotaDaLinha`, `formatAliquota` (Task 1).

- [ ] **Step 1: Write the failing test** em `lib/funis/funis-config.test.ts`: CSP `impostoRate === 0.0871`; Imersão `=== 0.038`.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement:** taxas dos Funis e comentário (as datas e o aviso em `DATA_CORTE_FUNIS`: desligar a trava passaria vendas anteriores a 20/10 para 8,71%/3,8%); Dashboard: `impostoTotal` e `byProduct` com `aliquotaNoDre`, alíquota da linha por `aliquotaDaLinha`, coluna com `formatAliquota`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx next build` (servidor de desenvolvimento parado) -> passam.
- [ ] **Step 5: Commit** `feat(imposto): dashboard e funis com a aliquota nova`.

### Task 6: Documentação e prévia

**Files:**
- Modify: `spr-digital.md` (item 148)

- [ ] **Step 1:** Item 148: o que mudou, arquivos, regras, números de conferência do spec seção 6, como verificar.
- [ ] **Step 2: Prévia no localhost (só leitura):** DRE setembro/outubro/novembro batem com os números de conferência (a Meta muda ao vivo: conferir imposto e taxas, e o resultado só com a Meta do momento); Fechamento abre, mostra "Carregando a regra de imposto..." e depois os números; num período de outubro da Imersão a coluna mostra 3,8%; um produto com venda antiga fechada e nova mostra alíquota efetiva; NÃO confirmar fechamento.
- [ ] **Step 3: Commit** `docs: 148 aliquota nova etapa 1`.
