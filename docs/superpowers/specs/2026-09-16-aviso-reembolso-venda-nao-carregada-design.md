# Aviso de reembolso com venda não carregada - Desenho

**Data:** 16/09/2026
**Tela:** `app/fechamentos/page.tsx`, etapa 3 (Repasse) e etapa 4 (Confirmar).
**Libs:** `lib/alertas-reembolso-parcial.ts`, `types/index.ts`.

**Restrição dura:** o fechamento não pode ter margem de falha. Esta mudança NÃO
altera nenhum cálculo no caminho normal (venda carregada); só acrescenta uma
trava e um aviso no caminho degradado.

---

## O problema (causa raiz, investigada e provada em 16/09/2026)

O rateio 65/35 do reembolso de mentoria individual do Pedro (`divisaoDeMentoriaPedro`,
`lib/rateio-das-deducoes.ts`) depende do NOME do produto da venda reembolsada. Esse
nome vem de `vendaPorSaleId` (`app/fechamentos/page.tsx:554`), que é montado a partir
da lista `sales` carregada no cliente. Quando a venda do reembolso NÃO está nessa
lista, `calcularAlertasReembolsoParcial` (`lib/alertas-reembolso-parcial.ts`) cai no
default `produto: 'Reembolso parcial'`, `divisaoDeMentoriaPedro` devolve `null`, e o
split degrada para o 50/50 do fechamento **em silêncio**.

O que a investigação provou (rodando contra o espelho, não lendo):

- **Existe FK `solicitacoes_reembolso_sale_id_fkey`** (sale_id -> sales.id): uma
  solicitação de reembolso nunca aponta para venda inexistente. A venda SEMPRE
  existe no banco.
- **`getSales` (`lib/services.ts:56`) carrega TODAS as vendas** do projeto, sem
  filtro de data (chamado com `dateStart`/`dateEnd` `undefined` em
  `contexts/AppContext.tsx:73`), paginado por keyset em `id`.
- **A CHECK `sales_status_check` aceita exatamente 5 status** (`aprovada`,
  `reembolsada`, `chargeback`, `cancelada`, `em_protesto`) - os MESMOS que
  `getSales` carrega. Reembolso parcial mantém a venda em `aprovada`.

Conclusão: em qualquer carga consistente do servidor, a venda do reembolso está
SEMPRE na lista `sales`, e o 65/35 aplica corretamente. O estado degradado
(alerta aparecendo COM split 50/50) só é alcançável quando a lista `sales` do
NAVEGADOR está dessincronizada do servidor - cache velho de cliente. Foi o que
enganou o dono num teste (a venda tinha sido apagada e re-semeada no espelho e a
aba não recarregou). Não é bug de cálculo; é uma tela que engana em silêncio
quando o cliente está velho.

Handling apropriado (systematic-debugging, "When Process Reveals 'No Root Cause'",
passo 3: *implement appropriate handling / error message*): avisar e travar em vez
de mostrar 50/50 caladamente.

---

## Objetivo

Quando a tela detectar um reembolso cuja venda não está carregada:

1. **Travar** o botão "Confirmar fechamento" enquanto esse reembolso estiver sendo
   abatido sem uma decisão consciente de split.
2. **Avisar** de forma visível, com as duas saídas: dar refresh (a venda carrega e
   o 65/35 volta sozinho) OU digitar o % manualmente na coluna "Quem absorve" (que
   já existe e já sobrepõe o automático via `fonte: 'manual'`).

Não bloquear nada e não mudar cálculo no caminho normal.

---

## Detecção - flag `vendaNaoCarregada`

**`types/index.ts`, interface `ClosingAlert`:** acrescentar campo opcional:

```ts
/**
 * A venda deste reembolso não está na lista `sales` carregada no cliente, então
 * o produto não pôde ser identificado e o rateio 65/35 (mentoria do Pedro)
 * degrada para o 50/50 do fechamento. Sinaliza cache de cliente velho - a FK
 * garante que a venda existe no banco. A tela usa isto para travar o Confirmar
 * e pedir refresh ou % manual. Ver docs/.../2026-09-16-aviso-reembolso-venda-nao-carregada.
 */
vendaNaoCarregada?: boolean
```

**`lib/alertas-reembolso-parcial.ts`, `calcularAlertasReembolsoParcial`:** no
`achados.push`, além do `produto: venda?.produto ?? 'Reembolso parcial'` que já
existe, marcar a flag quando a venda não foi encontrada:

```ts
achados.push({
  // ...campos atuais...
  produto: venda?.produto ?? 'Reembolso parcial',
  ...(venda ? {} : { vendaNaoCarregada: true }),
  // ...
})
```

`venda` é `vendaPorSaleId.get(s.sale_id)`; `undefined` significa "não carregada".
A flag só nasce no caminho do reembolso parcial. `calcularAlertasPendentes` (estorno
de venda inteira) não recebe a flag - ali o produto vem do comprador do fechamento,
não de `vendaPorSaleId`.

---

## Trava do Confirmar

**`app/fechamentos/page.tsx`.** Hoje o botão (`:2326`) é:

```tsx
disabled={periodSales.length === 0 || conferencia.naoConvertidas.length > 0}
```

Acrescentar um predicado novo, calculado junto às deduções (perto de
`deducoesDetalhadas`/`alertasSelecionados`):

```ts
// Um reembolso marcado para abater, cuja venda não carregou, rateia num 50/50
// chutado. Trava o fechamento até o usuário resolver: refresh (a venda carrega)
// ou % digitado na mão (escolha manual sobrepõe). Se a empresa absorve, o split
// não importa (sai do caixa), então não trava. Ver a spec do aviso.
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

(A checagem de `pct` válido repete a mesma regra de `escolhaManual` em
`deducoesDetalhadas` - manter idêntica para não divergir.)

E o botão:

```tsx
disabled={periodSales.length === 0 || conferencia.naoConvertidas.length > 0 || reembolsoComVendaNaoCarregada}
```

Só entra em cena quando o alerta está MARCADO. Reembolso não marcado (continua
pendente para o próximo fechamento) não trava nada.

---

## Aviso visível

Na etapa 3 (Repasse), na tabela de alertas (`app/fechamentos/page.tsx`, bloco
"Reembolsos e chargebacks identificados"), quando `a.vendaNaoCarregada`:

- Na coluna "Quem absorve", trocar a etiqueta fraca `'sem origem - confira'` por
  um texto vermelho forte quando `a.vendaNaoCarregada`:
  **"Venda não carregada - dê refresh ou digite o %"**.
- Destacar o campo de % (borda vermelha) para o olho ir nele.
- Um aviso curto no topo/rodapé da seção quando houver qualquer alerta marcado
  com `vendaNaoCarregada`: **"Um reembolso está com a venda não carregada e o
  rateio pode estar errado (50/50). Dê refresh para carregar a venda, ou digite o
  % manualmente. O fechamento fica travado até resolver."**

O campo de % já é editável quando o alerta está marcado (`disabled={!marcado || empresaAbsorve}`),
então a saída manual já funciona; aqui é só sinalizar e travar.

---

## Não-objetivos

- Recarregar a venda automaticamente (opção descartada pelo dono - fica a cargo do
  refresh manual, mais simples e explícito).
- Qualquer mudança no cálculo do caminho normal (venda carregada).
- Mexer no rateio 65/35 em si (já está correto e provado).

---

## Testes e validação

- `lib/alertas-reembolso-parcial.test.ts`: caso com a venda AUSENTE de
  `vendaPorSaleId` -> alerta com `vendaNaoCarregada: true` e `produto: 'Reembolso
  parcial'`; caso com a venda presente -> `vendaNaoCarregada` ausente/falsy e
  produto correto. Os testes existentes continuam passando.
- `npx tsc --noEmit` limpo; `npm test` verde.
- Validação na tela (rodando, contra o espelho): forçar a venda não carregada
  (ex.: remover da lista carregada) e conferir que (1) aparece o aviso, (2) o
  Confirmar trava, (3) digitar o % destrava e (4) com a venda carregada nada
  disso aparece e o 65/35 segue igual.
