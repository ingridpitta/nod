import { expect, it } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { enfileirarRetomada } from "../../src/use-cases/enfileirar-retomada.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-287 no Postgres: a marca da web não se lava na retomada que se junta (critério 3) nem no turno repetido, que
 * no manual volta a pedir a pessoa até para o que só lê (critério 4).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function cenario(trx: Trx) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  const novo = async (extra: Record<string, unknown> = {}) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "abra o PR", entradaConfianca: "confiavel", modelo: "m", ...extra });
    if (!t) throw new Error("turno");
    return t;
  };
  const plano = (turnoId: string): PlanoTurno => ({
    tenantId: TENANT_PADRAO, turnoId, agenteId, conversaId, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL],
  });
  return { repos, deps, novo, plano };
}

describeIntegracao("a marca da web acompanha a retomada e o turno repetido (NOD-287)", () => {
  it("critério 3: a retomada já na fila (nascida limpa) ganha a marca quando a origem foi marcada depois", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const original = await c.novo();
      const r1 = await enfileirarRetomada(c.deps, { original, prazoEm: Date.now() + 600_000, entradaTexto: "primeira decisão" });
      expect(r1.nova).toBe(true);
      expect(await c.repos.turnos.contaminado(r1.turno!.id)).toBe(false);
      await c.repos.turnos.contaminar(original.id, Date.now());
      const r2 = await enfileirarRetomada(c.deps, { original, prazoEm: Date.now() + 600_000, entradaTexto: "segunda decisão" });
      expect(r2).toMatchObject({ nova: false, turno: { id: r1.turno!.id } });
      expect(await c.repos.turnos.contaminado(r1.turno!.id)).toBe(true);
    });
  });

  it("critério 4: o turno repetido de uma origem que leu a web pede aprovação até para o comando que só lê", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const original = await c.novo();
      await c.repos.turnos.contaminar(original.id, Date.now());
      const repetido = await c.novo({ contaminadoDe: original.id });
      const limpo = await c.novo();
      expect("aguardar" in (await autorizarComando(c.deps, { plano: c.plano(repetido.id), comando: "gh pr list -R acme/acme" })).data).toBe(true);
      expect((await autorizarComando(c.deps, { plano: c.plano(limpo.id), comando: "gh pr list -R acme/acme" })).data).toEqual({ permitir: true, porque: "leitura" });
    });
  });
});
