import { expect, it } from "vitest";
import type { AutorLote, OpQuadro } from "../../src/contracts/quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { fecharComResposta, retomarComResposta } from "../../src/use-cases/responder-decisao.ts";
import { DAR_DONE } from "../../src/use-cases/tarefa-casa.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-28 (ADR-159, escopo E): quem_fecha bot|pessoa. Com pessoa, o bot não leva a Feito: o terminei da última etapa pede o
 * Done (decisão ligada à tarefa, opções "Dar Done" / "Voltar para …"), e a resposta move. O padrão (bot) não muda nada.
 */
describeIntegracao("ADA-28: quem dá o Done", () => {
  const lote = (d: Deps, anfitriaoId: string, ops: OpQuadro[], autor: AutorLote = { tipo: "pessoa" }) => executar(d, aplicarLoteQuadro, { autor, anfitriaoId, executor: "catcher", ops });

  const montar = async (trx: Parameters<typeof depsSobreTrx>[0], quemFecha: "bot" | "pessoa") => {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const s = Math.random().toString(36).slice(2, 7);
    const host = await agenteComConversa(trx, MARLON, { nome: `Quadro ${s}` });
    const ada = await agenteComConversa(trx, MARLON, { nome: `Ada ${s}` });
    const r = await lote(d, host.agenteId, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "revisao", agente: `Ada ${s}` }]);
    if (!r.data.ok) throw new Error(JSON.stringify(r.data));
    if (quemFecha === "pessoa") {
      const e = await lote(d, host.agenteId, [{ tipo: "editar_quadro", quem_fecha: "pessoa" }]);
      if (!e.data.ok) throw new Error(JSON.stringify(e.data));
    }
    const q = (await d.repos.quadros.doAgente(host.agenteId))!;
    const tarefa = (await d.repos.quadros.tarefas(q.id)).find((t) => t.titulo === "Login")!;
    const pedidosDeDone = async () => (await trx<{ id: string; estado: string; frase: string; conversa_id: string }[]>`select id, estado, frase, conversa_id from decisoes where tarefa_id = ${tarefa.id} and tarefa_pede_done`);
    const status = async () => (await d.repos.quadros.tarefa(tarefa.id))!.status;
    const comoAda: AutorLote = { tipo: "agente", agenteId: ada.agenteId };
    return { d, trx, host: host.agenteId, ada, q, tarefa, pedidosDeDone, status, comoAda };
  };

  it("editar_quadro grava quem_fecha, o quadro devolve e o Desfazer volta ao padrão", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      expect((await m.d.repos.quadros.buscar(m.q.id))?.quemFecha).toBe("pessoa");
      const r = await lote(m.d, m.host, [{ tipo: "desfazer" }]);
      expect(r.data.ok).toBe(true);
      expect((await m.d.repos.quadros.buscar(m.q.id))?.quemFecha).toBe("bot");
    }));

  it("editar_quadro com quem_fecha inválido é recusado", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "bot");
      const r = await lote(m.d, m.host, [{ tipo: "editar_quadro", quem_fecha: "ninguem" as never }]);
      expect(r.data.ok).toBe(false);
    }));

  it("com quem_fecha pessoa, o bot não move a Feito (a recusa diz o caminho)", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      const r = await lote(m.d, m.host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], m.comoAda);
      expect(r.data.ok).toBe(false);
      expect(JSON.stringify(r.data)).toMatch(/quem dá o Done é a pessoa/);
      expect(await m.status()).toBe("revisao");
    }));

  it("com quem_fecha pessoa, o terminei da última etapa pede o Done uma vez, sem mover", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      expect((await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda)).data.ok).toBe(true);
      expect(await m.status()).toBe("revisao");
      const [p, ...resto] = await m.pedidosDeDone();
      expect(resto).toEqual([]);
      expect(p?.estado).toBe("pendente");
      expect(p?.frase).toMatch(/está pronta para o Done$/);
      expect(p?.conversa_id).toBe(m.ada.conversaId);
      const msg = (await m.d.repos.mensagens.listarDaConversa(m.ada.conversaId)).find((x) => x.payload?.kind === "pedido_a_pessoa");
      expect(msg?.payload).toMatchObject({ opcoes: [DAR_DONE, expect.stringMatching(/^Voltar para /)] });
      // Idempotente: o segundo terminei não abre outro pedido.
      await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda);
      expect(await m.pedidosDeDone()).toHaveLength(1);
    }));

  it("Dar Done leva a tarefa a Feito e fecha o pedido", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda);
      const [p] = await m.pedidosDeDone();
      const fechada = await fecharComResposta(m.d, { decisaoId: p!.id, texto: DAR_DONE });
      await retomarComResposta(m.d, { decisao: fechada.data.decisao, texto: DAR_DONE, respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
      expect(await m.status()).toBe("feito");
      expect((await m.pedidosDeDone())[0]?.estado).toBe("decidida");
    }));

  it("outra resposta volta a tarefa à etapa anterior e vira comentário", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda);
      const [p] = await m.pedidosDeDone();
      const texto = "Falta o teste do logout";
      const fechada = await fecharComResposta(m.d, { decisaoId: p!.id, texto });
      await retomarComResposta(m.d, { decisao: fechada.data.decisao, texto, respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
      expect(await m.status()).not.toBe("revisao");
      expect(await m.status()).not.toBe("feito");
      const [c] = await trx<{ texto: string }[]>`select texto from quadro_comentarios where tarefa_id = ${m.tarefa.id} order by criado_em desc limit 1`;
      expect(c?.texto).toBe(texto);
    }));

  it("a pessoa leva a Feito pela tela: o pedido aberto se resolve", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda);
      expect((await lote(m.d, m.host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }])).data.ok).toBe(true);
      expect((await m.pedidosDeDone())[0]?.estado).toBe("decidida");
    }));

  it("com quem_fecha bot (o padrão), o terminei leva a Feito como antes e nada pede o Done", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "bot");
      expect((await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda)).data.ok).toBe(true);
      expect(await m.status()).toBe("feito");
      expect(await m.pedidosDeDone()).toEqual([]);
    }));
  it("excluir a tarefa com um pedido de Done não falha (a decisão perde a ligação)", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda);
      const [p] = await m.pedidosDeDone();
      expect(p).toBeDefined();
      const r = await lote(m.d, m.host, [{ tipo: "mudar_tarefa", tarefa: "Login", excluir: true }]);
      expect(r.data.ok).toBe(true);
      const [d] = await trx<{ tarefa_id: string | null }[]>`select tarefa_id from decisoes where id = ${p!.id}`;
      expect(d?.tarefa_id).toBeNull();
    }));

  it("remover o quadro com um pedido de Done aberto não falha", () =>
    withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pessoa");
      await lote(m.d, m.host, [{ tipo: "terminei", tarefa: "Login" }], m.comoAda);
      expect(await m.pedidosDeDone()).toHaveLength(1);
      const r = await lote(m.d, m.host, [{ tipo: "remover_quadro" }]);
      expect(r.data.ok).toBe(true);
    }));
});
