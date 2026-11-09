import { log } from "../../obs/log.ts";
import type { Conn } from "../../shared/types.ts";

/**
 * Job de boot (emenda de 2026-10-05 da ADR-030): iguala `dominios_admitidos` a NOD_ADMISSAO_DOMINIOS.
 * Roda como nod_dono, na mesma conexão curta das partições; nod_app não lê nem escreve essa tabela, só
 * executa `nod_admitir_pessoa` (0052). A variável é a verdade: domínio que saiu dela sai da tabela, e
 * vazio esvazia. Tirar um domínio fecha a porta para contas novas; as pessoas já admitidas continuam.
 *
 * As pessoas novas entram no tenant único do nod (a 0001 nasceu com um). Com zero ou mais de um tenant não
 * há como escolher: a tabela fica vazia e ninguém é admitido pelo domínio (fail-closed), com aviso no log.
 */
export async function sincronizarDominiosAdmitidos(dbDono: Conn, dominios: readonly string[]): Promise<string[]> {
  const tenants = dominios.length > 0 ? await dbDono<{ id: string }[]>`select id from tenants order by id limit 2` : [];
  const tenant = tenants.length === 1 ? tenants[0] : undefined;
  if (!tenant) {
    await dbDono`delete from dominios_admitidos`;
    if (dominios.length > 0) log("aviso", "admissao_sem_tenant_unico", { tenants: tenants.length, dominios: dominios.length });
    return [];
  }
  await dbDono`delete from dominios_admitidos where dominio <> all(${[...dominios]}::text[])`;
  for (const dominio of dominios) {
    await dbDono`
      insert into dominios_admitidos (dominio, tenant_id) values (${dominio}, ${tenant.id})
      on conflict (dominio) do update set tenant_id = excluded.tenant_id where dominios_admitidos.tenant_id is distinct from excluded.tenant_id`;
  }
  log("info", "dominios_admitidos", { quantidade: dominios.length, dominios: dominios.join(",") });
  return [...dominios];
}
