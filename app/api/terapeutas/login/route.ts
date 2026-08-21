import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashSenha, gerarSessionToken } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  try {
    const { email, senha } = await req.json() as { email: string; senha: string }
    if (!email || !senha) {
      return NextResponse.json({ error: 'Email e senha obrigatórios' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const hash = hashSenha(senha)

    // `select('*')` em vez de listar as colunas: se este código subir antes
    // da migration das colunas de sessão, uma lista explícita com
    // `dispensa_senha_nas_acoes` faria o PostgREST rejeitar a query inteira
    // e o login pararia pra todo mundo. Com `*`, a coluna simplesmente não
    // vem, a flag cai pro default `false` e o comportamento é o de antes.
    const { data } = await supabase
      .from('usuarios_sistema')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('senha_hash', hash)
      .eq('ativo', true)
      .single()

    if (!data) {
      return NextResponse.json({ error: 'Email ou senha inválidos' }, { status: 401 })
    }

    const row = data as {
      id: string; nome: string; email: string; tipo: string
      terapeuta_id: string | null; ativo: boolean
      dispensa_senha_nas_acoes: boolean | null
    }

    // Reaproveita o token que já existe se ainda estiver válido, em vez de
    // gerar um novo a cada login.
    //
    // Gerar sempre um novo invalidava o anterior: quem entrasse no celular
    // derrubava o próprio acesso no computador, sem nenhum aviso — voltaria
    // a pedir senha só naquele aparelho, e a causa seria invisível. Um crachá
    // por pessoa, servindo os aparelhos dela, é o que corresponde ao combinado.
    const tokenAtual = (row as unknown as { session_token: string | null; session_token_expira_em: string | null })
    const aindaValido = !!tokenAtual.session_token && !!tokenAtual.session_token_expira_em
      && new Date(tokenAtual.session_token_expira_em).getTime() > Date.now()

    const { token, expiraEm } = aindaValido
      ? { token: tokenAtual.session_token as string, expiraEm: tokenAtual.session_token_expira_em as string }
      : gerarSessionToken()

    const { error: erroToken } = await supabase
      .from('usuarios_sistema')
      .update({ session_token: token, session_token_expira_em: expiraEm })
      .eq('id', row.id)
    // Sem a migration aplicada este update falha. Não é motivo pra derrubar
    // o login: sem token persistido, nenhuma ação vai ser autorizada por
    // token e todas voltam a pedir senha — o comportamento de antes.
    if (erroToken) console.error('[terapeutas/login] token não persistido:', erroToken.message)

    return NextResponse.json({
      success: true,
      usuario: {
        id: row.id,
        nome: row.nome,
        email: row.email,
        tipo: row.tipo,
        terapeuta_id: row.terapeuta_id,
        token,
        dispensa_senha_nas_acoes: row.dispensa_senha_nas_acoes ?? false,
      },
    })
  } catch (err) {
    console.error('[terapeutas/login POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
