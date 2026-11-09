import type { Conn, Escopo } from "../shared/types.ts";

export type SessaoComposio = { toolkit: string; sessaoId: string; contaId: string; conectorId: string };

export function composioRepo(conn: Conn, escopo: Escopo) {
  return {
    /** ADR-041: a chave é do TENANT — quem configurou não importa para ler. */
    async chave(): Promise<string | null> {
      const [r] = await conn<{ chave_cifrada: string }[]>`select chave_cifrada from composio_configuracoes where tenant_id = ${escopo.tenantId}`;
      return r?.chave_cifrada ?? null;
    },
    /** O conflito é por tenant: a segunda pessoa TROCA a chave do time (nod_equipe_update), não cria a sua. */
    async salvarChave(cifrada: string): Promise<void> {
      await conn`insert into composio_configuracoes (tenant_id, owner_id, visibility, chave_cifrada) values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${cifrada})
        on conflict (tenant_id) do update set chave_cifrada = excluded.chave_cifrada`;
    },
    /** NOD-50: grava só se o time ainda não tem chave (o cartão do bot não troca a que existe); false = já havia. */
    async salvarChaveSeAusente(cifrada: string): Promise<boolean> {
      const r = await conn`insert into composio_configuracoes (tenant_id, owner_id, visibility, chave_cifrada) values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${cifrada})
        on conflict (tenant_id) do nothing`;
      return r.count === 1;
    },
    async sessao(toolkit: string): Promise<SessaoComposio | null> {
      const [r] = await conn<{ toolkit: string; sessao_id: string; conta_id: string; conector_id: string }[]>`select toolkit, sessao_id, conta_id, conector_id from composio_sessoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and toolkit = ${toolkit}`;
      return r ? { toolkit: r.toolkit, sessaoId: r.sessao_id, contaId: r.conta_id, conectorId: r.conector_id } : null;
    },
    async salvarSessao(s: SessaoComposio): Promise<void> {
      await conn`insert into composio_sessoes (tenant_id, owner_id, toolkit, sessao_id, conta_id, conector_id) values (${escopo.tenantId}, ${escopo.pessoaId}, ${s.toolkit}, ${s.sessaoId}, ${s.contaId}, ${s.conectorId})
        on conflict (tenant_id, owner_id, toolkit) do update set sessao_id = excluded.sessao_id, conta_id = excluded.conta_id, conector_id = excluded.conector_id`;
    },
  };
}
