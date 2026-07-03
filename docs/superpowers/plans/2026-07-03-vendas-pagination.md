# Paginação nas tabelas de Vendas (Aprovadas/Reembolsos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o scroll infinito das tabelas de Aprovadas e Reembolsos em `/vendas` por paginação de 12 linhas, com botões Anterior/Próxima e "Página X de Y".

**Architecture:** Componente reutilizável `Pagination` (`components/Pagination.tsx`) consumido duas vezes dentro de `app/vendas/page.tsx` — uma vez por tabela. A paginação é só fatiamento (`.slice()`) em memória do array `filtered` que já existe e já vem ordenado do mais recente pro mais antigo; nenhuma mudança em API, `lib/services.ts` ou Supabase.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS v4. Sem framework de testes no projeto (`package.json` não tem `test` script, não existem arquivos `*.test.*`) — a verificação de cada task é `npm run build` (compila/type-checks) seguido de teste manual no navegador com `npm run dev`, no mesmo padrão já usado neste projeto.

## Global Constraints

- 12 linhas por página, em ambas as tabelas (Aprovadas e Reembolsos).
- Controles: "← Anterior", "Página X de Y", "Próxima →", abaixo de cada tabela.
- Botões desabilitados quando não há página anterior/próxima.
- Buscar ou mudar filtro (produto/data) reseta a página de **ambas** as abas para 1.
- Trocar de aba **nunca** reseta página nenhuma — cada aba guarda sua própria página independentemente.
- Sem paginação server-side, sem tamanho de página configurável, sem mudança em nenhuma outra tela.

---

### Task 1: Componente `Pagination` reutilizável

**Files:**
- Create: `components/Pagination.tsx`

**Interfaces:**
- Produces: `export default function Pagination(props: { currentPage: number; totalPages: number; onPrevious: () => void; onNext: () => void }): JSX.Element` — usado pela Task 3 e Task 4.

- [ ] **Step 1: Criar o componente**

Crie `components/Pagination.tsx` com este conteúdo:

```tsx
interface PaginationProps {
  currentPage: number
  totalPages: number
  onPrevious: () => void
  onNext: () => void
}

export default function Pagination({ currentPage, totalPages, onPrevious, onNext }: PaginationProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-xs">
      <button
        onClick={onPrevious}
        disabled={currentPage <= 1}
        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-gray-800 transition-colors"
      >
        ← Anterior
      </button>
      <span className="text-gray-500">
        Página {currentPage} de {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={currentPage >= totalPages}
        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-gray-800 transition-colors"
      >
        Próxima →
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build` (na raiz do projeto `DRE FINANCEIRO SPR DIGITAL`)
Expected: build termina com `✓ Generating static pages` e sem erros de TypeScript. O componente ainda não é usado em lugar nenhum — isso é esperado, o Next não reclama de componente exportado e não importado.

- [ ] **Step 3: Commit**

```bash
git add components/Pagination.tsx
git commit -m "feat: componente Pagination reutilizável (Anterior/Próxima + contador de página)"
```

---

### Task 2: Estado e cálculo de paginação em `VendasContent`

**Files:**
- Modify: `app/vendas/page.tsx`

**Interfaces:**
- Consumes: nada de outras tasks.
- Produces (variáveis disponíveis dentro de `VendasContent`, usadas pela Task 3 e Task 4): `PAGE_SIZE: number`, `currentPage: number`, `totalPages: number`, `paginated: Sale[]`, `goToPreviousPage(): void`, `goToNextPage(): void`.

- [ ] **Step 1: Adicionar import do `useEffect`**

Em `app/vendas/page.tsx:3`, o import atual é:

```tsx
import { useState, useMemo } from 'react'
```

Troque para:

```tsx
import { useState, useMemo, useEffect } from 'react'
```

- [ ] **Step 2: Adicionar a constante `PAGE_SIZE`**

Logo abaixo de `const WARRANTY_DAYS = 7` (linha 13), adicione:

```tsx
const PAGE_SIZE = 12
```

- [ ] **Step 3: Adicionar estado de página por aba**

Em `VendasContent` (linha 64-69), o estado atual é:

```tsx
function VendasContent() {
  const { sales, products, selectedProject } = useApp()
  const [tab, setTab] = useState<'aprovadas' | 'reembolsos'>('aprovadas')
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [filterDate, setFilterDate] = useState('')
```

Adicione logo depois de `filterDate`:

```tsx
  const [pageAprovadas, setPageAprovadas] = useState(1)
  const [pageReembolsos, setPageReembolsos] = useState(1)
```

- [ ] **Step 4: Resetar as duas páginas quando busca/filtro mudam**

Logo depois do `useMemo` de `filtered` (que termina em `}, [tab, approved, refunds, search, filterProduct, filterDate])`, na linha 93 do arquivo original, adicione:

```tsx
  useEffect(() => {
    setPageAprovadas(1)
    setPageReembolsos(1)
  }, [search, filterProduct, filterDate])
```

- [ ] **Step 5: Calcular página atual, total de páginas e fatia paginada**

Logo depois do `useEffect` do Step 4, adicione:

```tsx
  const currentPage = tab === 'aprovadas' ? pageAprovadas : pageReembolsos
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  )

  function goToPreviousPage() {
    if (tab === 'aprovadas') setPageAprovadas(p => Math.max(1, p - 1))
    else setPageReembolsos(p => Math.max(1, p - 1))
  }

  function goToNextPage() {
    if (tab === 'aprovadas') setPageAprovadas(p => Math.min(totalPages, p + 1))
    else setPageReembolsos(p => Math.min(totalPages, p + 1))
  }
```

- [ ] **Step 6: Verificar que compila**

Run: `npm run build`
Expected: build passa sem erros. `paginated`, `goToPreviousPage`, `goToNextPage` e `totalPages` ainda não são usados na renderização — isso vai gerar um aviso do ESLint de variável não usada (`paginated`, `goToPreviousPage`, `goToNextPage`), não um erro de build. Se o build falhar por causa disso (`no-unused-vars` como erro em vez de warning), tudo bem: as próximas tasks já consomem essas variáveis, então rode este build de novo só depois da Task 3 para confirmar. Não pare por causa desse aviso especificamente.

- [ ] **Step 7: Commit**

```bash
git add app/vendas/page.tsx
git commit -m "feat: estado e cálculo de paginação (12/página, reset por filtro) em VendasContent"
```

---

### Task 3: Paginação na tabela Aprovadas

**Files:**
- Modify: `app/vendas/page.tsx`

**Interfaces:**
- Consumes: `paginated`, `currentPage`, `totalPages`, `goToPreviousPage`, `goToNextPage` (Task 2); `Pagination` de `components/Pagination.tsx` (Task 1).

- [ ] **Step 1: Importar o componente `Pagination`**

Em `app/vendas/page.tsx`, junto aos outros imports de componentes (perto da linha 9-10):

```tsx
import PlatformBadge from '@/components/PlatformBadge'
import Pagination from '@/components/Pagination'
```

- [ ] **Step 2: Trocar `filtered` por `paginated` na tabela Aprovadas**

Na tabela da aba Aprovadas, o corpo hoje é (por volta da linha 204-206):

```tsx
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-600">Nenhuma venda encontrada</td></tr>
                  ) : filtered.map(sale => (
```

Troque as duas ocorrências de `filtered` por `paginated`:

```tsx
                <tbody>
                  {paginated.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-600">Nenhuma venda encontrada</td></tr>
                  ) : paginated.map(sale => (
```

- [ ] **Step 3: Adicionar o componente `Pagination` abaixo da tabela Aprovadas**

Logo depois do `</table>` de fechamento da tabela Aprovadas (dentro do mesmo bloco `tab === 'aprovadas' ? ( ... ) : ( ... )`, ainda dentro da `</table>` mas antes do parêntese que fecha esse ramo do ternário — ou seja, `<Pagination>` fica fora da `<table>` mas ainda dentro do primeiro ramo do ternário), adicione:

```tsx
              </table>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPrevious={goToPreviousPage}
                onNext={goToNextPage}
              />
            ) : (
```

(A linha `</table>` e a linha `) : (` já existem no arquivo — só adicione o bloco `<Pagination ... />` entre elas.)

- [ ] **Step 4: Rodar build**

Run: `npm run build`
Expected: build passa sem erros.

- [ ] **Step 5: Testar manualmente no navegador**

Run: `npm run dev`

No navegador, abra `http://localhost:3000/login`, entre com um usuário válido (veja `NEXT_PUBLIC_USER1_EMAIL`/`NEXT_PUBLIC_USER1_PASSWORD` em `.env.local`), vá em `/vendas`, aba Aprovadas:
- Confirme que aparecem no máximo 12 linhas.
- Confirme o texto "Página 1 de N" abaixo da tabela, com N coerente (total de vendas aprovadas ÷ 12, arredondado pra cima).
- Clique "Próxima →" e confirme que troca pra página 2 com as próximas 12 vendas (mais antigas que a página 1).
- Clique "← Anterior" e confirme que volta pra página 1 com as vendas mais recentes.
- Na página 1, confirme que "← Anterior" está desabilitado (cinza, sem clique).
- Vá até a última página e confirme que "Próxima →" fica desabilitado.
- Digite algo na busca por nome/e-mail e confirme que a paginação volta pra "Página 1 de N" com N recalculado pro resultado filtrado.

- [ ] **Step 6: Commit**

```bash
git add app/vendas/page.tsx
git commit -m "feat: paginação de 12 linhas na aba Aprovadas de /vendas"
```

---

### Task 4: Paginação na tabela Reembolsos

**Files:**
- Modify: `app/vendas/page.tsx`

**Interfaces:**
- Consumes: `paginated`, `currentPage`, `totalPages`, `goToPreviousPage`, `goToNextPage` (Task 2, já calculados dinamicamente por aba); `Pagination` (Task 1, já importado na Task 3).

- [ ] **Step 1: Trocar `filtered` por `paginated` na tabela Reembolsos**

O corpo da tabela Reembolsos hoje é (por volta da linha 238-240):

```tsx
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-600">Nenhum reembolso encontrado</td></tr>
                  ) : filtered.map(sale => (
```

Troque as duas ocorrências de `filtered` por `paginated`:

```tsx
                <tbody>
                  {paginated.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-600">Nenhum reembolso encontrado</td></tr>
                  ) : paginated.map(sale => (
```

- [ ] **Step 2: Adicionar o componente `Pagination` abaixo da tabela Reembolsos**

Logo depois do `</table>` de fechamento da tabela Reembolsos (último `</table>` do arquivo, antes do `)}` que fecha o ternário `tab === 'aprovadas' ? (...) : (...)`), adicione:

```tsx
              </table>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPrevious={goToPreviousPage}
                onNext={goToNextPage}
              />
            )}
```

(A linha `</table>` e a linha `)}` já existem — só adicione o bloco `<Pagination ... />` entre elas.)

- [ ] **Step 3: Rodar build**

Run: `npm run build`
Expected: build passa sem erros. Esse é o build que confirma que não sobrou nenhuma variável não usada da Task 2 (agora `paginated`, `currentPage`, `totalPages`, `goToPreviousPage`, `goToNextPage` são usados nas duas tabelas).

- [ ] **Step 4: Testar manualmente no navegador**

Com `npm run dev` rodando, em `/vendas`:
- Vá na aba Reembolsos, confirme no máximo 12 linhas, contador "Página X de Y" e botões funcionando (mesmo teste do Step 5 da Task 3, agora nesta aba).
- **Teste de independência entre abas:** na aba Aprovadas, avance até a página 3 (ou a última disponível, se tiver menos de 3 páginas). Troque para a aba Reembolsos — confirme que ela abre na página 1 (ou onde você deixou da última vez que mexeu nela, não necessariamente 1 se você não mexeu ainda — na primeira vez que abrir Reembolsos ela deve estar na 1). Avance a Reembolsos pra página 2. Volte pra Aprovadas — confirme que **continua na página 3**, não voltou pra 1.
- **Teste de reset por filtro:** com Aprovadas na página 2+, digite algo na busca — confirme que Aprovadas volta pra página 1. Troque pra Reembolsos — confirme que ela **também** está na página 1 (o reset por filtro afeta as duas abas, mesmo que o filtro só tenha campo visível em Aprovadas).

- [ ] **Step 5: Commit**

```bash
git add app/vendas/page.tsx
git commit -m "feat: paginação de 12 linhas na aba Reembolsos de /vendas, independente da aba Aprovadas"
```

---

## Self-Review Notes

- **Spec coverage:** 12 linhas/página (Task 2 Step 2), controles Anterior/Próxima + "Página X de Y" (Task 1), botões desabilitados nas pontas (Task 1, `disabled` com `currentPage <= 1` / `>= totalPages`), reset por busca/filtro (Task 2 Step 4), independência entre abas sem reset ao trocar (Task 2 Step 5 usa `tab` só pra escolher qual state ler/escrever, nunca reseta por causa de `tab`), abordagem client-side sem tocar API/Supabase (nenhuma task toca `lib/services.ts` ou rotas) — todos os pontos do spec têm task correspondente.
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — todo step tem código completo ou comando exato.
- **Type consistency:** `Pagination` definido na Task 1 com props `{ currentPage, totalPages, onPrevious, onNext }`; usado idêntico nas Task 3 e 4. `paginated`, `currentPage`, `totalPages`, `goToPreviousPage`, `goToNextPage` definidos uma vez na Task 2 e consumidos sem redefinição nas Task 3/4.
