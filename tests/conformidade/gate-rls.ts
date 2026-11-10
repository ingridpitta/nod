import type { Conn } from "../../src/shared/types.ts";

/**
 * O gate de RLS lê o CATÁLOGO (pg_class, pg_policies, pg_inherits), nunca arquivos de migração
 * (Práticas §4). Toda tabela ou cumpre a regra ou está em EXCECOES com motivo ESCRITO.
 * Vive fora do *.test.ts para o teste NEGATIVO (rls-negativo) poder chamá-lo na mesma transação
 * em que cria uma tabela desguardada.
 *
 * Partições (EMENDA 2, opção b): policy em tabela particionada vale para toda consulta pelo PAI;
 * a partição é exceção nomeada com o motivo "coberta pela policy do pai; nod_app sem GRANT direto
 * nas partições" — e o gate PROVA as duas metades: o pai passa e nod_app não tem nenhum privilégio
 * direto na partição. Partição nova criada por garantirParticoes (L7) com a forma de
 * src/db/schema/events.ts passa por esta mesma regra.
 */
export const EXCECOES: Record<string, string> = {
  schema_migrations: "controle do runner de migração; só nod_dono toca; sem tenant_id",
  tenants: "catálogo de identidade sem dado pessoal; lido para enumerar donos dos laços de fundo",
  pessoas: "catálogo de identidade sem dado pessoal; lido para enumerar donos dos laços de fundo",
  dominios_admitidos:
    "lista de domínios do login (0052), sem dado de pessoa; nod_app não tem privilégio nenhum nela (tests/conformidade/admissao-por-dominio.test.ts): só nod_dono escreve e só a função nod_admitir_pessoa lê",
  // NOD-345 (ADR-124 §1): a conta é identidade GLOBAL, acima dos tenants, e é lida ANTES de existir escopo (entrar,
  // resolver o cookie). Os privilégios exatos do nod_app em cada uma são conferidos em tests/conformidade/contas.test.ts.
  contas: "identidade global de acesso (0109, ADR-124 §1), lida antes de existir escopo; nod_app SELECT/INSERT e UPDATE (email) desde 0110",
  identidades_conta: "formas de entrar de uma conta (0109): google iss+sub e hash Argon2id; lida no login, sem escopo; DELETE do nod_app (0110) barrado na última por trigger",
  conta_pessoas: "vínculo conta → pessoa de cada tenant (0109): é ele que diz em que escopo a conta entra; nod_app só SELECT/INSERT",
  sessoes: "sessão revogável (0109, ADR-124 §4): resolvida pelo sid do cookie antes de existir escopo; nod_app sem DELETE",
  sessoes_corte: "corte dos cookies antigos sem sid (0109): consultado ao resolver o cookie, antes do escopo",
  codigos_conta: "códigos e tokens de uso único só em hash (0109): verificados antes de existir escopo (recuperar senha)",
  entradas_conta: "escolha pendente entre dois espaços (0109): liga a sessão de origem à pessoa de destino, de tenants diferentes",
  pareamentos_conta: "conectar outro computador (0109): o código é digitado num computador que ainda não está no escopo da pessoa",
  bootstrap_instalacoes: "instalação que criou um espaço provisório (0109): consultada no bootstrap público, antes do escopo",
  exclusoes_conta: "exclusão programada da conta (0110, ADR-126 §5): global como a conta; o prazo nasce no banco e o trigger só deixa o nod_app ir de programada a desfeita",
  limites_conta: "contadores de limite contra abuso (0109), por HMAC de IP/e-mail, sem dado de pessoa; desde 2026-10-25 também o gasto do dia do revisor no servidor, somando todas as contas (chave fixa revisor:gasto_microdolares, ADR-115), e desde 2026-10-26 o de cada pessoa (chave revisor_gasto:<HMAC do id>, sem id em claro)",
};

/**
 * As policies que nod_escopar_tabela cria (0004: uma PERMISSIVE por COMANDO — a perna extra e 'equipe'
 * só abrem LEITURA; INSERT/UPDATE/DELETE são da dona — mais a RESTRICTIVE do tenant). O gate confere
 * nome E comando (pg_policy.polcmd: r/a/w/d/*) no catálogo.
 */
export const POLICIES_BASE: Record<string, { permissiva: boolean; cmd: "r" | "a" | "w" | "d" | "*" }> = {
  nod_pessoa_select: { permissiva: true, cmd: "r" },
  nod_pessoa_insert: { permissiva: true, cmd: "a" },
  nod_pessoa_update: { permissiva: true, cmd: "w" },
  nod_pessoa_delete: { permissiva: true, cmd: "d" },
  nod_tenant: { permissiva: false, cmd: "*" },
  // NOD-346 (ADR-126 §6): a purga da conta. TO nod_dono e só com o GUC nod.purga_tenant (o papel e o USING são
  // conferidos em tests/conformidade/minha-conta.test.ts); sem ela em uma tabela, a purga deixaria dado para trás.
  nod_purga: { permissiva: true, cmd: "*" },
};

/**
 * Policies ALÉM das da nod_escopar_tabela, aceitas por NOME (`tabela.policy`) com motivo
 * escrito. Qualquer outra policy no catálogo é acusada: uma policy nova é superfície de acesso
 * nova e precisa passar por aqui. definido em 2026-09-16 (0003).
 */
export const POLICIES_EXTRAS: Record<string, string> = {
  "decisoes.nod_decisora":
    "PERMISSIVE só FOR UPDATE (INSERT/DELETE inalterados), USING e WITH CHECK pela perna decisor_id. A policy concede UPDATE de QUALQUER coluna; o trigger nod_decisao_pernas_imutaveis (BEFORE UPDATE, P0001) fecha a lista para quem não é a dona: estado, desfecho, decidida_em, decidida_por, vista_em — e prazo_decisao_em só na transição vencida→reaberta",
  "itens_aprovacao.nod_decisora":
    "PERMISSIVE só FOR UPDATE, USING e WITH CHECK por EXISTS na decisão (decisor_id). Mesma ressalva: o trigger nod_item_aprovacao_pernas_imutaveis fecha a lista para quem não é a dona: selecionado, marcado_por, marcado_em, texto_final, editado_por",
  "composio_configuracoes.nod_equipe_update":
    "PERMISSIVE só FOR UPDATE (INSERT/DELETE continuam da dona), USING e WITH CHECK pela perna do tenant: ADR-041 põe a chave Composio no tenant e qualquer pessoa a troca, senão quem cadastrou é a única que troca. A policy concede UPDATE de QUALQUER coluna; o trigger nod_composio_pernas_imutaveis (BEFORE UPDATE, P0001) fecha a lista para quem não é a dona: só chave_cifrada",
  "agente_perfil_versoes.nod_poda_versoes":
    "NOD-20 (0132): a poda das 50 últimas versões do perfil. TO nod_dono e só com os GUCs nod.poda_versoes_tenant/agente, que só a função SECURITY DEFINER nod_podar_versoes_perfil liga (e desliga) dentro dela, presa ao tenant e à pessoa do escopo vinculado; nod_app segue sem UPDATE/DELETE na tabela (tests/integration/perfil-versoes.test.ts)",
  "relatos.nod_triagem_leitura":
    "Triagem diária dos relatos (0159): SELECT de todos os tenants, TO nod_dono e só com o GUC nod.triagem ('ler' ou 'marcar'), que só as funções triagem_relatos/triagem_relato/triagem_marcar (SECURITY INVOKER) ligam por set_config local e desligam antes de sair; nod_app sem EXECUTE nelas, e mesmo com EXECUTE rodaria sob as próprias policies (tests/integration/triagem-relatos.test.ts)",
  "relato_prosa.nod_triagem_leitura":
    "Triagem diária dos relatos (0159): SELECT da prosa de todos os tenants, TO nod_dono e só com nod.triagem = 'ler' (triagem_relatos/triagem_relato); sem UPDATE, INSERT nem DELETE",
  "relatos.nod_triagem_marcar":
    "Triagem diária dos relatos (0159): UPDATE TO nod_dono só com nod.triagem = 'marcar' (triagem_marcar). A policy concede qualquer coluna; o trigger nod_triagem_so_rastreio (BEFORE UPDATE, 42501) fecha a lista em estado, tarefa_ref e triado_em. Sem policy de INSERT/DELETE",
};

export interface Tabela {
  nome: string;
  particao: boolean;
  pai: string | null;
  rls: boolean;
  force: boolean;
  temTenantId: boolean;
  /** As quatro PERMISSIVE por comando da 0004 presentes com o comando certo. */
  permissiva: boolean;
  /** A RESTRICTIVE nod_tenant FOR ALL presente. */
  restritiva: boolean;
  /** As policies base que FALTAM ou estão com o comando errado (vazio = ok). */
  baseFaltando: string[];
  /** Nomes de policy fora de POLICIES_BASE: só passam se estiverem em POLICIES_EXTRAS. */
  policiesExtras: string[];
  privilegiosApp: string[];
}

export async function lerTabelas(conn: Conn): Promise<Tabela[]> {
  /* eslint-disable no-restricted-syntax -- a palavra aparece como NOME de privilégio consultado, não como comando */
  const linhas = await conn<
    {
      nome: string;
      particao: boolean;
      pai: string | null;
      rls: boolean;
      force: boolean;
      tem_tenant_id: boolean;
      policies: { nome: string; permissiva: boolean; cmd: string }[];
      privilegios: string[];
    }[]
  >`
    select c.relname as nome,
           c.relispartition as particao,
           (select p.relname from pg_inherits i join pg_class p on p.oid = i.inhparent where i.inhrelid = c.oid limit 1) as pai,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as force,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tem_tenant_id,
           coalesce((select json_agg(json_build_object('nome', p.polname, 'permissiva', p.polpermissive, 'cmd', p.polcmd) order by p.polname)
                     from pg_policy p where p.polrelid = c.oid), '[]'::json) as policies,
           array(select priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) priv
                 where has_table_privilege('nod_app', c.oid, priv)) as privilegios
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and (n.nspname = 'public' or n.oid = pg_my_temp_schema())
    order by c.relname`;
  /* eslint-enable no-restricted-syntax */
  return linhas.map((l) => {
    const baseFaltando = Object.entries(POLICIES_BASE)
      .filter(([nome, esperado]) => !l.policies.some((p) => p.nome === nome && p.permissiva === esperado.permissiva && p.cmd === esperado.cmd))
      .map(([nome]) => nome);
    return {
      nome: l.nome,
      particao: l.particao,
      pai: l.pai,
      rls: l.rls,
      force: l.force,
      temTenantId: l.tem_tenant_id,
      permissiva: !baseFaltando.some((n) => n.startsWith("nod_pessoa_")),
      restritiva: !baseFaltando.includes("nod_tenant"),
      baseFaltando,
      policiesExtras: l.policies.map((p) => p.nome).filter((n) => !Object.hasOwn(POLICIES_BASE, n)),
      privilegiosApp: l.privilegios,
    };
  });
}

/** Devolve a lista de violações (vazia = gate verde). Uma string por tabela, legível no CI. */
export function avaliar(tabelas: Tabela[]): string[] {
  const porNome = new Map(tabelas.map((t) => [t.nome, t]));
  const violacoes: string[] = [];
  for (const t of tabelas) {
    if (EXCECOES[t.nome]) continue;
    if (t.particao) {
      const pai = t.pai ? porNome.get(t.pai) : undefined;
      if (!pai) violacoes.push(`${t.nome}: partição sem pai visível`);
      else if (!(pai.rls && pai.force && pai.permissiva && pai.restritiva)) violacoes.push(`${t.nome}: o pai ${pai.nome} não está escopado`);
      if (t.privilegiosApp.length > 0) violacoes.push(`${t.nome}: nod_app tem GRANT direto na partição (${t.privilegiosApp.join(",")}) — a policy do pai não cobre acesso direto`);
      continue;
    }
    if (!t.temTenantId) violacoes.push(`${t.nome}: sem coluna tenant_id e sem exceção escrita`);
    if (!t.rls) violacoes.push(`${t.nome}: sem ENABLE ROW LEVEL SECURITY`);
    if (!t.force) violacoes.push(`${t.nome}: sem FORCE ROW LEVEL SECURITY`);
    for (const nome of t.baseFaltando) {
      const b = POLICIES_BASE[nome];
      violacoes.push(`${t.nome}: sem policy ${b?.permissiva ? "PERMISSIVE" : "RESTRICTIVE"} ${nome}${b && b.cmd !== "*" ? ` (FOR ${{ r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE" }[b.cmd]})` : ""}`);
    }
    for (const p of t.policiesExtras) {
      if (!POLICIES_EXTRAS[`${t.nome}.${p}`]) violacoes.push(`${t.nome}: policy ${p} fora da lista aceita (POLICIES_EXTRAS) — superfície de acesso sem motivo escrito`);
    }
  }
  return violacoes;
}
