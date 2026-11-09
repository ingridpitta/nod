import type { Conn, Escopo } from "../shared/types.ts";

export type ConfigGithubApp = { appId: string; instalacaoId: string; chavePrivadaCifrada: string; ownerId: string };

/** GitHub App da organização (ADR-048, 0029): do TENANT, lido por todos, escrito por quem cadastrou. */
export function githubAppRepo(conn: Conn, escopo: Escopo) {
  return {
    async config(): Promise<ConfigGithubApp | null> {
      const [r] = await conn<{ app_id: string; instalacao_id: string; chave_privada_cifrada: string; owner_id: string }[]>`
        select app_id, instalacao_id, chave_privada_cifrada, owner_id from github_app_configuracoes where tenant_id = ${escopo.tenantId}`;
      return r ? { appId: r.app_id, instalacaoId: r.instalacao_id, chavePrivadaCifrada: r.chave_privada_cifrada, ownerId: r.owner_id } : null;
    },
    /** Upsert por tenant; de outra pessoa a policy de UPDATE não deixa (quem chama confere antes). */
    async salvar(c: { appId: string; instalacaoId: string; chavePrivadaCifrada: string }): Promise<void> {
      await conn`insert into github_app_configuracoes (tenant_id, owner_id, visibility, app_id, instalacao_id, chave_privada_cifrada)
        values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${c.appId}, ${c.instalacaoId}, ${c.chavePrivadaCifrada})
        on conflict (tenant_id) do update set app_id = excluded.app_id, instalacao_id = excluded.instalacao_id, chave_privada_cifrada = excluded.chave_privada_cifrada`;
    },
  };
}
