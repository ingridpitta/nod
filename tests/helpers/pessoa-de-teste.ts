import { dbDono } from "./db-dono.ts";
import { idDeterministico } from "../../src/db/seed/id-deterministico.ts";
import { TENANT_PADRAO } from "./ids.ts";

/**
 * NOD-443: uma pessoa de verdade no time do TENANT_PADRAO (pessoas e tenants são identidade: só o dono escreve, fora
 * do rollback). O id sai do nome (idempotente: rodar de novo não acumula ninguém); cada arquivo usa um nome só dele.
 */
export function pessoaDeTeste(nome: string) {
  const id = idDeterministico(`pessoa:teste:${nome}`);
  return {
    id,
    nome,
    escopo: { tenantId: TENANT_PADRAO, pessoaId: id },
    async criar() {
      await dbDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${TENANT_PADRAO}, ${id}, ${nome}, 'TT') on conflict do nothing`;
    },
  };
}
