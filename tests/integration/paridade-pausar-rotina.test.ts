import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasRotinas, type DepsRotasL7 } from "../../src/adapters/http/rotas/rotinas.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_ROTINAS } from "../../src/domain/acoes/rotinas.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { pausarRotinaPeloAgente, reativarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-412 (ADR-135): o teste de contrato de `rotinas.pausar` e `rotinas.ativar`. A mesma ação pela tela (POST
 * rotinas/:id/pausar com `ate`, e /ativar) e pelo chat (pausar_rotina com `ate`, reativar_rotina) leva o mesmo estado
 * inicial ao mesmo estado final: estado, data de volta e próxima execução. É o arquivo que o registro cita como `contrato`.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-11T15:00:00Z");

let trxAtual: Tx | null = null;
const txPara = (escopo: Escopo): Transacao => async (fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(trxAtual);
};

type Retrato = { estado: string; retomarEm: number | null; proximaExecucao: number };

describeIntegracao("paridade tela × chat de rotinas.pausar e rotinas.ativar (NOD-412, ADR-135)", () => {
  let srv: ServidorDeTeste;

  beforeAll(async () => {
    const semTrx = depsSobre({} as never, MARLON);
    const deps: DepsRotasL7 = { txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => AGORA };
    srv = await servidorDeTeste(criarRotasRotinas(deps));
  });
  afterAll(() => srv.close());

  async function montar(trx: Tx, estado: "ativa" | "pausada") {
    trxAtual = trx;
    const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
    const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
    const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA + 3_600_000, estado });
    const id = r?.id ?? "";
    const retrato = async (): Promise<Retrato> => {
      const x = await repos.rotinas.buscar(id);
      return { estado: x?.estado ?? "", retomarEm: x?.retomarEm ?? null, proximaExecucao: x?.proximaExecucao ?? 0 };
    };
    return { id, deps, ctx: { agenteId, conversaId, turnoId: randomUUID() }, retrato };
  }

  type Cenario = { id: string; nome: string; inicial: "ativa" | "pausada"; tela: (id: string) => { caminho: string; corpo?: unknown }; chat: (m: Awaited<ReturnType<typeof montar>>) => Promise<unknown> };
  const CENARIOS: Cenario[] = [
    { id: "rotinas.pausar", nome: "pausar sem data", inicial: "ativa", tela: (id) => ({ caminho: `/rotinas/${id}/pausar` }), chat: (m) => pausarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.id }) },
    { id: "rotinas.pausar", nome: "pausar até segunda 09:00", inicial: "ativa", tela: (id) => ({ caminho: `/rotinas/${id}/pausar`, corpo: { ate: "2026-11-16T09:00" } }), chat: (m) => pausarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.id, ate: "2026-11-16T09:00" }) },
    { id: "rotinas.ativar", nome: "ativar", inicial: "pausada", tela: (id) => ({ caminho: `/rotinas/${id}/ativar` }), chat: (m) => reativarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.id }) },
  ];

  it("cobre as ações vivas de pausar e ativar do registro", () => {
    const vivas = ACOES_ROTINAS.filter((a) => a.chat.estado === "vivo" && "contrato" in a.chat && a.chat.contrato === "tests/integration/paridade-pausar-rotina.test.ts").map((a) => a.id);
    expect([...new Set(CENARIOS.map((c) => c.id))].sort()).toEqual([...vivas].sort());
  });

  it.each(CENARIOS)("$nome: a rota e a ferramenta levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    let inicial: Retrato | null = null;
    let pelaTela: Retrato | null = null;
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, c.inicial);
      inicial = await m.retrato();
      const t = c.tela(m.id);
      const r = await srv.chamar(await srv.entrar("marlon"), "POST", t.caminho, t.corpo);
      expect(r.status).toBe(200);
      pelaTela = await m.retrato();
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, c.inicial);
      expect(await m.retrato()).toEqual(inicial);
      await c.chat(m);
      expect(await m.retrato()).toEqual(pelaTela);
    });
    expect(pelaTela).not.toEqual(inicial);
  });

  it("a tela recusa data no passado e corpo inválido com 400, sem pausar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "ativa");
      const sessao = await srv.entrar("marlon");
      for (const corpo of [{ ate: "2026-11-10" }, { ate: 3 }, { retomar_em: "amanhã" }]) {
        const r = await srv.chamar(sessao, "POST", `/rotinas/${m.id}/pausar`, corpo);
        expect(r.status, JSON.stringify(corpo)).toBe(400);
      }
      expect((await m.retrato()).estado).toBe("ativa");
    });
  });
});
