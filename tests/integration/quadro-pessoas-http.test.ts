import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasQuadro } from "../../src/adapters/http/rotas/quadro.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-443 (revisão 1 do PR #628): o quadro com várias pessoas pela rota HTTP, com as sessões de verdade (o Marlon é a dona,
 * a Ana participa). O que a rota recusa a quem não decide (achado 2) e o que o corpo não escolhe (achado 8).
 */

describeIntegracao("quadro com várias pessoas pela rota (NOD-443, revisão 1)", () => {
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
    // A Ana no time (identidade: só o dono escreve, fora do rollback; idempotente). Só ela: o Marlon (a dona) não
    // precisa da linha, e outros testes contam com ele sem nome em pessoas (conversas-passadas.test.ts).
    await dbDono`insert into tenants (id, nome) values (${ANA.tenantId}, 'Nod') on conflict do nothing`;
    await dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${ANA.tenantId}, ${ANA.pessoaId}, 'Ana', 'TT') on conflict do nothing`;
  });
  afterAll(() => servidor.close());

  const como = async (trx: Tx, e: Escopo): Promise<Deps> => {
    await vincularEscopo(trx, e);
    return depsSobreTrx(trx, e);
  };
  const lote = (d: Deps, anfitriaoId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId, executor: "catcher", ops });

  /** O quadro do Marlon (a Ada anfitriã, T1 da dona e "Da Ana" que a Ana pediu, as duas esperando quem decide). */
  async function montar(trx: Tx) {
    const sufixo = Math.random().toString(36).slice(2, 7);
    const da = await como(trx, ANA);
    await da.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const dd = await como(trx, MARLON);
    await dd.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const ada = await agenteComConversa(trx, MARLON, { nome: `Ada ${sufixo}` });
    const outro = await agenteComConversa(trx, MARLON, { nome: `Outro ${sufixo}` });
    expect((await lote(dd, ada.agenteId, [{ tipo: "criar_quadro", meta: "Lançar login" }, { tipo: "criar_tarefa", titulo: "T1" }])).data).toMatchObject({ ok: true });
    expect((await lote(dd, outro.agenteId, [{ tipo: "criar_quadro", meta: "Outro quadro" }])).data).toMatchObject({ ok: true });
    const pos = await lote(dd, ada.agenteId, [{ tipo: "adicionar_pessoa", pessoa: ANA.pessoaId }]);
    expect(pos.data, JSON.stringify(pos.data)).toMatchObject({ ok: true });
    const qid = (await dd.repos.quadros.doAgente(ada.agenteId))!.id;
    expect((await executar(await como(trx, ANA), aplicarLoteQuadro, { autor: { tipo: "pessoa" }, quadro: qid, executor: "catcher", ops: [{ tipo: "criar_tarefa", titulo: "Da Ana", status: "backlog" }] })).data).toMatchObject({ ok: true });
    const d2 = await como(trx, MARLON);
    // Merge da NOD-430: perguntar numa tarefa que não é do bot é do controle total (o que se prova aqui é quem decide).
    expect((await executar(d2, aplicarLoteQuadro, { autor: { tipo: "agente", agenteId: ada.agenteId }, anfitriaoId: ada.agenteId, executor: "catcher", limite: "total", ops: [{ tipo: "mudar_tarefa", tarefa: "Da Ana", status: "voce", pergunta: "Qual cor?" }, { tipo: "mudar_tarefa", tarefa: "T1", status: "voce", pergunta: "E aqui?" }] })).data).toMatchObject({ ok: true });
    const tarefas = await d2.repos.quadros.tarefas(qid);
    const id = (titulo: string) => tarefas.find((t) => t.titulo === titulo)!.id;
    return { ada, outro, qid, t1: id("T1"), daAna: id("Da Ana") };
  }

  const comTrx = (fn: (trx: Tx) => Promise<void>) =>
    withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      try {
        await fn(trx);
      } finally {
        trxAtual = null;
      }
    });

  it("achado 2: a dona não responde a pendência de quem participa, nem quem participa a da dona (403, nada muda)", async () => {
    await comTrx(async (trx) => {
      const m = await montar(trx);
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const r1 = await servidor.chamar(marlon, "POST", `/agentes/${m.ada.agenteId}/quadro/tarefas/${m.daAna}/resposta`, { resposta: "Azul" });
      expect(r1.status, await r1.clone().text()).toBe(403);
      const r2 = await servidor.chamar(ana, "POST", `/quadros/${m.qid}/tarefas/${m.t1}/resposta`, { resposta: "Sim" });
      expect(r2.status, await r2.clone().text()).toBe(403);
      const r3 = await servidor.chamar(ana, "PATCH", `/quadros/${m.qid}/tarefas/${m.t1}`, { status: "afazer" });
      expect(r3.status, await r3.clone().text()).toBe(403);
      const dd = await como(trx, MARLON);
      expect((await dd.repos.quadros.tarefas(m.qid)).filter((t) => t.status === "voce").map((t) => t.titulo).sort()).toEqual(["Da Ana", "T1"]);
      // Cada um responde a sua.
      expect((await servidor.chamar(ana, "POST", `/quadros/${m.qid}/tarefas/${m.daAna}/resposta`, { resposta: "Azul" })).status).toBe(200);
      expect((await servidor.chamar(marlon, "POST", `/agentes/${m.ada.agenteId}/quadro/tarefas/${m.t1}/resposta`, { resposta: "Sim" })).status).toBe(200);
    });
  });
  it("achado 8: o PATCH da tarefa lê só os campos da tarefa; o corpo não escolhe o anfitrião nem o quadro", async () => {
    await comTrx(async (trx) => {
      const m = await montar(trx);
      const ana = await servidor.entrar("ana");
      // A Ana manda um anfitriaoId (o bot de outro quadro da dona) no corpo: é ignorado, vale o quadro da URL.
      const r = await servidor.chamar(ana, "PATCH", `/quadros/${m.qid}/tarefas/${m.daAna}`, { titulo: "Da Ana (nova)", anfitriaoId: m.outro.agenteId, quadroId: m.outro.agenteId, executor: "local" });
      expect(r.status, await r.clone().text()).toBe(200);
      const dd = await como(trx, MARLON);
      expect((await dd.repos.quadros.tarefas(m.qid)).map((t) => t.titulo).sort()).toEqual(["Da Ana (nova)", "T1"]);
      const outro = (await dd.repos.quadros.doAgente(m.outro.agenteId))!;
      expect(await dd.repos.quadros.tarefas(outro.id)).toEqual([]);
    });
  });
  it("achado 11: a primeira pessoa e o modo escolhido vão num lote só; se ela não entra, o modo não muda; um Desfazer volta os dois", async () => {
    await comTrx(async (trx) => {
      const m = await montar(trx);
      const marlon = await servidor.entrar("marlon");
      const url = `/agentes/${m.outro.agenteId}/quadro/pessoas`;
      const doOutro = async () => {
        const dd = await como(trx, MARLON);
        const q = (await dd.repos.quadros.doAgente(m.outro.agenteId))!;
        return { modo: q.modoConversa, membros: (await dd.repos.quadros.membros(q.id)).map((x) => x.pessoaId) };
      };
      // Ninguém com esse nome: nada muda, nem o modo.
      const falha = await servidor.chamar(marlon, "POST", url, { pessoa: "Ninguém Daqui", modo: "so_dono" });
      expect(falha.status).not.toBe(200);
      expect(await doOutro()).toEqual({ modo: "individual", membros: [] });
      // A Ana com "só a dona": um lote, com os dois.
      const r = await servidor.chamar(marlon, "POST", url, { pessoa: "Ana", modo: "so_dono" });
      expect(r.status, await r.clone().text()).toBe(200);
      const corpo = (await r.json()) as { lote: { id: string; resumo: string } | null };
      expect(corpo.lote?.resumo).toContain("Só quem criou");
      expect(await doOutro()).toEqual({ modo: "so_dono", membros: [ANA.pessoaId] });
      const desfeito = await servidor.chamar(marlon, "POST", `/agentes/${m.outro.agenteId}/quadro/lotes/${corpo.lote!.id}/desfazer`);
      expect(desfeito.status, await desfeito.clone().text()).toBe(200);
      expect(await doOutro()).toEqual({ modo: "individual", membros: [] });
    });
  });
  it("revisão 2, achado 8: o quadro e a pessoa fora de uuid no caminho são 404 no roteador (o handler nem roda); com o id, a rota anda", async () => {
    await comTrx(async (trx) => {
      const m = await montar(trx);
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      for (const [quem, metodo, url] of [
        [ana, "GET", "/quadros/nao-e-uuid"],
        [ana, "GET", "/quadros/nao-e-uuid/atividade"],
        [ana, "POST", "/quadros/nao-e-uuid/comentarios"],
        [marlon, "DELETE", `/agentes/${m.ada.agenteId}/quadro/pessoas/Ana`],
      ] as const) {
        const r = await servidor.chamar(quem, metodo, url, metodo === "POST" ? { texto: "oi" } : undefined);
        expect(r.status, `${metodo} ${url}: ${await r.clone().text()}`).toBe(404);
      }
      const dd = await como(trx, MARLON);
      expect((await dd.repos.quadros.membros(m.qid)).map((x) => x.pessoaId)).toEqual([ANA.pessoaId]);
      const tirar = await servidor.chamar(marlon, "DELETE", `/agentes/${m.ada.agenteId}/quadro/pessoas/${ANA.pessoaId}`);
      expect(tirar.status, await tirar.clone().text()).toBe(200);
    });
  });
});
