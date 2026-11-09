import { expect, it } from "vitest";
import { aposAcessoRecusado, aposSondaFalha, aposTimeoutDaChamada, ESTADO_LIMPO } from "../../src/domain/disjuntor-conector.ts";
import { listarFrota } from "../../src/use-cases/listar-frota.ts";
import { depsSobreTrx, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 12, 0);

/** definido em 2026-10-26 (NOD-374): GET /frota só lista em Fora do ar a falha que persistiu ou o acesso recusado. */
describeIntegracao("frota: Fora do ar pelo disjuntor (NOD-374)", () => {
  it("timeout isolado e falha aberta não aparecem; a persistente aparece com a próxima sonda; 401 aparece com a causa", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const criar = async (slug: string, habilitado = true) => {
        const id = (await deps.repos.conectores.criar({ nome: slug, slug, transporte: "stdio", comando: "node", declaracao: "nao-toca" }))!.id;
        if (habilitado) await deps.repos.conectores.habilitar(id, true);
        return id;
      };
      const [isolado, aberto, fora, recusado, lento, desligado] = [await criar("isolado"), await criar("aberto"), await criar("fora"), await criar("recusado"), await criar("lento"), await criar("desligado", false)];
      await deps.repos.conectores.gravarEstadoFalha(isolado, aposTimeoutDaChamada(ESTADO_LIMPO, T0, 0.5));
      await deps.repos.conectores.gravarEstadoFalha(aberto, aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, 0.5));
      const persistente = aposSondaFalha(aposSondaFalha(ESTADO_LIMPO, "timeout_transporte", T0, 0.5), "timeout_transporte", T0 + 10 * MIN, 0.5);
      await deps.repos.conectores.gravarEstadoFalha(fora, persistente);
      await deps.repos.conectores.gravarEstadoFalha(recusado, aposAcessoRecusado(ESTADO_LIMPO, T0));
      let cincoTimeouts = ESTADO_LIMPO;
      for (let i = 0; i < 5; i++) cincoTimeouts = aposTimeoutDaChamada(cincoTimeouts, T0 + i * MIN, 0.5);
      await deps.repos.conectores.gravarEstadoFalha(lento, cincoTimeouts);
      await deps.repos.conectores.gravarEstadoFalha(desligado, persistente);

      const negacoes = (await listarFrota(deps, {})).data.negacoes;
      expect(negacoes.map((n) => n.nome).sort()).toEqual(["desligado", "fora", "lento", "recusado"]);
      expect(negacoes.find((n) => n.nome === "fora")).toEqual({ classe: "conector_indisponivel", nome: "fora", motivo: "timeout_transporte", desde: T0, terminal: false, proximaEm: persistente.proximaSondaEm });
      expect(negacoes.find((n) => n.nome === "lento")).toMatchObject({ motivo: "timeout_transporte", lento: true });
      expect(negacoes.find((n) => n.nome === "fora")).not.toHaveProperty("lento");
      // Revisão 4: o desabilitado fica fora do laço — a negação diz que não há re-sonda (o cartão não promete).
      expect(negacoes.find((n) => n.nome === "desligado")).toMatchObject({ semRessonda: true });
      expect(negacoes.find((n) => n.nome === "recusado")).toMatchObject({ motivo: "falha_tecnica", causa: "acesso_recusado", proximaEm: null });
    });
  });
});
