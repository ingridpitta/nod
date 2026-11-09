import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-10-22T12:00:00Z");

async function chave(trx: Tx, escopo: Escopo, nome = "vm-computador"): Promise<string> {
  const c = await criarRepos(trx, escopo).maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
  if (!c) throw new Error("chave");
  return c.id;
}

/**
 * NOD-94 (0105, emenda 11 da ADR-090): o papel da máquina e o registro da instalação por SSH. O formato da tabela e o
 * rollback de ida e volta são do tests/conformidade (rls.test.ts e rollback-ida-e-volta.test.ts).
 */
describeIntegracao("0105: máquina só computador e maquinas_ssh", () => {
  it("toda chave nasce com papel motor; o CHECK recusa papel fora da lista", async () => {
    await withRollback(MARLON, async (trx) => {
      const id = await chave(trx, MARLON);
      const [l] = await trx<{ papel: string }[]>`select papel from maquina_tokens where id = ${id}`;
      expect(l?.papel).toBe("motor");
      await expectRejected(trx, () => trx`update maquina_tokens set papel = 'servidor' where id = ${id}`, "23514");
    });
  });

  it("no máximo um só-computador vivo por pessoa; revogar libera a vaga e outra pessoa tem a sua", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await chave(trx, MARLON, "a");
      const b = await chave(trx, MARLON, "b");
      await trx`update maquina_tokens set papel = 'computador' where id = ${a}`;
      await expectRejected(trx, () => trx`update maquina_tokens set papel = 'computador' where id = ${b}`, "23505");
      await criarRepos(trx, MARLON).maquinaTokens.revogar(a, AGORA);
      await trx`update maquina_tokens set papel = 'computador' where id = ${b}`;

      await vincularEscopo(trx, ANA);
      const daAna = await chave(trx, ANA, "da-ana");
      await trx`update maquina_tokens set papel = 'computador' where id = ${daAna}`;
    });
  });

  it("registrar grava e, no mesmo host (sem caixa) e porta, atualiza em vez de duplicar", async () => {
    await withRollback(MARLON, async (trx) => {
      const r = criarRepos(trx, MARLON).maquinasSsh;
      const m1 = await chave(trx, MARLON, "m1");
      const m2 = await chave(trx, MARLON, "m2");
      const primeira = await r.registrar({ maquinaId: m1, host: "vm.exemplo.com", porta: 22, usuario: "root", impressaoHost: "SHA256:aaa" }, AGORA);
      expect(primeira).toMatchObject({ maquinaId: m1, host: "vm.exemplo.com", porta: 22, impressaoHost: "SHA256:aaa" });

      const segunda = await r.registrar({ maquinaId: m2, host: "VM.exemplo.com", porta: 22, usuario: "nod", impressaoHost: "SHA256:bbb" }, AGORA + 1000);
      expect(segunda?.id).toBe(primeira?.id);
      expect(await r.doEndereco("vm.EXEMPLO.com", 22)).toMatchObject({ maquinaId: m2, usuario: "nod", impressaoHost: "SHA256:bbb", atualizadoEm: AGORA + 1000 });
      expect(await r.doEndereco("vm.exemplo.com", 2222)).toBeNull();
      expect((await r.daMaquina(m2))?.id).toBe(primeira?.id);

      expect(await r.trocarImpressao("vm.exemplo.com", 22, "SHA256:ccc", AGORA + 2000)).toBe(true);
      expect((await r.doEndereco("vm.exemplo.com", 22))?.impressaoHost).toBe("SHA256:ccc");
      expect(await r.trocarImpressao("outra.exemplo.com", 22, "SHA256:ccc", AGORA)).toBe(false);
    });
  });

  it("CHECKs: porta fora de 1–65535 e host vazio são recusados; a máquina precisa existir", async () => {
    await withRollback(MARLON, async (trx) => {
      const r = criarRepos(trx, MARLON).maquinasSsh;
      const m = await chave(trx, MARLON);
      await expectRejected(trx, () => r.registrar({ maquinaId: m, host: "h", porta: 70000, usuario: "u", impressaoHost: "i" }, AGORA), "23514");
      await expectRejected(trx, () => r.registrar({ maquinaId: m, host: "", porta: 22, usuario: "u", impressaoHost: "i" }, AGORA), "23514");
      await expectRejected(trx, () => r.registrar({ maquinaId: randomUUID(), host: "h", porta: 22, usuario: "u", impressaoHost: "i" }, AGORA), "23503");
    });
  });

  it("RLS: outra pessoa do tenant não vê nem troca; outro tenant não vê nem insere com o tenant alheio", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await chave(trx, MARLON);
      await criarRepos(trx, MARLON).maquinasSsh.registrar({ maquinaId: m, host: "vm.exemplo.com", porta: 22, usuario: "root", impressaoHost: "SHA256:aaa" }, AGORA);

      await vincularEscopo(trx, ANA);
      const ana = criarRepos(trx, ANA).maquinasSsh;
      expect(await ana.doEndereco("vm.exemplo.com", 22)).toBeNull();
      expect(await ana.daMaquina(m)).toBeNull();
      expect(await trx`select id from maquinas_ssh`).toEqual([]);
      expect((await trx`update maquinas_ssh set impressao_host = 'SHA256:da-ana'`).count).toBe(0);

      const OUTRO_TENANT: Escopo = { tenantId: randomUUID(), pessoaId: PESSOA_MARLON };
      await vincularEscopo(trx, OUTRO_TENANT);
      expect(await trx`select id from maquinas_ssh`).toEqual([]);
      expect(await criarRepos(trx, OUTRO_TENANT).maquinasSsh.doEndereco("vm.exemplo.com", 22)).toBeNull();
      // Inserir alegando o tenant de Marlon com o escopo de outro tenant: o WITH CHECK da nod_pessoa recusa.
      await expectRejected(
        trx,
        () => trx`insert into maquinas_ssh (tenant_id, owner_id, maquina_id, host, usuario, impressao_host)
          values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${m}, 'x', 'u', 'i')`,
        "42501",
      );

      await vincularEscopo(trx, MARLON);
      expect((await criarRepos(trx, MARLON).maquinasSsh.doEndereco("vm.exemplo.com", 22))?.impressaoHost).toBe("SHA256:aaa");
    });
  });
});
