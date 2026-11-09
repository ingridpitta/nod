import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-066 (o A2 do Marlon): gravar arquivo FORA de ~/nod/<bot> passa a seguir o modo, como o comando do terminal já
 * seguia. Antes, no manual, o bot gravava em qualquer arquivo do Mac sem card — o Dev 2 editaria o clone do Marlon
 * sem ele saber. Dentro da pasta do bot o hook nem pergunta ao servidor (git-na-pasta-do-bot.test.ts).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
const ARQUIVO = "/Users/m/code/acme/main-repos/acme/apps/web/filtros.tsx";

async function cenario(trx: Trx, modo: ModoAprovacao, origem: "conversa" | "delegacao" = "conversa") {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 2" });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  if (modo !== "manual") await mudarModoAprovacao(deps, { agenteId, modo, confirmado: true });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: origem === "delegacao" ? 1 : 0, entradaTexto: "corrige o filtro", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  const plano: PlanoTurno = {
    tenantId: TENANT_PADRAO, turnoId: turno.id, agenteId, conversaId, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL], modoTurno: origem,
  };
  return { repos, deps, plano };
}

describeIntegracao("gravar fora da pasta do bot segue o modo (ADR-066)", () => {
  it("manual: vira card 'Gravar <arquivo>' com a frase do arquivo; com o arquivo no destino", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "manual");
      const r = await autorizarComando(c.deps, { plano: c.plano, arquivo: ARQUIVO });
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      const [item] = await c.repos.itensAprovacao.listar(r.data.aguardar);
      expect(item).toMatchObject({ textoOriginal: `Gravar ${ARQUIVO}`, destino: { conector: "terminal", argumentos: { arquivo: ARQUIVO } } });
      expect((await c.repos.decisoes.buscar(r.data.aguardar))?.frase).toBe("Dev 2 quer gravar um arquivo no seu Mac");
    });
  });

  for (const modo of ["automatico", "total"] as const) {
    it(`${modo}: grava sem card, também num pedido de colega e depois de ler algo de fora`, async () => {
      await withRollback(MARLON, async (trx) => {
        const c = await cenario(trx, modo, "delegacao");
        await c.repos.turnos.contaminar(c.plano.turnoId, Date.now());
        expect((await autorizarComando(c.deps, { plano: c.plano, arquivo: ARQUIVO })).data).toEqual({ permitir: true, porque: modo === "total" ? "modo_total" : "modo_automatico" });
      });
    });
  }

  it("arquivo de credencial: no automático, card; no total grava sem a pessoa (PR 6 dos modos de aprovação) e registra como credencial", async () => {
    await withRollback(MARLON, async (trx) => {
      const auto = await cenario(trx, "automatico");
      expect("aguardar" in (await autorizarComando(auto.deps, { plano: auto.plano, arquivo: "/Users/m/.ssh/config" })).data).toBe(true);
      const c = await cenario(trx, "total");
      expect((await autorizarComando(c.deps, { plano: c.plano, arquivo: "/Users/m/.ssh/config" })).data).toEqual({ permitir: true, porque: "modo_total" });
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toMatchObject([{ modo: "total", tipo: "arquivo", gatilho: "credencial", resumo: "Gravar /Users/m/.ssh/config", veredito: null, decisaoId: null }]);
    });
  });
});
