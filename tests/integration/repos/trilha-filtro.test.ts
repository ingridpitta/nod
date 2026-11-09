import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarRepos } from "../../../src/repositories/index.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("trilhaRepo: registrar sem texto livre e filtrar por dia/agente/conector (E8.4)", () => {
  it("filtra por dia no fuso pedido, por agente e por conector; texto livre cai no CHECK", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const agenteA = randomUUID();
      const agenteB = randomUUID();
      const conector = randomUUID();
      const dia16 = Date.UTC(2026, 8, 16, 12, 0, 0);
      const dia17 = Date.UTC(2026, 8, 17, 1, 0, 0); // 22h do dia 16 em São Paulo

      const l1 = await repos.trilha.registrar({ agenteId: agenteA, conectorId: conector, ferramenta: "exemplo__listar_contatos", kind: "tool_call", regra: "regra:concessao", regraVersao: 1, em: dia16 });
      const l2 = await repos.trilha.registrar({ agenteId: agenteA, ferramenta: "lembrar", kind: "tool_call", regra: "regra:montagem_ferramentas", regraVersao: 1, em: dia16 + 1_000 });
      const l3 = await repos.trilha.registrar({ agenteId: agenteB, conectorId: conector, ferramenta: "exemplo__enviar_email", kind: "negacao", motivo: "capacidade_desligada", regra: "regra:concessao", regraVersao: 1, em: dia17 });
      expect(l1).toMatchObject({ ownerId: PESSOA_MARLON, kind: "tool_call", motivo: null });

      const meus = (linhas: { id: string }[]) => linhas.map((l) => l.id).filter((id) => [l1?.id, l2?.id, l3?.id].includes(id));
      expect(meus(await repos.trilha.filtrar({ agenteId: agenteA }))).toEqual([l2?.id, l1?.id]);
      expect(meus(await repos.trilha.filtrar({ conectorId: conector }))).toEqual([l3?.id, l1?.id]);
      expect(meus(await repos.trilha.filtrar({ dia: "2026-09-16" }))).toEqual([l2?.id, l1?.id]);
      expect(meus(await repos.trilha.filtrar({ dia: "2026-09-16", fuso: "America/Sao_Paulo" }))).toEqual([l3?.id, l2?.id, l1?.id]);
      expect(meus(await repos.trilha.filtrar({ dia: "2026-09-17", agenteId: agenteB, conectorId: conector }))).toEqual([l3?.id]);

      await expectRejected(trx, () => repos.trilha.registrar({ agenteId: agenteA, ferramenta: "lembrar", kind: "texto livre!", regra: "regra:x", regraVersao: 1 }), "23514");
      await expectRejected(trx, () => repos.trilha.registrar({ agenteId: agenteA, ferramenta: "lembrar", kind: "tool_call", regra: "regra:montagem-ferramentas", regraVersao: 1 }), "23514");
      // Imutável (ADR-004): nem o próprio dono da linha altera.
      await expectRejected(trx, () => trx`update trilha set kind = 'outro' where id = ${l1?.id ?? ""}`, "42501");
    });
  });
});
