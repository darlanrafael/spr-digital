# Botão "Atualizar dados" no Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao usuário um botão no Header pra forçar recarregar os dados do app (vendas, custos, fechamentos, caixa, projetos, produtos) sem precisar dar F5, com um texto mostrando a hora do último carregamento.

**Architecture:** `AppContext` passa a guardar `lastLoadedAt` (timestamp do último carregamento bem-sucedido) e expõe pro resto do app. `Header.tsx` (compartilhado por todas as telas) consome `lastLoadedAt`, `isLoading` e `reloadData` — já existentes no contexto — e renderiza um botão + texto de horário.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS v4, lucide-react (ícones).

## Global Constraints

- Botão visível em todas as telas (fica no Header compartilhado).
- Texto "Atualizado às HH:MM" ao lado do botão, formato 24h.
- Clicar chama a `reloadData()` já existente em `AppContext` — recarrega tudo para o projeto selecionado no momento.
- Durante o carregamento: botão com spinner, desabilitado (sem clique duplo).
- Se o carregamento falhar, o horário **não muda** — continua mostrando o último carregamento que funcionou de verdade.
- O carregamento inicial da página (login/F5) já conta como uma atualização — o horário aparece assim que esse carregamento inicial terminar.
- Fora de escopo: nenhuma atualização automática (foco de aba, intervalo, ou ao entrar em telas específicas), nenhuma mudança no Dashboard (`app/page.tsx`, já busca fresco sozinho), nenhum indicador de "desatualizado há X minutos".
- Sem framework de teste no projeto (sem `test` script, sem arquivos `*.test.*`) — verificação de cada task é `npm run build` + teste manual no navegador com `npm run dev`.

---

### Task 1: `lastLoadedAt` em `AppContext`

**Files:**
- Modify: `contexts/AppContext.tsx`

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `lastLoadedAt: Date | null` no valor retornado por `useApp()` — consumido pela Task 2.

- [ ] **Step 1: Adicionar `lastLoadedAt` na interface do contexto**

Em `contexts/AppContext.tsx:20-39`, a interface atual é:

```tsx
interface AppContextType {
  user: User | null
  setUser: (u: User | null) => void
  selectedProject: string
  setSelectedProject: (id: string) => void
  projects: Project[]
  products: Product[]
  sales: Sale[]
  setSales: React.Dispatch<React.SetStateAction<Sale[]>>
  costs: CostsData
  setCosts: React.Dispatch<React.SetStateAction<CostsData>>
  closings: Closing[]
  setClosings: React.Dispatch<React.SetStateAction<Closing[]>>
  cashflow: CashflowEntry[]
  setCashflow: React.Dispatch<React.SetStateAction<CashflowEntry[]>>
  isDark: boolean
  toggleTheme: () => void
  isLoading: boolean
  reloadData: (projectId?: string) => Promise<void>
}
```

Adicione `lastLoadedAt` logo depois de `isLoading`:

```tsx
interface AppContextType {
  user: User | null
  setUser: (u: User | null) => void
  selectedProject: string
  setSelectedProject: (id: string) => void
  projects: Project[]
  products: Product[]
  sales: Sale[]
  setSales: React.Dispatch<React.SetStateAction<Sale[]>>
  costs: CostsData
  setCosts: React.Dispatch<React.SetStateAction<CostsData>>
  closings: Closing[]
  setClosings: React.Dispatch<React.SetStateAction<Closing[]>>
  cashflow: CashflowEntry[]
  setCashflow: React.Dispatch<React.SetStateAction<CashflowEntry[]>>
  isDark: boolean
  toggleTheme: () => void
  isLoading: boolean
  lastLoadedAt: Date | null
  reloadData: (projectId?: string) => Promise<void>
}
```

- [ ] **Step 2: Adicionar o estado `lastLoadedAt`**

Em `contexts/AppContext.tsx:49-54`, o bloco de estado atual é:

```tsx
  const [sales, setSales] = useState<Sale[]>([])
  const [costs, setCosts] = useState<CostsData>({ fixos: [], variaveis: [], metaAds: [] })
  const [closings, setClosings] = useState<Closing[]>([])
  const [cashflow, setCashflow] = useState<CashflowEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [products, setProducts] = useState<Product[]>([])
```

Adicione logo depois:

```tsx
  const [sales, setSales] = useState<Sale[]>([])
  const [costs, setCosts] = useState<CostsData>({ fixos: [], variaveis: [], metaAds: [] })
  const [closings, setClosings] = useState<Closing[]>([])
  const [cashflow, setCashflow] = useState<CashflowEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
```

- [ ] **Step 3: Marcar o horário só quando o carregamento realmente funcionar**

Em `contexts/AppContext.tsx`, dentro de `reloadData`, o fim do bloco `try` (logo antes do `catch`) hoje é:

```tsx
      setClosings(semSupabase && cl.length === 0 ? closingsFallback as unknown as Closing[] : cl)
      setCashflow(semSupabase && cf.length === 0 ? cashflowFallback as CashflowEntry[] : cf)
    } catch (err) {
```

Adicione `setLastLoadedAt(new Date())` como a última linha do `try`, antes do `catch`:

```tsx
      setClosings(semSupabase && cl.length === 0 ? closingsFallback as unknown as Closing[] : cl)
      setCashflow(semSupabase && cf.length === 0 ? cashflowFallback as CashflowEntry[] : cf)
      setLastLoadedAt(new Date())
    } catch (err) {
```

**Importante:** não adicione `setLastLoadedAt` dentro do bloco `catch` — se o carregamento falhar, o horário deve continuar mostrando o último carregamento que funcionou de verdade (requisito do spec).

- [ ] **Step 4: Expor `lastLoadedAt` no valor do Provider**

Em `contexts/AppContext.tsx`, o valor do `AppContext.Provider` hoje é:

```tsx
      value={{
        user, setUser,
        selectedProject, setSelectedProject,
        projects, products,
        sales, setSales,
        costs, setCosts,
        closings, setClosings,
        cashflow, setCashflow,
        isDark, toggleTheme,
        isLoading, reloadData,
      }}
```

Adicione `lastLoadedAt` junto de `isLoading`:

```tsx
      value={{
        user, setUser,
        selectedProject, setSelectedProject,
        projects, products,
        sales, setSales,
        costs, setCosts,
        closings, setClosings,
        cashflow, setCashflow,
        isDark, toggleTheme,
        isLoading, lastLoadedAt, reloadData,
      }}
```

- [ ] **Step 5: Rodar build**

Run: `npm run build` (na raiz do projeto)
Expected: build passa sem erros. `lastLoadedAt` ainda não é consumido em lugar nenhum (isso é da Task 2) — não deve gerar erro, só no máximo um aviso de variável exportada não usada, o que não é o caso aqui já que é um campo de interface/contexto, não uma variável solta.

- [ ] **Step 6: Commit**

```bash
git add contexts/AppContext.tsx
git commit -m "feat: AppContext expõe lastLoadedAt (horário do último carregamento bem-sucedido)"
```

---

### Task 2: Botão + horário no Header

**Files:**
- Modify: `components/Header.tsx`

**Interfaces:**
- Consumes: `isLoading: boolean`, `lastLoadedAt: Date | null`, `reloadData: (projectId?: string) => Promise<void>` — todos de `useApp()` (Task 1).

- [ ] **Step 1: Importar o ícone `RefreshCw`**

Em `components/Header.tsx:5`, o import atual é:

```tsx
import { Sun, Moon, LogOut, ChevronDown } from 'lucide-react'
```

Troque para:

```tsx
import { Sun, Moon, LogOut, ChevronDown, RefreshCw } from 'lucide-react'
```

- [ ] **Step 2: Consumir `isLoading`, `lastLoadedAt` e `reloadData` do contexto**

Em `components/Header.tsx:31`, a linha atual é:

```tsx
  const { user, setUser, selectedProject, setSelectedProject, projects, isDark, toggleTheme } = useApp()
```

Troque para:

```tsx
  const { user, setUser, selectedProject, setSelectedProject, projects, isDark, toggleTheme, isLoading, lastLoadedAt, reloadData } = useApp()
```

- [ ] **Step 3: Calcular o texto do horário formatado**

Logo abaixo da linha `const isTerapeutas = pathname.startsWith('/terapeutas')` (`components/Header.tsx:34`), adicione:

```tsx
  const lastLoadedLabel = lastLoadedAt
    ? lastLoadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null
```

- [ ] **Step 4: Adicionar o botão + texto no Header, entre o seletor de projeto e o toggle de tema**

Em `components/Header.tsx`, o trecho atual (dentro de "Right side") é:

```tsx
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
            </div>

            {/* Theme toggle */}
```

Adicione o bloco do botão de atualizar entre o `</div>` do seletor de projeto e o comentário `{/* Theme toggle */}`:

```tsx
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
            </div>

            {/* Atualizar dados */}
            <div className="flex items-center gap-1.5">
              {lastLoadedLabel && (
                <span className="hidden sm:inline text-[10px] text-gray-500 whitespace-nowrap">
                  Atualizado às {lastLoadedLabel}
                </span>
              )}
              <button
                onClick={() => reloadData()}
                disabled={isLoading}
                title="Atualizar dados"
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Theme toggle */}
```

- [ ] **Step 5: Rodar build**

Run: `npm run build`
Expected: build passa sem erros.

- [ ] **Step 6: Testar manualmente no navegador**

Run: `npm run dev`

No navegador, faça login (`NEXT_PUBLIC_USER1_EMAIL`/`NEXT_PUBLIC_USER1_PASSWORD` em `.env.local`) e confirme, em qualquer tela (ex: `/vendas`):
- Assim que a página termina de carregar, aparece "Atualizado às HH:MM" com a hora atual, ao lado de um ícone de atualizar, à esquerda do toggle de tema.
- Clique no ícone: ele deve girar (spinner) e ficar desabilitado (cursor de "não permitido", sem resposta a novos cliques) enquanto carrega.
- Quando terminar, o horário deve atualizar para o momento em que o carregamento terminou (pode ser o mesmo minuto, mas o clique deve ter completado sem erro no console).
- Abra o DevTools (console) e confirme que não aparece nenhum erro novo relacionado a esse botão.
- Redimensione a janela pra uma largura pequena (mobile) — o texto "Atualizado às HH:MM" deve sumir (por causa do `hidden sm:inline`), mas o botão de ícone continua visível e clicável.
- Navegue entre `/vendas`, `/fechamentos`, `/dre` — o texto do horário deve continuar o mesmo em todas (é o mesmo contexto global), até você clicar em atualizar de novo.

- [ ] **Step 7: Commit**

```bash
git add components/Header.tsx
git commit -m "feat: botão \"Atualizar dados\" no Header com horário do último carregamento"
```

---

## Self-Review Notes

- **Spec coverage:** botão visível em todas as telas (Header é compartilhado, Task 2) ✓; texto "Atualizado às HH:MM" (Task 2 Step 3-4) ✓; clique chama `reloadData()` existente (Task 2 Step 4) ✓; spinner + desabilitado durante carregamento (Task 2 Step 4, usa `isLoading` já existente no contexto) ✓; horário não muda se o carregamento falhar (Task 1 Step 3, `setLastLoadedAt` só no `try`, nunca no `catch`) ✓; carregamento inicial conta como atualização (Task 1 Step 3 roda dentro do mesmo `reloadData` chamado no mount, sem lógica especial de "primeira vez") ✓; nenhuma mudança no Dashboard ou em `lib/services.ts` (nenhuma task toca esses arquivos) ✓.
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — todo step tem código completo ou comando exato.
- **Type consistency:** `lastLoadedAt: Date | null` definido na Task 1 (interface, estado, provider) e consumido idêntico na Task 2 (`lastLoadedAt.toLocaleTimeString(...)`, com guarda `lastLoadedAt ? ... : null` já tratando o caso `null`). `reloadData` e `isLoading` já existiam antes deste plano, assinatura reaproveitada sem alteração.
