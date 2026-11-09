import { afterAll, beforeAll, expect, it } from "vitest";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { rotasTimes } from "../../src/adapters/http/rotas/times.ts";
import type { AcaoTimes } from "../../src/contracts/ferramentas-times.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_TIMES } from "../../src/domain/acoes/times.ts";
import { chaveDoTime } from "../../src/domain/times.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { listarTimes } from "../../src/use-cases/acoes/times.ts";
import { decidirLoteDeBots } from "../../src/use-cases/gerir-bots.ts";
import { gerirTimes } from "../../src/use-cases/gerir-times.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-437 (ADR-135): o teste de contrato das ações `times.*` (e do bots.mover em lote). A mesma ação pela tela (rota HTTP,
 * autor a pessoa) e pelo chat (gerir_times de um bot comum) leva o mesmo estado inicial ao mesmo estado final: os times
 * (nome, ordem, recolhido) e quem está em cada um, na ordem. Cada lado roda numa transação própria, com os mesmos bots.
 * É o arquivo que o registro cita como `contrato` (src/domain/acoes/times.ts).
 */

type Retrato = { times: [string, number, boolean][]; membros: Record<string, string[]> };

describeIntegracao("paridade tela × chat dos times.* (NOD-437, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(rotasTimes(deps));
  });
  afterAll(() => servidor.close());

  /** O mesmo começo dos dois lados: Engenharia (Ana, Beto), Produto (Bia), Sem time (Vivi e o bot que fala). */
  async function montar(trx: Tx, modo: "manual" | "total" = "total") {
    const d = depsSobreTrx(trx, MARLON);
    const bot = await agenteComConversa(trx, MARLON, { nome: "Faustino", modo });
    const ids: Record<string, string> = {};
    for (const nome of ["Ana", "Beto", "Bia", "Vivi"]) ids[nome] = (await agenteComConversa(trx, MARLON, { nome })).agenteId;
    await d.repos.agentes.mudarSecao([ids.Ana ?? "", ids.Beto ?? ""], "Engenharia");
    await d.repos.agentes.mudarSecao([ids.Bia ?? ""], "Produto");
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    const times = (await executar(d, listarTimes, {})).data.times;
    const idDoTime = (nome: string) => times.find((t) => chaveDoTime(t.nome) === chaveDoTime(nome))?.id ?? "";
    return { d, ids, idDoTime, ctx: { turnoId: turno.id, agenteId: bot.agenteId, conversaId: bot.conversaId } };
  }

  async function retrato(d: Deps): Promise<Retrato> {
    const times = (await executar(d, listarTimes, {})).data.times;
    const bots = (await d.repos.agentes.listar({ incluirOcultos: true })).filter((a) => a.ownerId === MARLON.pessoaId && a.dono === "pessoa" && a.excluidoEm === null);
    const membros: Record<string, string[]> = {};
    for (const t of times) membros[t.nome] = bots.filter((b) => chaveDoTime(b.secao ?? "") === chaveDoTime(t.nome)).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0) || a.nome.localeCompare(b.nome)).map((b) => b.nome);
    return { times: times.map((t) => [t.nome, t.posicao, t.recolhido]), membros };
  }

  type M = Awaited<ReturnType<typeof montar>>;
  type Cenario = { id: string; tela: (m: M) => { metodo: string; caminho: string; corpo?: unknown; status: number }; chat: AcaoTimes };
  const CENARIOS: Cenario[] = [
    { id: "times.criar", tela: (m) => ({ metodo: "POST", caminho: "/times", corpo: { nome: "Marketing", posicao: 0, bots: [m.ids.Bia, m.ids.Vivi] }, status: 201 }), chat: { tipo: "criar", time: "Marketing", posicao: 1, bots: ["Bia", "Vivi"] } },
    { id: "times.renomear", tela: (m) => ({ metodo: "PATCH", caminho: `/times/${m.idDoTime("Engenharia")}`, corpo: { nome: "Plataforma" }, status: 200 }), chat: { tipo: "renomear", time: "engenharia", nome: "Plataforma" } },
    { id: "times.excluir", tela: (m) => ({ metodo: "DELETE", caminho: `/times/${m.idDoTime("Engenharia")}`, status: 200 }), chat: { tipo: "excluir", time: "Engenharia" } },
    { id: "times.ordenar", tela: (m) => ({ metodo: "PATCH", caminho: `/times/${m.idDoTime("Produto")}/posicao`, corpo: { posicao: 0 }, status: 200 }), chat: { tipo: "ordenar", time: "Produto", posicao: 1 } },
    { id: "times.recolher", tela: (m) => ({ metodo: "PATCH", caminho: `/times/${m.idDoTime("Produto")}/recolhido`, corpo: { recolhido: true }, status: 200 }), chat: { tipo: "recolher", time: "Produto", recolhido: true } },
    { id: "bots.mover", tela: (m) => ({ metodo: "POST", caminho: "/agentes/mover", corpo: { bots: [m.ids.Ana, m.ids.Vivi], time: "Produto" }, status: 200 }), chat: { tipo: "mover", time: "Produto", bots: ["Ana", "Vivi"] } },
  ];

  it("cobre exatamente as ações vivas dos times, mais o mover em lote", () => {
    expect(CENARIOS.map((c) => c.id).sort()).toEqual([...ACOES_TIMES.map((a) => a.id), "bots.mover"].sort());
  });

  it.each(CENARIOS)("$id: a rota e o gerir_times levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    let inicial: Retrato | null = null;
    let pelaTela: Retrato | null = null;
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      inicial = await retrato(m.d);
      const sessao = await servidor.entrar("marlon");
      const t = c.tela(m);
      const r = await servidor.chamar(sessao, t.metodo, t.caminho, t.corpo);
      expect(r.status).toBe(t.status);
      pelaTela = await retrato(m.d);
    });
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect(await retrato(m.d)).toEqual(inicial);
      const r = await gerirTimes(m.d, { ...m.ctx, resumo: c.id, acoes: [c.chat] });
      expect(r.data).toMatchObject({ ok: true, esperando: [] });
      expect(await retrato(m.d)).toEqual(pelaTela);
    });
    expect(pelaTela).not.toEqual(inicial);
  });

  it("times.excluir no manual: o card aprovado leva ao mesmo estado do DELETE da tela (revisão 1, A3)", async () => {
    let pelaTela: Retrato | null = null;
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx, "manual");
      const r = await servidor.chamar(await servidor.entrar("marlon"), "DELETE", `/times/${m.idDoTime("Engenharia")}`);
      expect(r.status).toBe(200);
      pelaTela = await retrato(m.d);
    });
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx, "manual");
      const antes = await retrato(m.d);
      const r = await gerirTimes(m.d, { ...m.ctx, resumo: "excluir", acoes: [{ tipo: "excluir", time: "Engenharia" }] });
      expect(r.data).toMatchObject({ ok: true, esperando: [0] });
      expect(await retrato(m.d)).toEqual(antes);
      if (!r.data.ok || !r.data.decisao_id) throw new Error("sem card");
      await executar(m.d, decidirLoteDeBots, { decisaoId: r.data.decisao_id, recusar: false });
      expect(await retrato(m.d)).toEqual(pelaTela);
    });
  });
});
