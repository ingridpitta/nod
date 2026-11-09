import { expect, it } from "vitest";
import { ROTINAS_POR_AGENTE } from "../../src/shared/constantes.ts";
import { criarRotina, criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

describeIntegracao("rotinas: limites 50, gate por DEFAULT, offset recusado no domínio E no CHECK, cron sem futuro", () => {
  it("a 51ª rotina do bot é recusada: limite_atingido pela pessoa (lança) e pelo agente ({erro})", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const base = { agenteId, cron: "0 8 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" };
      for (let i = 0; i < ROTINAS_POR_AGENTE; i++) await criarRotinaPelaPessoa(deps, base);
      expect(await repos.rotinas.contarDoAgente(agenteId)).toBe(ROTINAS_POR_AGENTE);
      await expect(criarRotinaPelaPessoa(deps, base)).rejects.toMatchObject({ codigo: "limite_atingido" });
      expect((await criarRotina(deps, { ...contexto(agenteId, conversaId), ...rotinaValida() })).data).toEqual({ erro: "limite_atingido" });
      expect(await repos.rotinas.contarDoAgente(agenteId)).toBe(ROTINAS_POR_AGENTE);
    });
  });

  it("INSERT sem exige_aprovacao → true (DEFAULT da coluna, E7.3.1/E7.3.3): por SQL cru e pelo repositório", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, repos } = await agenteComConversa(trx, MARLON);
      const [cru] = await trx<{ exige_aprovacao: boolean }[]>`
        insert into rotinas (owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
        values (${PESSOA_MARLON}, ${agenteId}, ${conversaId}, '0 8 * * *', ${TZ}, 'i', 'f', 'e', 'l', 'p', now()) returning exige_aprovacao`;
      expect(cru?.exige_aprovacao).toBe(true);
      const pelaApi = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA });
      expect(pelaApi?.exigeAprovacao).toBe(true);
    });
  });

  it("'+03:00' é recusado no domínio (fuso_invalido) e no CHECK rotinas_fuso_iana (23514); cron sem futuro é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const base = { agenteId, cron: "0 8 * * *", fusoIana: "+03:00", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" };
      await expect(criarRotinaPelaPessoa(deps, base)).rejects.toMatchObject({ codigo: "fuso_invalido" });
      await expect(criarRotinaPelaPessoa(deps, { ...base, fusoIana: "UTC-3" })).rejects.toMatchObject({ codigo: "fuso_invalido" });
      await expect(criarRotinaPelaPessoa(deps, { ...base, fusoIana: TZ, cron: "0 8 31 2 *" })).rejects.toMatchObject({ codigo: "cron_sem_futuro" });
      expect((await criarRotina(deps, { ...contexto(agenteId, conversaId), ...rotinaValida({ fuso_iana: "+03:00" }) })).data).toEqual({ erro: "fuso_invalido" });
      // Segunda camada: o banco recusa mesmo quem passar por fora do domínio.
      await expectRejected(
        trx,
        () => trx`insert into rotinas (owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
          values (${PESSOA_MARLON}, ${agenteId}, ${conversaId}, '0 8 * * *', '+03:00', 'i', 'f', 'e', 'l', 'p', now())`,
        "23514",
      );
    });
  });
});
