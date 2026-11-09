import { expect, it } from "vitest";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const DIA = 24 * 60 * 60 * 1000;

describeIntegracao("decisoesRepo: Sua vez por pessoa sob RLS de duas pernas (ADR-007, EMENDA 1)", () => {
  it("a decisora designada vê pela perna extra; o dono vê pela owner_id; ninguém mais", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "falta_de_dado", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "falta o CNPJ; quem destrava: Ana" });
      const paraMim = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "3 e-mails" });
      expect(paraAna).toMatchObject({ ownerId: PESSOA_MARLON, decisorId: PESSOA_ANA, estado: "pendente", tipo: "falta_de_dado" });
      expect(paraAna?.prazoDecisaoEm).toBe(new Date(agora + DIA).toISOString());

      // Marlon (dono) lista só o que é a VEZ DELE: a que ele mesmo decide.
      expect((await repos.decisoes.listarSuaVez(agora)).map((d) => d.id)).toEqual([paraMim?.id]);
      expect((await repos.decisoes.listarSuaVez(agora))[0]?.agenteNome).toBe("Vera");

      await vincularEscopo(trx, ANA);
      const comoAna = criarRepos(trx, ANA);
      const fila = await comoAna.decisoes.listarSuaVez(agora);
      expect(fila.map((d) => d.id)).toEqual([paraAna?.id]);
      // O agente de Marlon é invisível para Ana: o nome cai no genérico, a decisão não some.
      expect(fila[0]?.agenteNome).toBe("agente");
      expect(await comoAna.decisoes.buscar(paraMim?.id ?? "")).toBeNull();

      // 0003: a decisora designada DECIDE (policy nod_decisora, FOR UPDATE pela perna decisor_id);
      // a que não é dirigida a ela continua null. Prova completa em decisora-escreve.test.ts.
      expect((await comoAna.decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora }))?.estado).toBe("decidida");
      expect(await comoAna.decisoes.decidir(paraMim?.id ?? "", { por: PESSOA_ANA, agora })).toBeNull();
    });
  });

  it("decidir só uma vez; vencerPendentes carimba o desfecho pelos dois rótulos de expiração; marcarVarrida é idempotente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const vista = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "a" });
      const naoVista = await repos.decisoes.criar({ tipo: "gate_rotina", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "b" });
      const futura = await repos.decisoes.criar({ tipo: "acesso", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "c" });
      const decidida = await repos.decisoes.criar({ tipo: "perfil", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "d" });

      expect((await repos.decisoes.decidir(decidida?.id ?? "", { por: PESSOA_MARLON, agora }))?.desfecho).toEqual({ tipo: "decidida", por: PESSOA_MARLON, em: new Date(agora).toISOString() });
      expect(await repos.decisoes.decidir(decidida?.id ?? "", { por: PESSOA_MARLON, agora })).toBeNull();
      expect(await repos.decisoes.ultimaDecisaoEm()).toBe(new Date(agora).toISOString());

      await repos.decisoes.marcarVista(vista?.id ?? "", agora + 500);
      const vencidas = await repos.decisoes.vencerPendentes(agora + 2_000);
      expect(vencidas.map((d) => [d.id, d.desfecho?.tipo]).sort()).toEqual(
        [
          [vista?.id, "expirou_com_alguem_ciente"],
          [naoVista?.id, "expirou_sem_ninguem_ver"],
        ].sort(),
      );
      expect(await repos.decisoes.vencerPendentes(agora + 2_000)).toEqual([]);
      expect((await repos.decisoes.buscar(futura?.id ?? ""))?.estado).toBe("pendente");

      expect(await repos.decisoes.marcarVarrida(vista?.id ?? "", "vencida")).toBe(true);
      expect(await repos.decisoes.marcarVarrida(vista?.id ?? "", "vencida")).toBe(false);
      expect(await repos.decisoes.marcarVarrida(vista?.id ?? "", "gate_rotina_passou_em_branco")).toBe(true);
      await expectRejected(trx, () => repos.decisoes.marcarVarrida(vista?.id ?? "", "Texto livre!"), "23514");

      // Vencida continua VISÍVEL em "Sua vez" com estado como coluna; reabrir volta a pendente com prazo novo.
      const fila = await repos.decisoes.listarSuaVez(agora + 2_000);
      expect(fila.find((d) => d.id === vista?.id)?.estado).toBe("vencida");
      const reaberta = await repos.decisoes.reabrir(vista?.id ?? "", agora + 3 * DIA);
      expect(reaberta).toMatchObject({ estado: "reaberta", desfecho: null });
      expect(await repos.decisoes.reabrir(futura?.id ?? "", agora + DIA)).toBeNull();
      // Vencida há mais de 7 dias sai da lista (fica no banco).
      expect((await repos.decisoes.listarSuaVez(agora + 8 * DIA)).map((d) => d.id)).not.toContain(naoVista?.id);
    });
  });
});
