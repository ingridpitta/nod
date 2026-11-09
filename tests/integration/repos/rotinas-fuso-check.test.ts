import { expect, it } from "vitest";
import { ROTINAS } from "../../../src/db/schema/rotinas.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const rotina = (agenteId: string, conversaId: string, fusoIana: string, proximaExecucao = Date.now() + 60_000) => ({
  agenteId,
  conversaId,
  cron: "0 8 * * 1-5",
  fusoIana,
  instrucao: "resumo dos PRs",
  fonte: "github",
  entregavel: "lista",
  limitesAprovacao: "nada sai sem aprovar",
  politicaSemDado: "diga que não houve",
  proximaExecucao,
});

describeIntegracao("rotinasRepo: fuso IANA por CHECK (ADR-011) e gate ligado por DEFAULT (E7.3)", () => {
  it("'+03:00', 'UTC-3' e '' são recusados pelo CHECK; America/Sao_Paulo passa; exige_aprovacao nasce true sem ninguém dizer", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      for (const fuso of ["+03:00", "UTC-3", "", "GMT+3"]) {
        const erro = await expectRejected(trx, () => repos.rotinas.criar(rotina(agenteId, conversaId, fuso)), "23514");
        expect(erro.message).toContain(ROTINAS.check.nome);
      }
      const r = await repos.rotinas.criar(rotina(agenteId, conversaId, "America/Sao_Paulo"));
      expect(r).toMatchObject({ fusoIana: "America/Sao_Paulo", exigeAprovacao: true, estado: "ativa" });
      const [def] = await trx<{ d: string }[]>`select column_default as d from information_schema.columns where table_name = 'rotinas' and column_name = 'exige_aprovacao'`;
      expect(def?.d).toBe("true");
      expect(await repos.rotinas.contarDoAgente(agenteId)).toBe(1);
      expect((await repos.rotinas.listarDoAgente(agenteId)).map((x) => x.id)).toEqual([r?.id]);
    });
  });

  it("ativasVencidas devolve só ativas com proxima_execucao no passado; pausar e reagendar mudam a leitura", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const vencida = await repos.rotinas.criar(rotina(agenteId, conversaId, "America/Sao_Paulo", agora - 1_000));
      const futura = await repos.rotinas.criar(rotina(agenteId, conversaId, "Europe/Lisbon", agora + 60_000));
      expect((await repos.rotinas.ativasVencidas(agora)).map((x) => x.id)).toEqual([vencida?.id]);

      expect((await repos.rotinas.atualizarEstado(vencida?.id ?? "", "pausada"))?.estado).toBe("pausada");
      expect(await repos.rotinas.ativasVencidas(agora)).toEqual([]);

      expect((await repos.rotinas.reagendar(futura?.id ?? "", agora - 1))?.proximaExecucao).toBe(agora - 1);
      expect((await repos.rotinas.ativasVencidas(agora)).map((x) => x.id)).toEqual([futura?.id]);
    });
  });
});
