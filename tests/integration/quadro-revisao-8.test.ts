import { beforeAll, expect, it } from "vitest";
import { despacharPessoa, frameDoEvento } from "../../src/adapters/fundo/despachar-outbox.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { sincronizarPrsDoQuadro } from "../../src/use-cases/prs-do-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { pessoaDeTeste } from "../helpers/pessoa-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-443 (revisão 8 do PR #628, ADR-143): o quadro_mudou de todo caminho chega a quem participa (comentário da tela,
 * pedir_a_bot com tarefa, PRs do GitHub); o modo "grupo" é recusado no servidor; o turno do pedido de quem participa roda
 * no executor padrão da dona (não no de quem pediu); e quem saiu do quadro não faz o bot da dona pedir aprovação.
 */

const DONA = pessoaDeTeste("Dora Dona 443 r8");
const ANA = pessoaDeTeste("Ana Membro 443 r8");

describeIntegracao("quadro com várias pessoas, revisão 8 (NOD-443, ADR-143)", () => {
  beforeAll(async () => {
    await DONA.criar();
    await ANA.criar();
  });

  const como = async (trx: Tx, e: Escopo): Promise<Deps> => {
    await vincularEscopo(trx, e);
    return depsSobreTrx(trx, e);
  };
  const lote = (d: Deps, anfitriaoId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId, executor: "catcher", ops });
  const daTela = (d: Deps, quadroId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, quadro: quadroId, executor: "catcher", ops });
  const turnoDe = async (d: Deps, agenteId: string, conversaId: string, executor: "catcher" | "local" = "catcher") => {
    const t = await d.repos.turnos.enfileirar({ executor, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!t) throw new Error("turno");
    return { turnoId: t.id, agenteId, conversaId };
  };

  /** A dona (com a Ada, anfitriã do quadro, e uma tarefa T1), a Ana no quadro e a Lia (o bot dela). O escopo volta à dona. */
  async function montar(trx: Tx) {
    const sufixo = Math.random().toString(36).slice(2, 7);
    const da = await como(trx, ANA.escopo);
    await da.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const lia = await agenteComConversa(trx, ANA.escopo, { nome: `Lia ${sufixo}` });
    const dd = await como(trx, DONA.escopo);
    await dd.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const ada = await agenteComConversa(trx, DONA.escopo, { nome: `Ada ${sufixo}` });
    expect((await lote(dd, ada.agenteId, [{ tipo: "criar_quadro", meta: "Lançar login" }, { tipo: "criar_tarefa", titulo: "T1" }])).data).toMatchObject({ ok: true });
    expect((await lote(dd, ada.agenteId, [{ tipo: "adicionar_pessoa", pessoa: ANA.nome }])).data).toMatchObject({ ok: true });
    const q = (await dd.repos.quadros.doAgente(ada.agenteId))!;
    return { dd, ada, lia, adaNome: `Ada ${sufixo}`, sufixo, qid: q.id };
  }

  /** Esvazia o outbox da dona (o que já estava) e devolve o que o próximo despacho entrega à Ana. */
  async function ouvirAna(trx: Tx) {
    const barramento = criarBarramento();
    const daAna: FrameSse[] = [];
    barramento.inscrever(ANA.id, (f) => daAna.push(f));
    await como(trx, DONA.escopo);
    await despacharPessoa(trx, DONA.escopo, barramento, { metricas: criarMetricas() });
    daAna.length = 0;
    return async () => {
      await como(trx, DONA.escopo);
      await despacharPessoa(trx, DONA.escopo, barramento, { metricas: criarMetricas() });
      return daAna.filter((f) => f.tipo === frameDoEvento("quadro_mudou"));
    };
  }

  it("item 1: o comentário da dona na tela chega ao vivo a quem participa", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      const despachar = await ouvirAna(trx);
      const r = await daTela(await como(trx, DONA.escopo), m.qid, [{ tipo: "comentar", tarefa: "T1", texto: "olhei" }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const mudou = await despachar();
      expect(mudou.length).toBeGreaterThan(0);
      expect(mudou.every((f) => f.dados.quadroId === m.qid && !("membros" in f.dados))).toBe(true);
    });
  });

  it("item 1: o pedir_a_bot com a tarefa (o comentário do bot da dona) chega ao vivo a quem participa", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      const beto = `Beto ${m.sufixo}`;
      const b = await agenteComConversa(trx, DONA.escopo, { nome: beto });
      const dd = await como(trx, DONA.escopo);
      for (const id of [m.ada.agenteId, b.agenteId]) await dd.repos.agentes.atualizarPerfil(id, { confirmado: true });
      const despachar = await ouvirAna(trx);
      const d2 = await como(trx, DONA.escopo);
      const ctx = await turnoDe(d2, m.ada.agenteId, m.ada.conversaId);
      const r = await executar(d2, pedirABot, { ...ctx, agente: beto, pedido: "revisar o PR 466", tarefa: "T1" });
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const mudou = await despachar();
      expect(mudou.length).toBeGreaterThan(0);
      expect(mudou.every((f) => f.dados.quadroId === m.qid)).toBe(true);
    });
  });

  it("item 1: o aviso dos PRs do GitHub no topo do quadro chega ao vivo a quem participa", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      const despachar = await ouvirAna(trx);
      const r = await executar(await como(trx, DONA.escopo), sincronizarPrsDoQuadro, { prs: [], aviso: "sem conexão com o GitHub", executor: "catcher" });
      expect(r.data.avisos).toBe(1);
      const mudou = await despachar();
      expect(mudou.map((f) => f.dados.quadroId)).toEqual([m.qid]);
    });
  });

  it("item 2: o modo grupo é recusado no servidor com o motivo, e o banco também não o aceita", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      const dd = await como(trx, DONA.escopo);
      const grupo: OpQuadro = JSON.parse('{"tipo":"mudar_modo","modo":"grupo"}');
      const r = await daTela(dd, m.qid, [grupo]);
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r.data)).toContain("a conversa do grupo ainda não existe");
      const comPessoa: OpQuadro = JSON.parse(JSON.stringify({ tipo: "adicionar_pessoa", pessoa: DONA.nome, modo: "grupo" }));
      expect((await daTela(dd, m.qid, [comPessoa])).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await dd.repos.quadros.buscar(m.qid))?.modoConversa).toBe("individual");
      await expect(trx.savepoint((s) => s`update quadros set modo_conversa = 'grupo' where id = ${m.qid}`)).rejects.toThrow(/check/i);
    });
  });

  it("item 6: sem turno da dona na conversa do bot, o turno do pedido de quem participa nasce no padrão dela (não no executor de quem pediu)", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      // A Ana, pelo bot dela num turno local, põe a Ada numa tarefa. A dona nunca conversou com a Ada.
      const da = await como(trx, ANA.escopo);
      const r = await executar(da, gerirQuadro, { ...(await turnoDe(da, m.lia.agenteId, m.lia.conversaId, "local")), quadro: m.qid, acoes: [{ tipo: "criar_tarefa", titulo: "Para a Ada", agente: m.adaNome, status: "afazer" }] });
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true, comecaram: [expect.objectContaining({ agente: m.adaNome })] });
      const tarefaId = r.data.ok ? r.data.comecaram[0]!.tarefa_id : "";
      const dd = await como(trx, DONA.escopo);
      const turno = await dd.repos.turnos.buscar((await dd.repos.quadros.tarefa(tarefaId))!.turnoId!);
      expect(turno).toMatchObject({ sobProcuracaoDe: ANA.id, executor: "catcher" });
    });
  });

  it("item 7: tirada do quadro, quem pediu a tarefa não faz o bot da dona pedir aprovação; enquanto participa, pede", async () => {
    await withRollback(DONA.escopo, async (trx) => {
      const m = await montar(trx);
      const r = await daTela(await como(trx, ANA.escopo), m.qid, [{ tipo: "criar_tarefa", titulo: "Da Ana", agente: m.adaNome, status: "afazer" }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const turnoId = r.data.ok ? r.data.comecaram[0]!.turnoId : "";
      const dd = await como(trx, DONA.escopo);
      const pedir = () => pedirAprovacao(dd, { turnoId, agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, resumo: "mandar o e-mail", itens: [{ texto: "mandar o e-mail", destino: { conector: "inexistente", ferramenta: "enviar", argumentos: {} } }] });
      // Participa: passa da conferência de quem pediu (e cai na do conector, que não existe neste teste).
      await expect(pedir()).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect((await lote(dd, m.ada.agenteId, [{ tipo: "tirar_pessoa", pessoa: ANA.nome }])).data).toMatchObject({ ok: true });
      const recusado = await pedir();
      expect(recusado.data).toMatchObject({ estado: "recusada", erros: [expect.stringContaining("não participa mais do quadro")] });
      expect(await dd.repos.decisoes.listarSuaVez(Date.now())).toEqual([]);
    });
  });
});
