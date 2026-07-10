import { User, UserRole } from '@/types'

const STORAGE_KEY = 'spr_session'

interface Credential {
  email: string
  password: string
  name: string
  role: UserRole
  projetoId?: string
}

function getCredentials(): Credential[] {
  const creds: Credential[] = [
    {
      email: process.env.NEXT_PUBLIC_USER1_EMAIL ?? 'rafael@spr.com',
      password: process.env.NEXT_PUBLIC_USER1_PASSWORD ?? 'spr2026',
      name: process.env.NEXT_PUBLIC_USER1_NAME ?? 'Rafael',
      role: (process.env.NEXT_PUBLIC_USER1_ROLE as UserRole) ?? 'admin',
    },
    {
      email: process.env.NEXT_PUBLIC_USER2_EMAIL ?? 'pedro@spr.com',
      password: process.env.NEXT_PUBLIC_USER2_PASSWORD ?? 'spr2026',
      name: process.env.NEXT_PUBLIC_USER2_NAME ?? 'Pedro Roncada',
      role: (process.env.NEXT_PUBLIC_USER2_ROLE as UserRole) ?? 'gestor',
      projetoId: 'proj_1',
    },
  ]

  // Optional third user via env vars
  const u3 = {
    email: process.env.NEXT_PUBLIC_USER3_EMAIL,
    password: process.env.NEXT_PUBLIC_USER3_PASSWORD,
    name: process.env.NEXT_PUBLIC_USER3_NAME,
    role: process.env.NEXT_PUBLIC_USER3_ROLE as UserRole,
  }
  if (u3.email && u3.password && u3.name && u3.role) {
    creds.push(u3 as Credential)
  }

  return creds
}

export function persistSession(user: User): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  }
}

export function login(email: string, password: string): User | null {
  const creds = getCredentials()
  const found = creds.find(
    c => c.email.toLowerCase() === email.toLowerCase() && c.password === password
  )
  if (!found) return null
  const user: User = {
    email: found.email,
    name: found.name,
    role: found.role,
    projetoId: found.projetoId,
  }
  persistSession(user)
  return user
}

// Usuários cadastrados via /terapeutas/admin (tabela usuarios_dashboard —
// hoje só o papel "socio", mas serve pra qualquer usuário criado ali) — login
// verificado no servidor, diferente dos usuários fixos acima.
export async function loginDashboardUser(email: string, password: string): Promise<User | null> {
  const res = await fetch('/api/dashboard-usuarios/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha: password }),
  })
  if (!res.ok) return null
  const user = await res.json() as User
  persistSession(user)
  return user
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function getSession(): User | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0]?.toUpperCase() ?? '')
    .join('')
}
