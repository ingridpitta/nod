import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sincronizarDominiosAdmitidos } from "../../../src/adapters/fundo/dominios-admitidos.ts";
import { admitirPorDominio, buscarPorEmail } from "../../../src/repositories/pessoas.repo.ts";
import { withRollbackDono } from "../../helpers/db-dono.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";

/**
 * Emenda de 2026-10-05 da ADR-030: a função do dono `nod_admitir_pessoa` (0052) e o job de boot que iguala
 * `dominios_admitidos` à variável. Tudo como nod_dono sob rollback, com domínio aleatório por execução. A prova de
 * que o POOL nod_app consegue admitir e não consegue mais nada está em tests/concurrency/admissao-por-dominio.test.ts
 * e em tests/conformidade/admissao-por-dominio.test.ts.
 */
describeIntegracao("admissão por domínio: a função do dono e a tabela de domínios", () => {
  const dominioNovo = () => `admitido-${randomUUID().slice(0, 8)}.com.br`;

  it("domínio admitido: a primeira chamada cria a pessoa no tenant do domínio; a segunda devolve a mesma", async () => {
    await withRollbackDono(async (trx) => {
      const dominio = dominioNovo();
      const email = `ana.souza@${dominio}`;
      await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await trx`insert into dominios_admitidos (dominio, tenant_id) values (${dominio}, ${TENANT_PADRAO})`;

      const primeira = await admitirPorDominio(trx, { email: `  ${email.toUpperCase()} `, nome: "Ana Souza", iniciais: "AS" });
      expect(primeira).toMatchObject({ tenantId: TENANT_PADRAO, criada: true });
      const segunda = await admitirPorDominio(trx, { email, nome: "Outro Nome", iniciais: "ON" });
      expect(segunda).toEqual({ tenantId: TENANT_PADRAO, id: primeira?.id, criada: false });

      // A pessoa criada é a que o login acha na entrada seguinte, com o e-mail em minúsculas e o primeiro nome.
      expect(await buscarPorEmail(trx, email)).toMatchObject({ id: primeira?.id, tenantId: TENANT_PADRAO, email, nome: "Ana Souza", iniciais: "AS" });
    });
  });

  it("domínio fora da tabela, subdomínio e sufixo parecido não são admitidos e não criam linha", async () => {
    await withRollbackDono(async (trx) => {
      const dominio = dominioNovo();
      await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await trx`insert into dominios_admitidos (dominio, tenant_id) values (${dominio}, ${TENANT_PADRAO})`;
      const fora = [`ana@outro-${dominio}`, `ana@sub.${dominio}`, `ana@${dominio}.evil.com`, `ana@${dominio}@outra.com`, `ana@x@${dominio}`];
      for (const email of fora) expect(await admitirPorDominio(trx, { email, nome: "Ana", iniciais: "AN" }), email).toBeNull();
      const [{ n } = { n: -1 }] = await trx<{ n: number }[]>`select count(*)::int as n from pessoas where email like ${`%${dominio}%`}`;
      expect(n).toBe(0);
    });
  });

  it("e-mail, nome ou iniciais fora da forma são recusados mesmo com o domínio admitido", async () => {
    await withRollbackDono(async (trx) => {
      const dominio = dominioNovo();
      await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await trx`insert into dominios_admitidos (dominio, tenant_id) values (${dominio}, ${TENANT_PADRAO})`;
      const ok = { email: `ana@${dominio}`, nome: "Ana", iniciais: "AN" };
      const ruins = [
        { ...ok, email: `@${dominio}` },
        { ...ok, email: `ana maria@${dominio}` },
        { ...ok, email: `${"a".repeat(260)}@${dominio}` },
        { ...ok, nome: "   " },
        { ...ok, nome: "n".repeat(81) },
        { ...ok, iniciais: "" },
        { ...ok, iniciais: "ABCD" },
      ];
      for (const r of ruins) expect(await admitirPorDominio(trx, r), JSON.stringify(r).slice(0, 60)).toBeNull();
      expect(await buscarPorEmail(trx, ok.email)).toBeNull();
    });
  });

  it("a tabela recusa domínio com caixa alta, com @ ou sem ponto", async () => {
    await withRollbackDono(async (trx) => {
      await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      for (const ruim of ["Acme.com.br", "@acme.com.br", "acme", "acme..com", "*.acme.com"]) {
        await expectRejected(trx, () => trx`insert into dominios_admitidos (dominio, tenant_id) values (${ruim}, ${TENANT_PADRAO})`, "23514");
      }
    });
  });

  it("o job de boot iguala a tabela à lista: entra o que falta, sai o que saiu, vazio esvazia", async ({ skip }) => {
    const rodou = await withRollbackDono(async (trx) => {
      await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      const [{ tenants } = { tenants: 0 }] = await trx<{ tenants: number }[]>`select count(*)::int as tenants from tenants`;
      // Um banco de teste com tenants de outras suítes não tem como exercitar este caminho: o caso fica PULADO
      // (visível no relatório), nunca verde por omissão. A regra do tenant único tem o próprio caso abaixo.
      if (tenants !== 1) return false;
      const [a, b, c] = [dominioNovo(), dominioNovo(), dominioNovo()];
      const lista = async () => (await trx<{ dominio: string; tenant_id: string }[]>`select dominio, tenant_id from dominios_admitidos order by dominio`).map((l) => l.dominio);

      expect(await sincronizarDominiosAdmitidos(trx, [a, b])).toEqual([a, b]);
      expect(await lista()).toEqual([a, b].sort());
      await sincronizarDominiosAdmitidos(trx, [b, c]);
      expect(await lista()).toEqual([b, c].sort());
      // Quem entrou enquanto o domínio estava aberto continua no cadastro depois de ele fechar.
      const admitida = await admitirPorDominio(trx, { email: `ana@${c}`, nome: "Ana", iniciais: "AN" });
      expect(await sincronizarDominiosAdmitidos(trx, [])).toEqual([]);
      expect(await lista()).toEqual([]);
      expect(await buscarPorEmail(trx, `ana@${c}`)).toMatchObject({ id: admitida?.id });
      expect(await admitirPorDominio(trx, { email: `bia@${c}`, nome: "Bia", iniciais: "BI" })).toBeNull();
      return true;
    });
    if (!rodou) skip();
  });

  it("com mais de um tenant não há como escolher: a tabela fica vazia e ninguém é admitido", async () => {
    await withRollbackDono(async (trx) => {
      const dominio = dominioNovo();
      await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await trx`insert into dominios_admitidos (dominio, tenant_id) values (${dominio}, ${TENANT_PADRAO})`;
      await trx`insert into tenants (id, nome) values (${randomUUID()}, 'Outra organização')`;

      expect(await sincronizarDominiosAdmitidos(trx, [dominio])).toEqual([]);
      const [{ n } = { n: -1 }] = await trx<{ n: number }[]>`select count(*)::int as n from dominios_admitidos`;
      expect(n).toBe(0);
      expect(await admitirPorDominio(trx, { email: `ana@${dominio}`, nome: "Ana", iniciais: "AN" })).toBeNull();
    });
  });
});
