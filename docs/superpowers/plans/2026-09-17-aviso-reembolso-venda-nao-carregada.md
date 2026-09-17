# Aviso de reembolso com venda não carregada - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando a venda de um reembolso não está carregada no cliente (o rateio 65/35 degrada para 50/50 em silêncio), avisar na tela e travar o Confirmar até o usuário dar refresh ou digitar o % manualmente.

**Architecture:** Uma flag `vendaNaoCarregada` no `ClosingAlert`, setada em `calcularAlertasReembolsoParcial` quando a venda não é achada em `vendaPorSaleId`. A tela de fechamento usa a flag para (1) trocar a etiqueta fraca por um aviso vermelho, (2) destacar o campo de % e (3) desabilitar o botão "Confirmar fechamento" enquanto um reembolso marcado tiver a venda não carregada e nenhum % manual. Nenhum cálculo do caminho normal muda.

**Tech Stack:** TypeScript, React (Next.js), testes com `node:test` + `assert/strict` rodados por `tsx --test lib/*.test.ts`.

## Global Constraints

- O fechamento não pode ter margem de falha: NÃO alterar nenhum cálculo no caminho normal (venda carregada). A flag e a trava só entram no caminho degradado.
- `vendaNaoCarregada` só nasce no caminho do reembolso PARCIAL (`calcularAlertasReembolsoParcial`), nunca em `calcularAlertasPendentes`.
- A checagem de "% manual válido" (`pct` finito, `0 <= pct <= 100`) deve ser IDÊNTICA à que já existe em `deducoesDetalhadas` (não divergir a regra).
- Textos em português, sem travessão (usar hífen simples).
- Rodar `npx tsc --noEmit` limpo e `npm test` verde ao fim de cada task.

---

### Task 1: Flag `vendaNaoCarregada` (tipo + lib + teste)

**Files:**
- Modify: `types/index.ts` (interface `ClosingAlert`, adicionar campo)
- Modify: `lib/alertas-reembolso-parcial.ts` (função `calcularAlertasReembolsoParcial`, no `achados.push`)
- Test: `lib/alertas-reembolso-parcial.test.ts` (adicionar 2 casos)

**Interfaces:**
- Consumes: `calcularAlertasReembolsoParcial({ solicitacoes, closings, vendaPorSaleId })` já existente; `vendaPorSaleId: Map<string, VendaDoAlerta>` onde `.get(sale_id)` devolve `undefined` quando a venda não está carregada.
- Produces: `ClosingAlert.vendaNaoCarregada?: boolean` — `true` só quando a venda do reembolso parcial não foi achada em `vendaPorSaleId`. Consumido pela Task 2.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `lib/alertas-reembolso-parcial.test.ts` (o helper `sol()` usa `sale_id: 'v1'`; o map `produtos` tem `'v1'`; um `new Map()` vazio simula a venda não carregada):

```ts
test('venda NAO carregada: marca vendaNaoCarregada e produto cai no default', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol()], closings: [], vendaPorSaleId: new Map(),
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].produto, 'Reembolso parcial')
  assert.equal(a[0].vendaNaoCarregada, true)
})

test('venda carregada: vendaNaoCarregada fica falsy e produto e o real', () => {
  const a = calcularAlertasReembolsoParcial({
    solicitacoes: [sol()], closings: [], vendaPorSaleId: produtos,
  })
  assert.equal(a.length, 1)
  assert.equal(a[0].produto, 'Mentoria Particular - Pedro Roncada')
  assert.ok(!a[0].vendaNaoCarregada)
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npm test 2>&1 | grep -A3 vendaNaoCarregada`
Expected: FAIL - o primeiro caso falha em `a[0].vendaNaoCarregada === true` (hoje é `undefined`); pode também falhar de tipo se `vendaNaoCarregada` ainda não existe em `ClosingAlert`.

- [ ] **Step 3: Adicionar o campo ao tipo**

Em `types/index.ts`, dentro de `export interface ClosingAlert { ... }` (perto de `solicitacaoId`/`absorvidoPelaEmpresa`), acrescentar:

```ts
  /**
   * A venda deste reembolso nao esta na lista `sales` carregada no cliente, entao
   * o produto nao pode ser identificado e o rateio 65/35 (mentoria do Pedro)
   * degrada para o 50/50 do fechamento. Sinaliza cache de cliente velho - a FK
   * `solicitacoes_reembolso_sale_id_fkey` garante que a venda existe no banco. A
   * tela usa isto para travar o Confirmar e pedir refresh ou % manual. So nasce
   * no reembolso PARCIAL. Ver docs/superpowers/specs/2026-09-16-aviso-reembolso-venda-nao-carregada-design.md
   */
  vendaNaoCarregada?: boolean
```

- [ ] **Step 4: Setar a flag na lib**

Em `lib/alertas-reembolso-parcial.ts`, no `achados.push({ ... })` de `calcularAlertasReembolsoParcial`, logo após a linha `produto: venda?.produto ?? 'Reembolso parcial',`, acrescentar:

```ts
      // Venda nao achada em vendaPorSaleId = lista `sales` do cliente esta velha.
      // A tela trava o Confirmar e pede refresh ou % manual. So marca quando falta;
      // no caso normal o campo nem aparece (fica undefined).
      ...(venda ? {} : { vendaNaoCarregada: true }),
```

(`venda` é `vendaPorSaleId.get(s.sale_id)`, já declarado acima no loop.)

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `npm test 2>&1 | tail -20`
Expected: PASS - todos os testes de `alertas-reembolso-parcial`, incluindo os 2 novos. Os casos antigos (Miguel, pendente/rejeitado, ja abatido) continuam verdes.

- [ ] **Step 6: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts lib/alertas-reembolso-parcial.ts lib/alertas-reembolso-parcial.test.ts
git commit -m "feat: flag vendaNaoCarregada no alerta de reembolso parcial"
```

---

### Task 2: Trava do Confirmar + aviso visível (tela)

**Files:**
- Modify: `app/fechamentos/page.tsx` (predicado novo perto de `deducoesDetalhadas`; `disabled` do botão Confirmar; etiqueta e borda na tabela de alertas; banner na seção)

**Interfaces:**
- Consumes: `ClosingAlert.vendaNaoCarregada` (Task 1); `alertasSelecionados: ClosingAlert[]`; `divisaoManualDoAlerta: Record<string,string>`; `chaveAlerta(a)`; `empresaAbsorve: boolean`; a callback de render `alertas.map((a, i) => ...)` onde `a` está em escopo na coluna "Quem absorve".
- Produces: `reembolsoComVendaNaoCarregada: boolean` usado no `disabled` do botão e no banner.

- [ ] **Step 1: Adicionar o predicado da trava**

Em `app/fechamentos/page.tsx`, logo após a definição de `deducaoDosSocios`/`lucroAposDeducoes` (perto de onde `alertasSelecionados` e `divisaoManualDoAlerta` já estão em escopo), adicionar:

```ts
  // Um reembolso marcado para abater, cuja venda nao carregou, rateia num 50/50
  // chutado. Trava o fechamento ate o usuario resolver: refresh (a venda carrega
  // e volta o 65/35) ou % digitado na mao (escolha manual sobrepoe). Se a empresa
  // absorve, o split nao importa (sai do caixa), entao nao trava.
  // A validade do % repete a regra de `escolhaManual` em deducoesDetalhadas.
  const reembolsoComVendaNaoCarregada = !empresaAbsorve && alertasSelecionados.some(a => {
    if (!a.vendaNaoCarregada) return false
    const chave = chaveAlerta(a) ?? ''
    const digitado = divisaoManualDoAlerta[chave]
    const pct = digitado !== undefined && String(digitado).trim() !== ''
      ? Number(String(digitado).replace(',', '.'))
      : null
    const temManual = pct !== null && Number.isFinite(pct) && pct >= 0 && pct <= 100
    return !temManual
  })
```

- [ ] **Step 2: Travar o botão Confirmar**

Localizar o botão pelo texto `onClick={handleConfirm}` (hoje em `app/fechamentos/page.tsx:2326`). Trocar:

```tsx
disabled={periodSales.length === 0 || conferencia.naoConvertidas.length > 0}
```

por:

```tsx
disabled={periodSales.length === 0 || conferencia.naoConvertidas.length > 0 || reembolsoComVendaNaoCarregada}
```

- [ ] **Step 3: Trocar a etiqueta na coluna "Quem absorve"**

Na tabela de alertas, dentro de `alertas.map((a, i) => ...)`, localizar o `<span className="text-[9px] text-gray-600">` que hoje mostra `empresaAbsorve ? 'empresa paga' : ... : 'sem origem - confira'`. Trocar o span inteiro por:

```tsx
                                      <span className={`text-[9px] ${a.vendaNaoCarregada ? 'text-red-400 font-semibold' : 'text-gray-600'}`}>
                                        {a.vendaNaoCarregada
                                          ? 'venda nao carregada - dê refresh ou digite o %'
                                          : empresaAbsorve
                                          ? 'empresa paga'
                                          : det?.fonte === 'manual' ? 'você definiu'
                                          : det?.fonte === 'mentoria' ? 'mentoria do Pedro (65/35)'
                                          : origem ? (origem.etiqueta ?? 'fechamento de origem')
                                          : 'sem origem - confira'}
                                      </span>
```

- [ ] **Step 4: Destacar o campo de % quando a venda nao carregou**

No mesmo `alertas.map`, localizar o `<input type="text" inputMode="decimal" ...>` da coluna "Quem absorve" (o do `divisaoManualDoAlerta`). No seu `className`, trocar a borda fixa `border-white/15` por condicional:

```tsx
                                          className={`w-12 bg-gray-900 border rounded px-1 py-0.5 text-[11px] text-white text-right disabled:opacity-40 ${a.vendaNaoCarregada ? 'border-red-500' : 'border-white/15'}`}
```

- [ ] **Step 5: Banner de aviso na seção de reembolsos**

Localizar o fim da tabela de alertas - o `</table>` que fecha a tabela dentro do bloco `{alertas.length > 0 && (` da etapa Repasse (o com o cabeçalho "⚠️ Reembolsos e chargebacks identificados"). Logo APÓS o `</table>` e antes do `</div>` que fecha o `overflow-x-auto`, inserir:

```tsx
                      {reembolsoComVendaNaoCarregada && (
                        <div className="m-4 rounded-lg bg-red-500/15 border border-red-500/40 p-3">
                          <p className="text-xs font-semibold text-red-300">Venda de um reembolso nao carregada</p>
                          <p className="text-[11px] text-gray-300 mt-1">
                            O rateio automatico desse reembolso pode estar errado (caiu no 50/50 porque o produto da
                            venda nao pode ser identificado). Dê um refresh na pagina para carregar a venda, ou digite
                            o % manualmente na coluna "Quem absorve". O fechamento fica travado ate resolver.
                          </p>
                        </div>
                      )}
```

- [ ] **Step 6: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Validar rodando na tela (contra o espelho, via interceptação)**

O estado degradado NÃO pode ser produzido no banco (a FK garante a venda e a CHECK só aceita 5 status, todos carregados) - ele só vem de cache velho do cliente. Para reproduzi-lo de forma faithful, simular a dessincronia interceptando a resposta REST de `sales` no puppeteer e removendo a linha `venda-miguel-teste` (a solicitação continua carregando normal). O dev server já roda apontando pro espelho (`wxgnkcqalxxytxmvdxku`); login `darlan.rafael@yahoo.com.br` / `teste123`.

Roteiro (usar o setup puppeteer-core em `/private/tmp/claude-501/-Users-rafael/2fcadcc5-fbcb-4f3a-ae7a-3a3ca7650e88/scratchpad/e2e`):

```js
await page.setRequestInterception(true)
page.on('request', req => req.continue())
page.on('response', async () => {})               // (referência; a remoção é no fetch abaixo)
// Mais simples e robusto: interceptar via route no request e reescrever o corpo
// da resposta de /rest/v1/sales removendo a linha venda-miguel-teste. Se a versao
// do puppeteer nao reescrever corpo com facilidade, alternativa aceita: rodar o
// cenario com a venda REMOVIDA do espelho E a solicitacao RE-INSERIDA logo apos
// (a solicitacao some por CASCADE ao deletar a venda; re-inserir aponta para uma
// venda que voltou depois - ver nota). Preferir a interceptacao.
```

Asserções esperadas com a venda ausente da lista carregada:
1. A linha do Miguel aparece com a etiqueta vermelha "venda nao carregada - dê refresh ou digite o %".
2. O banner vermelho "Venda de um reembolso nao carregada" aparece após marcar "abater".
3. O botão "Confirmar fechamento" (etapa 4) fica **desabilitado** (`disabled`).
4. Digitar `35` no campo de % da linha do Miguel **remove** o banner e **reabilita** o Confirmar.
5. Com a venda presente (sem interceptação), NADA disso aparece e o split é 65/35 - já provado nesta sessão.

Registrar prints e o resultado de cada asserção. Se a interceptação de corpo não for viável no ambiente, documentar isso e validar 1-4 pela via alternativa da nota, garantindo a restauração de venda+solicitação ao fim (a FK faz CASCADE: deletar a venda apaga a solicitação; restaurar as DUAS).

- [ ] **Step 8: Commit**

```bash
git add app/fechamentos/page.tsx
git commit -m "feat: trava Confirmar e avisa quando a venda do reembolso nao carregou"
```

---

## Notas de validação

- A regra do % manual válido no predicado da trava (Step 1 da Task 2) é a MESMA de `escolhaManual` em `deducoesDetalhadas`. Se uma mudar, a outra tem que mudar junto - por isso o comentário aponta a duplicação de propósito.
- Nenhum número de rateio muda quando a venda está carregada: a flag fica `undefined`, o predicado dá `false`, e a UI condicional cai no ramo antigo.
