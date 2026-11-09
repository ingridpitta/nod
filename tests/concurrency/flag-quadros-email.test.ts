import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { QUADROS_PARA_TODOS } from "../../src/domain/flag-quadros.ts";
import { configurarLiberacaoQuadros, preferenciasRepo } from "../../src/repositories/raio-x.repo.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-415 (ADR-141): em `NOD_QUADROS=admins`, o admin vem de NOD_ADMINS pelo e-mail do cadastro (como em produção, onde a
 * lista é `admin1@exemplo.com`). O CI não roda seed: a pessoa com e-mail nasce como nod_dono e sai no fim — por isso
 * mora aqui, e não na integração (que nunca limpa tabela).
 */
describeIntegracao("flag NOD_QUADROS pelo e-mail do cadastro (NOD-415)", () => {
  afterEach(() => configurarLiberacaoQuadros(QUADROS_PARA_TODOS));

  it("o admin pelo e-mail (sem caixa) é liberado e lê a chave; outro e-mail não, nem com a chave gravada", async () => {
    const pessoaId = randomUUID();
    const email = `marlon.${pessoaId.slice(0, 6)}@exemplo.com`;
    await dbDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
    await dbDono`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${TENANT_PADRAO}, ${pessoaId}, 'Admin', 'AD', ${email})`;
    try {
      const escopo = { tenantId: TENANT_PADRAO, pessoaId };
      const ve = (admins: string[]) => withRollback(escopo, async (trx) => {
        configurarLiberacaoQuadros(QUADROS_PARA_TODOS);
        await preferenciasRepo(trx, escopo).gravar({ experimentos: { quadro: true } });
        configurarLiberacaoQuadros({ modo: "admins", admins });
        const p = await preferenciasRepo(trx, escopo).buscar();
        return { liberado: p.quadroLiberado, chave: p.experimentos?.quadro };
      });
      expect(await ve([` ${email.toUpperCase()} `])).toEqual({ liberado: true, chave: true });
      expect(await ve(["outra@exemplo.com"])).toEqual({ liberado: false, chave: false });
    } finally {
      await dbDono`delete from preferencias where owner_id = ${pessoaId}`;
      await dbDono`delete from pessoas where id = ${pessoaId}`;
    }
  });
});
