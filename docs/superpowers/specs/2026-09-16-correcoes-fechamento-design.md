# Correções na tela de Fechamento - Desenho

**Data:** 16/09/2026
**Tela:** `app/fechamentos/page.tsx` (Fechamentos > Novo Fechamento). Etapas: 1 Custos, 2 Faturamento, 3 Repasse, 4 Confirmar.

**Objetivo:** três correções pedidas pelo dono na tela de fechamento. Uma delas (câmbio) já funciona e fica só registrada como confirmada. As outras duas (busca por período; reembolsos na etapa Repasse) e a regra de rateio do reembolso de mentoria do Pedro são mudanças reais.

Restrição dura: o fechamento não pode ter margem de falha. Toda mudança que toca dinheiro (a regra 65/35) tem teste dedicado e é ancorada em DADO real, não em heurística de nome.

---

## Correção 1 - busca por nome no bloco "Produtos deste período"

**Hoje:** o bloco "Produtos incluídos" (`page.tsx:1143-1264`) tem um campo de busca com lupa (`input` em `1158-1178`), estado `buscaProduto` (`686`), que filtra a lista via `filtrarProdutos` de `lib/busca-de-produto.ts` -> `produtosVisiveis` (`687-690`), e renderiza `produtosVisiveis.map` (`1188`). Já o bloco "Períodos adicionais por produto" (`1266-1327`), na sublista "Produtos deste período" (`1303-1322`), itera `availableProducts.map` DIRETO (`1304`), sem busca.

**Mudança:** dar ao segundo bloco a mesma busca por nome, reusando `filtrarProdutos` (nada de filtro novo). Como pode haver vários períodos, **cada período tem seu próprio campo de busca** (estado por grupo/`periodosGrupos`), filtrando só a lista daquele período. Não toca em nenhum cálculo.

---

## Correção 2 - conversão de moeda estrangeira (câmbio + Converter)

**Já funciona como o dono quer. Nenhuma mudança.** Registrado como confirmado:
digitar o câmbio no campo (`input` em `page.tsx:1400-1405`, estado `cambioDaVenda`) e clicar "Converter" chama `converterVenda` (`396-420`) -> `POST /api/sales/converter-moeda`, que converte os valores para reais e grava. O resultado volta em memória (`setSales`, `411-413`) e TODOS os números do fechamento (faturamento, lucro, repasse) recalculam na hora, sem recarregar; o alerta some sozinho e o botão "Confirmar fechamento" (que fica travado enquanto houver venda não convertida, `2119`) libera.

---

## Correção 3 - reembolsos/chargebacks na etapa Repasse (mover da etapa 4 para a 3)

**Hoje:** a seção "⚠️ Reembolsos e chargebacks identificados" é renderizada na etapa 4 (Confirmar), bloco `activeStep === 4` (`page.tsx:1891-2001`). O desconto por sócio já é reativo: marcar "Abater aqui" -> `toggleAlerta` (`668-675`) -> `alertasAceitos` -> `deducoesDetalhadas`/`deducoesSocio` (`604-624`) -> `deducaoDoSocio(nome)` (`627`) e `lucroAposDeducoes` (`642`).

**Mudança:** mover essa seção para a etapa 3 (Repasse), posicionada ANTES do card "Divisão entre Sócios" (`1641-1699`). Como a reatividade já existe, marcar "abater" passa a refletir na divisão de sócios em tempo real, na mesma tela. É reorganização de UI (mover o bloco de etapa), sem mudar cálculo.

**Opção "A empresa absorve":** já existe (`empresaAbsorve`, estado `602`; quando marcada, `deducaoDoSocio`/`deducaoDosSocios` viram 0 e o `handleConfirm` lança uma saída no Caixa). É GLOBAL hoje (todos os reembolsos de uma vez, não por linha). Vem junto para a etapa 3 com a seção; mantém-se global. Granularidade por linha fica FORA do escopo (possível melhoria futura).

---

## Correção 4 - rateio do reembolso de mentoria do Pedro (regra 65/35) - o caso Miguel

**O defeito (documentado em `lib/rateio-das-deducoes.ts:5-38`):** a dedução de um reembolso usa a divisão do fechamento que PAGOU aquela venda (`divisaoOriginalDoAlerta`, `63-94`). Quando não há fechamento de origem, cai no fallback `divisaoDoFechamento` (a divisão do funil atual). O reembolso PARCIAL do Miguel Pires (Mentoria Particular - Pedro Roncada) nunca entrou em fechamento nenhum -> sem origem -> caiu no 50/50 do funil IAR, quando o certo é 65/35 (SPR absorvia R$ 234 a mais). Ordem atual em `divisaoQueVale` (`154-164`): manual > origem > fechamento.

**Verificação no dado (não em heurística):** os dois fechamentos que rodaram 65/35 em produção ("FECHAMENTO MENTORIAS - PEDRO", SPR 35 / Pedro 65) continham EXATAMENTE dois produtos, e só esses:
- `Mentoria Particular - Pedro Roncada`
- `Mentoria - Individual Pedro Roncada`

Os de grupo ("MENTORIA EM GRUPO - PEDRO RONCADA", "Mentoria em grupo- Pedro Roncada") e os da Denise ("Mentoria Individual - Denise", "Mentoria Particular - Pedro | Denise") NUNCA entraram num fechamento 65/35. Confirmação do dono: qualquer produto com "Denise" é 50/50; grupo do Pedro é 50/50.

**Mudança:** acrescentar UM degrau na ordem de prioridade, para o caso SEM origem:

  manual > origem > **[NOVO] 65/35 se o produto for mentoria individual/particular do Pedro** > 50/50 do fechamento

Só entra quando não há origem E o produto está numa lista EXPLÍCITA de nomes (não padrão "mentoria + pedro", que pegaria o grupo por engano):

```
PRODUTOS_MENTORIA_PEDRO_65_35 = [
  'Mentoria Particular - Pedro Roncada',
  'Mentoria - Individual Pedro Roncada',
]
```

Comparação por nome NORMALIZADO (minúsculas, sem acento, trim), igual `lib/busca-de-produto.ts` já faz, para não quebrar por espaço/acento. A divisão aplicada é `{ 'SPR DIGITAL LTDA': 35, 'Pedro Roncada': 65 }`. A escolha manual continua ganhando de tudo (o dono pode sobrepor).

O alerta carrega `produto` (`ClosingAlert.produto`), então a classificação usa `a.produto` no cálculo de `deducoesDetalhadas` (`604-616`).

**Por que lista explícita e não % por produto cadastrável:** o próprio `rateio-das-deducoes.ts:34-38` explica que "% por produto" cadastrável vira número velho que erra em silêncio. A lista aqui é uma exceção de segurança para o caso SEM origem (o único que erra hoje), com a origem continuando a mandar quando existe. É uma âncora no dado histórico, não um cadastro editável.

**Testes:** em `lib/rateio-das-deducoes.test.ts`, reproduzir:
- Miguel (reembolso parcial, sem origem, produto = "Mentoria Particular - Pedro Roncada") -> 65/35 (SPR 546 / Pedro 1014 para R$ 1.560), não mais 50/50.
- "Mentoria - Individual Pedro Roncada" sem origem -> 65/35.
- Um produto de GRUPO do Pedro sem origem -> continua 50/50 (não cai na regra).
- Um produto com Denise sem origem -> continua 50/50.
- COM origem (ex: os 6 do O RESGATE) -> continua seguindo a origem, a regra nova NÃO interfere.
- Escolha manual sobrepõe a regra nova.
Os testes existentes de `rateio-das-deducoes` e `alertas-reembolso-parcial` (caso Miguel) continuam passando.

---

## Não-objetivos (fora do escopo desta rodada)
- Câmbio: nenhuma mudança (já funciona).
- "Empresa absorve" por linha: fica global como está.
- Cadastro editável de "% por produto": explicitamente evitado.

## Testes e validação (todas as correções)
- `npx tsc --noEmit` limpo; `npm test` verde (com os testes novos da regra 65/35).
- A regra 65/35 é a única que decide dinheiro: prova por dado histórico (feita) + testes unitários + conferência na tela (o painel de invariantes `invariantesDoFechamento` já existe e avisa se a soma não fechar).
- UI (busca por período, mover a seção) validada rodando a tela.
