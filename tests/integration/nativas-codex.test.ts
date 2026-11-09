import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { NATIVA_MCP_DA_PESSOA, NATIVAS_DO_TERMINAL_CODEX } from "../../src/domain/nativas.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-103 (paridade do Codex): o servidor decide as nativas do Codex com as MESMAS regras do Claude — o apply_patch fora
 * da pasta do bot como o Write, e o app (MCP) da pessoa como um comando que muda algo, só no plano que o traz.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
const ARQUIVO = "/Users/m/code/acme/apps/web/filtros.tsx";
const PEDIDO_MCP = 'linear: create_issue {"title":"Bug no filtro"}';

async function cenario(trx: Trx, modo: ModoAprovacao, nativas: readonly string[] = [...NATIVAS_DO_TERMINAL_CODEX, NATIVA_MCP_DA_PESSOA]) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 2" });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  if (modo !== "manual") await mudarModoAprovacao(deps, { agenteId, modo, confirmado: true });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "abre a issue", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  const plano: PlanoTurno = {
    tenantId: TENANT_PADRAO, turnoId: turno.id, agenteId, conversaId, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "gpt-5.6-sol" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...nativas], modoTurno: "conversa",
  };
  return { repos, deps, plano };
}

describeIntegracao("as nativas do Codex no servidor (ADR-103)", () => {
  it("apply_patch fora da pasta: no manual, o mesmo card do Write; no automático, grava sem card", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "manual");
      const r = await autorizarComando(c.deps, { plano: c.plano, arquivo: ARQUIVO });
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      const [item] = await c.repos.itensAprovacao.listar(r.data.aguardar);
      expect(item).toMatchObject({ textoOriginal: `Gravar ${ARQUIVO}`, destino: { conector: "terminal", argumentos: { arquivo: ARQUIVO } } });
      const a = await cenario(trx, "automatico");
      expect((await autorizarComando(a.deps, { plano: a.plano, arquivo: ARQUIVO })).data).toEqual({ permitir: true, porque: "modo_automatico" });
    });
  });

  it("app da pessoa: no manual vira card 'quer usar um app seu' com o pedido; nunca conta como leitura", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "manual");
      const r = await autorizarComando(c.deps, { plano: c.plano, mcp: PEDIDO_MCP });
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      const [item] = await c.repos.itensAprovacao.listar(r.data.aguardar);
      expect(item).toMatchObject({ textoOriginal: PEDIDO_MCP, destino: { conector: "terminal", argumentos: { comando: PEDIDO_MCP } } });
      expect((await c.repos.decisoes.buscar(r.data.aguardar))?.frase).toBe("Dev 2 quer usar um app seu");
      // Um servidor chamado "ls" não vira leitura: o nome não diz se a ferramenta só lê.
      const ls = await autorizarComando(c.deps, { plano: c.plano, mcp: "ls: listar {}" });
      expect("aguardar" in ls.data).toBe(true);
    });
  });

  for (const modo of ["automatico", "total"] as const) {
    it(`app da pessoa no ${modo}: roda sem card, pela regra do modo`, async () => {
      await withRollback(MARLON, async (trx) => {
        const c = await cenario(trx, modo);
        expect((await autorizarComando(c.deps, { plano: c.plano, mcp: PEDIDO_MCP })).data).toEqual({ permitir: true, porque: modo === "total" ? "modo_total" : "modo_automatico" });
      });
    });
  }

  it("sem o app da pessoa no plano (pedido de colega, sala), a chamada é recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total", NATIVAS_DO_TERMINAL_CODEX);
      await expect(autorizarComando(c.deps, { plano: c.plano, mcp: PEDIDO_MCP })).rejects.toMatchObject({ codigo: "nao_permitido" });
      // O terminal e o apply_patch seguem.
      expect((await autorizarComando(c.deps, { plano: c.plano, comando: "git status" })).data).toEqual({ permitir: true, porque: "leitura" });
      expect((await autorizarComando(c.deps, { plano: c.plano, arquivo: ARQUIVO })).data).toEqual({ permitir: true, porque: "modo_total" });
    });
  });
});
