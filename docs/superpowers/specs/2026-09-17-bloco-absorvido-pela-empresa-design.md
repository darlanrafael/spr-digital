# Bloco consolidado "O que a empresa absorveu" - Desenho

**Data:** 17/09/2026. **Tela:** `app/fechamentos/page.tsx` - etapa 4 (Confirmar/Revisar) e o Histórico de Fechamento. **Sem mudanca de banco, sem mudanca de calculo** (o dinheiro ja esta correto; isto e so relatorio).

## O problema (achado pelo dono num fechamento REAL, close_1789618364181, 17/09/2026)

Quando a empresa absorve tanto os REEMBOLSOS quanto o PREJUIZO DO PERIODO, o relatorio mostra os dois valores separados e nunca soma:
- A etiqueta do topo do Historico (`app/fechamentos/page.tsx:2657`) soma SO os reembolsos absorvidos (`daEmpresa.reduce(...)`). No caso real: R$ 4.148,70.
- O prejuizo do periodo absorvido aparece noutro lugar (`page.tsx:2778`): R$ 1.798,85.
- O total real absorvido pela empresa e R$ 5.947,55, mas esse numero nao aparece em lugar nenhum.
- Nao existe um bloco unico detalhando TUDO que a empresa absorveu/pagou.

O dinheiro esta correto: `handleConfirm` lanca DUAS saidas no Caixa - `cfPrejuizo` (-R$ 4.148,70, reembolsos, `page.tsx:888`) e `cfPrejuizoPeriodo` (-R$ 1.798,85, prejuizo do periodo, `page.tsx:920`), somando R$ 5.947,55. So o relatorio esta incompleto e a etiqueta engana.

## Objetivo

1. **Etiqueta certa:** a etiqueta do topo do Historico passa a mostrar o TOTAL absorvido pela empresa (reembolsos + prejuizo do periodo).
2. **Bloco consolidado "O que a empresa absorveu":** um bloco unico, na etapa Revisar (etapa 4, antes de confirmar) E no Historico, listando cada reembolso absorvido (data, nome, produto, valor), o prejuizo do periodo absorvido (se houver), e o TOTAL. Retroativo: montado dos dados ja salvos, entao o fechamento ja confirmado passa a mostrar certo.

Decisao do dono (17/09/2026): o bloco aparece nos DOIS lugares (Revisar e Historico).

## Componente compartilhado

Para o mesmo bloco nao divergir entre Revisar e Historico, extrair UM componente:

```tsx
type ItemAbsorvido = { data: string; nome: string; produto: string; valor: number; tipo: string }

function BlocoAbsorvidoPelaEmpresa({
  reembolsos,      // reembolsos absorvidos pela empresa
  prejuizoPeriodo, // valor do prejuizo do periodo absorvido, ou 0
}: {
  reembolsos: ItemAbsorvido[]
  prejuizoPeriodo: number
}) {
  const totalReembolsos = reembolsos.reduce((t, r) => t + r.valor, 0)
  const total = totalReembolsos + prejuizoPeriodo
  if (total <= 0) return null   // nada absorvido -> nao renderiza
  return (
    <div className="mt-3 rounded-lg bg-purple-500/[0.07] border border-purple-500/30 p-3">
      <p className="text-xs font-semibold text-purple-300">O que a empresa absorveu (nao saiu do repasse dos socios)</p>
      <ul className="mt-2 space-y-1 text-[11px] text-gray-300">
        {reembolsos.map((r, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="text-gray-400">{r.data} · {r.nome} · {r.produto} <span className="text-gray-600">({r.tipo})</span></span>
            <span className="text-purple-300 whitespace-nowrap">{formatCurrency(r.valor)}</span>
          </li>
        ))}
        {prejuizoPeriodo > 0 && (
          <li className="flex justify-between gap-3">
            <span className="text-gray-400">Prejuizo do periodo absorvido</span>
            <span className="text-purple-300 whitespace-nowrap">{formatCurrency(prejuizoPeriodo)}</span>
          </li>
        )}
      </ul>
      <div className="mt-2 pt-2 border-t border-purple-500/20 flex justify-between text-xs font-semibold">
        <span className="text-purple-200">Total absorvido pela empresa</span>
        <span className="text-purple-200">{formatCurrency(total)}</span>
      </div>
    </div>
  )
}
```

`tipo` legivel: 'Chargeback' | 'Reembolso parcial' | 'Reembolso' (mesma traducao ja usada em `descricaoDoPrejuizoNoCaixa`/`page.tsx:898`).

## Onde usar

### Revisar (etapa 4, antes de confirmar)
Dados da tela ao vivo:
- `reembolsos` = `empresaAbsorve ? alertasSelecionados.map(a => ({ data: formatDate(a.data), nome: a.nome, produto: a.produto, valor: a.valor, tipo: <traduz a.tipo> })) : []`
- `prejuizoPeriodo` = `prejuizoAbsorvidoPeloPeriodo ? Math.abs(lucroReal) : 0`

### Historico (relatorio confirmado)
Dados do `closing` salvo:
- `reembolsos` = `closing.alertas.filter(a => a.absorvidoPelaEmpresa).map(a => ({ data: formatDate(a.data), nome: a.nome, produto: a.produto, valor: a.valor, tipo: <traduz a.tipo> }))`
- `prejuizoPeriodo` = `closing.socios?.some(s => s.empresaAbsorveuPrejuizoDoPeriodo) ? Math.abs(closing.lucroReal) : 0`

### Etiqueta do topo do Historico (`page.tsx:2646-2662`)
Hoje so mostra reembolsos e so aparece quando `daEmpresa.length > 0`. Mudar para:
- `prejuizoAbsorvido = closing.socios?.some(s => s.empresaAbsorveuPrejuizoDoPeriodo) ? Math.abs(closing.lucroReal) : 0`
- `totalAbsorvido = daEmpresa.reduce((t,a)=>t+a.valor,0) + prejuizoAbsorvido`
- A etiqueta roxa aparece quando `totalAbsorvido > 0` (nao so quando ha reembolsos), com o texto `{formatCurrency(totalAbsorvido)} absorvido pela empresa`.

## Remover a redundancia

Com o bloco consolidado no lugar, os avisos espalhados que mostram parte da mesma informacao viram redundancia confusa. Remover:
- No Historico: a linha solta "A empresa absorveu o prejuizo do periodo: R$ X" (`page.tsx:2776-2779`) - passa a estar no bloco.
- No Revisar: a nota "Reembolsos absorvidos pela empresa: R$ X" (`page.tsx:2190-2195`) e a linha "Prejuizo do periodo... absorvido pela empresa" que hoje aparece solta (`page.tsx:2179`) - viram o bloco.

A etiqueta do topo (corrigida para o total) FICA - ela e o resumo de uma linha; o bloco e o detalhe.

## Nao-objetivos
- Nenhuma mudanca de calculo, de Caixa, ou de banco. O dinheiro ja esta certo.
- Nao mexer na divisao 65/35 nem no guardrail de venda nao carregada.

## Testes e validacao
- Como e render puro derivado de dados existentes, a garantia principal e: (a) `npx tsc --noEmit` limpo; (b) validar rodando na tela contra o espelho - um fechamento com empresa absorvendo reembolsos + prejuizo do periodo deve mostrar o bloco com os itens, o prejuizo, e o total certo (= soma), nos DOIS lugares (Revisar e Historico); e a etiqueta do topo do Historico deve bater com o total.
- Se der pra extrair a soma num helper puro (`totalAbsorvidoPelaEmpresa({reembolsos, prejuizoPeriodo})`), um teste unitario simples cobre a aritmetica do total.
