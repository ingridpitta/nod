import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { rotasQuadro } from "../../src/adapters/http/rotas/quadro.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import type { OpQuadrosDoBot } from "../../src/contracts/quadros-do-bot.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_QUADRO } from "../../src/domain/acoes/quadro.ts";
import { QUADROS_PARA_TODOS } from "../../src/domain/flag-quadros.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { configurarLiberacaoQuadrosN } from "../../src/repositories/raio-x.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { EXECUTORES_QUADRO } from "../../src/use-cases/acoes/quadro.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { aplicarQuadrosDoBot, quadrosDoBot } from "../../src/use-cases/quadros-do-bot.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-14 (ADR-153, ADR-135): o teste de contrato das ações dos N quadros e dos projetos. A mesma ação pela tela (rota,
 * autor a pessoa) e pelo chat (gerir_quadro do bot, na conversa com a pessoa) leva o mesmo estado ao mesmo estado. Os
 * projetos são da pessoa toda (o nome é único): cada lado roda num banco idêntico (um withRollback cada, os mesmos nomes),
 * e o retrato compara pelos nomes, não pelos ids.
 */

type M = { d: Deps; ana: { agenteId: string; conversaId: string }; gil: { agenteId: string; conversaId: string }; site: string; padrao: string; projeto: string };

type Cenario = {
  id: (typeof ACOES_QUADRO)[number]["id"];
  nome?: string;
  /** O preparo (igual nos dois lados): ops dos N quadros pela pessoa. */
  preparar?: OpQuadrosDoBot[];
  tela: (m: M) => { metodo: string; caminho: string; corpo?: unknown; status: number };
  chat: (m: M) => { op: OpQuadro | OpQuadrosDoBot; quadro?: string };
};

const CENARIOS: Cenario[] = [
  { id: "quadro.listar", tela: (m) => ({ metodo: "GET", caminho: `/agentes/${m.ana.agenteId}/quadros`, status: 200 }), chat: () => ({ op: { tipo: "listar_quadros" } }) },
  { id: "quadro.abrir", tela: (m) => ({ metodo: "PUT", caminho: `/agentes/${m.ana.agenteId}/quadros/aberto`, corpo: { quadro: m.site }, status: 200 }), chat: () => ({ op: { tipo: "abrir_quadro", quadro: "Site" } }) },
  { id: "quadro.definir_padrao", tela: (m) => ({ metodo: "PUT", caminho: `/agentes/${m.ana.agenteId}/quadros/${m.site}/padrao`, status: 200 }), chat: () => ({ op: { tipo: "definir_padrao", quadro: "Site" } }) },
  { id: "quadro.vincular_bot", tela: (m) => ({ metodo: "POST", caminho: `/quadros/${m.site}/bots`, corpo: { bot: m.gil.agenteId }, status: 200 }), chat: () => ({ op: { tipo: "vincular_bot", quadro: "Site", bot: "Gil Par" } }) },
  {
    id: "quadro.desvincular_bot",
    nome: "o dono sai: o Gil vira dono e o Site sai da Ana",
    preparar: [{ tipo: "vincular_bot", quadro: "Ana Par / Site", bot: "Gil Par" }],
    tela: (m) => ({ metodo: "DELETE", caminho: `/quadros/${m.site}/bots/${m.ana.agenteId}`, status: 200 }),
    chat: () => ({ op: { tipo: "desvincular_bot", quadro: "Site", bot: "Ana Par" } }),
  },
  { id: "quadro.criar_projeto", tela: () => ({ metodo: "POST", caminho: "/projetos", corpo: { nome: "Blog", meta: "10 posts", prazo: "2026-12-01" }, status: 201 }), chat: () => ({ op: { tipo: "criar_projeto", nome: "Blog", meta: "10 posts", prazo: "2026-12-01" } }) },
  { id: "quadro.editar_projeto", tela: (m) => ({ metodo: "PATCH", caminho: `/projetos/${m.projeto}`, corpo: { nome: "Lançamento 2", descricao: "d" }, status: 200 }), chat: () => ({ op: { tipo: "editar_projeto", projeto: "Lançamento", nome: "Lançamento 2", descricao: "d" } }) },
  { id: "quadro.arquivar_projeto", tela: (m) => ({ metodo: "POST", caminho: `/projetos/${m.projeto}/arquivar`, status: 200 }), chat: () => ({ op: { tipo: "arquivar_projeto", projeto: "Lançamento" } }) },
  {
    id: "quadro.restaurar_projeto",
    preparar: [{ tipo: "arquivar_projeto", projeto: "Lançamento" }],
    tela: (m) => ({ metodo: "POST", caminho: `/projetos/${m.projeto}/restaurar`, status: 200 }),
    chat: () => ({ op: { tipo: "restaurar_projeto", projeto: "Lançamento" } }),
  },
  // As de antes, com o que a ADA-14 trouxe: o nome cria outro quadro; editar renomeia e põe no projeto.
  { id: "quadro.criar", nome: "outro quadro no bot, já no projeto", tela: (m) => ({ metodo: "POST", caminho: `/agentes/${m.ana.agenteId}/quadro`, corpo: { nome: "Blog", projeto: "Lançamento" }, status: 201 }), chat: () => ({ op: { tipo: "criar_quadro", nome: "Blog", projeto: "Lançamento" } }) },
  { id: "quadro.editar", nome: "renomeia o Site e tira do projeto", tela: (m) => ({ metodo: "PATCH", caminho: `/agentes/${m.ana.agenteId}/quadro?quadro=${m.site}`, corpo: { nome: "Site novo", projeto: null }, status: 200 }), chat: () => ({ op: { tipo: "editar_quadro", nome: "Site novo", projeto: null }, quadro: "Site" }) },
];

describeIntegracao("paridade tela × chat dos N quadros e dos projetos (ADA-14, ADR-153)", () => {
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
    servidor = await servidorDeTeste(rotasQuadro(deps));
  });
  afterAll(() => servidor.close());
  afterEach(() => configurarLiberacaoQuadrosN(QUADROS_PARA_TODOS));

  /** O mesmo mundo nos dois lados: a Ana com o quadro padrão e o Site (no projeto Lançamento) e o Gil sem quadro. */
  async function montar(trx: Tx): Promise<M> {
    configurarLiberacaoQuadrosN(QUADROS_PARA_TODOS);
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const ana = await agenteComConversa(trx, MARLON, { nome: "Ana Par" });
    const gil = await agenteComConversa(trx, MARLON, { nome: "Gil Par" });
    const pessoa = (ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: ana.agenteId, executor: "catcher", ops });
    const pr = await aplicarQuadrosDoBot(d, { autor: { tipo: "pessoa" }, op: { tipo: "criar_projeto", nome: "Lançamento" } });
    expect(pr.data).toMatchObject({ ok: true });
    expect((await pessoa([{ tipo: "criar_quadro", meta: "Lançar", prazo: "2026-12-01" }, { tipo: "criar_tarefa", titulo: "T1" }])).data).toMatchObject({ ok: true });
    expect((await pessoa([{ tipo: "criar_quadro", nome: "Site", projeto: "Lançamento" }, { tipo: "criar_tarefa", titulo: "S1" }])).data).toMatchObject({ ok: true });
    const lista = await quadrosDoBot(d, ana.agenteId);
    const site = lista.quadros.find((q) => q.nome === "Site")!.id;
    const padrao = lista.quadros.find((q) => q.padrao)!.id;
    return { d, ana, gil, site, padrao, projeto: pr.data.ok ? pr.data.projeto!.id : "" };
  }

  /** O retrato pelos nomes: os quadros de cada bot (nome, projeto, padrão, bots e dono, tarefas), o aberto e os projetos. */
  async function retrato(m: M) {
    const porBot = async (agenteId: string) => {
      const r = await quadrosDoBot(m.d, agenteId);
      const nome = (id: string | null) => r.quadros.find((q) => q.id === id)?.nome ?? null;
      const projetos = new Map(r.projetos.map((p) => [p.id, p.nome]));
      return {
        quadros: r.quadros.map((q) => [q.nome, q.projetoId ? projetos.get(q.projetoId) : null, q.padrao, q.meta, q.prazo, q.total, q.bots.map((b) => `${b.nome}${b.dono ? "*" : ""}`).sort()]).sort(),
        aberto: nome(r.aberto),
        padrao: nome(r.padrao),
      };
    };
    const projetos = (await m.d.repos.projetos.listar()).map((p) => [p.nome, p.descricao, p.meta, p.prazo, p.arquivadoEm !== null]).sort();
    return { ana: await porBot(m.ana.agenteId), gil: await porBot(m.gil.agenteId), projetos };
  }

  async function turnoDaAna(m: M) {
    const turno = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.ana.conversaId, agenteId: m.ana.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    return { turnoId: turno.id, agenteId: m.ana.agenteId, conversaId: m.ana.conversaId };
  }

  async function lado(c: Cenario, via: "tela" | "chat") {
    let fim: Awaited<ReturnType<typeof retrato>> | null = null;
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const op of c.preparar ?? []) expect((await aplicarQuadrosDoBot(m.d, { autor: { tipo: "pessoa" }, op })).data).toMatchObject({ ok: true });
      const antes = await retrato(m);
      if (via === "tela") {
        const t = c.tela(m);
        const resp = await servidor.chamar(await servidor.entrar("marlon"), t.metodo, t.caminho, t.corpo);
        expect(resp.status, await resp.clone().text()).toBe(t.status);
      } else {
        const { op, quadro } = c.chat(m);
        const r = await executar(m.d, gerirQuadro, { ...(await turnoDaAna(m)), ...(quadro ? { quadro } : {}), acoes: [op as OpQuadro] });
        expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      }
      fim = await retrato(m);
      // Toda ação, menos a leitura, muda algo (o cenário não passa por acaso com as duas pontas paradas).
      if (c.id === "quadro.listar") expect(fim).toEqual(antes);
      else expect(fim).not.toEqual(antes);
    });
    trxAtual = null;
    return fim;
  }

  it("cobre exatamente as ações cujo contrato é este arquivo, e o executor de cada uma existe", () => {
    const deste = ACOES_QUADRO.filter((a) => a.chat.contrato === "tests/integration/paridade-quadros-do-bot.test.ts").map((a) => a.id).sort();
    const novos = CENARIOS.filter((c) => c.id !== "quadro.criar" && c.id !== "quadro.editar").map((c) => c.id).sort();
    expect(novos).toEqual(deste);
    for (const id of deste) expect(EXECUTORES_QUADRO).toHaveProperty([id]);
  });

  it.each(CENARIOS.map((c) => ({ ...c, rotulo: c.nome ? `${c.id} (${c.nome})` : c.id })))("$rotulo: a rota e o gerir_quadro chegam ao mesmo estado", async (c) => {
    const pelaTela = await lado(c, "tela");
    const peloChat = await lado(c, "chat");
    expect(pelaTela).not.toBeNull();
    expect(peloChat).toEqual(pelaTela);
  });

  it("a rota recusa o corpo inválido (400) e o quadro que não é do bot (404), como o chat", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const sessao = await servidor.entrar("marlon");
      expect((await servidor.chamar(sessao, "PUT", `/agentes/${m.ana.agenteId}/quadros/aberto`, {})).status).toBe(400);
      expect((await servidor.chamar(sessao, "POST", "/projetos", { nome: "P", prazo: "amanhã" })).status).toBe(400);
      expect((await servidor.chamar(sessao, "PUT", `/agentes/${m.gil.agenteId}/quadros/${m.site}/padrao`, {})).status).toBe(404);
      const r = await executar(m.d, gerirQuadro, { ...(await turnoDaAna(m)), acoes: [{ tipo: "definir_padrao", quadro: "Site", bot: "Gil Par" } as never] });
      expect(r.data).toMatchObject({ ok: false });
    });
    trxAtual = null;
  });
});
