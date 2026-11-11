import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasQuadro } from "../../src/adapters/http/rotas/quadro.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { PassosDoRunDto } from "../../src/contracts/quadro-comentarios.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-165: GET /agentes/:id/quadro/tarefas/:tid/runs/:turno/passos?depois=<seq> — os passos persistidos de um run da
 * tarefa, paginados. Turno que não é run desta tarefa: 404.
 */
describeIntegracao("rota dos passos do run da tarefa (ADR-165)", () => {
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

  /** A Ana com um quadro de duas tarefas do Beto; cada tarefa em A fazer abre um trabalho (o run, o turno raiz). */
  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
    await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
    const r = await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: ana.agenteId, executor: "catcher", ops: [
      { tipo: "criar_quadro" },
      { tipo: "criar_tarefa", titulo: "T", status: "afazer", agente: `Beto ${sufixo}` },
      { tipo: "criar_tarefa", titulo: "U", status: "afazer", agente: `Beto ${sufixo}` },
    ] });
    expect(r.data).toMatchObject({ ok: true });
    const q = await d.repos.quadros.doAgente(ana.agenteId);
    const tarefas = await d.repos.quadros.tarefas(q!.id);
    const t = tarefas.find((x) => x.titulo === "T")!;
    const u = tarefas.find((x) => x.titulo === "U")!;
    expect(t.turnoId && u.turnoId).toBeTruthy();
    return { d, ana, t: { id: t.id, turno: t.turnoId! }, u: { id: u.id, turno: u.turnoId! } };
  }

  const passo = (resumo: string) => ({ tipo: "ferramenta" as const, classe: "comando" as const, ferramenta: "Bash", rotulo: "Rodou um comando", resumo, acaoId: null, falhou: false });

  it("200 com os passos do run, paginados por `depois`; turno de outra tarefa ou que não existe: 404; `depois` torto: 400", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      try {
        const m = await montar(trx);
        const gravados = await m.d.repos.turnoPassos.gravar(m.t.turno, [passo("git status"), passo("npm test")]);
        await m.d.repos.turnoPassos.gravar(m.u.turno, [passo("da outra tarefa")]);
        const sessao = await servidor.entrar("marlon");
        const base = `/agentes/${m.ana.agenteId}/quadro/tarefas/${m.t.id}/runs`;

        const r = await servidor.chamar(sessao, "GET", `${base}/${m.t.turno}/passos`);
        expect(r.status).toBe(200);
        const corpo = (await r.json()) as PassosDoRunDto;
        expect(corpo.fim).toBe(true);
        expect(corpo.passos.map((p) => [p.resumo, p.classe, p.ferramenta])).toEqual([["git status", "comando", "Bash"], ["npm test", "comando", "Bash"]]);

        const depois = (await (await servidor.chamar(sessao, "GET", `${base}/${m.t.turno}/passos?depois=${gravados[0]!.seq}`)).json()) as PassosDoRunDto;
        expect(depois.passos.map((p) => p.resumo)).toEqual(["npm test"]);

        // O run da tarefa U não é desta tarefa: 404 (nem o resumo dele vaza).
        const outra = await servidor.chamar(sessao, "GET", `${base}/${m.u.turno}/passos`);
        expect(outra.status).toBe(404);
        expect(await outra.text()).not.toContain("da outra tarefa");
        expect((await servidor.chamar(sessao, "GET", `${base}/00000000-0000-4000-8000-000000000000/passos`)).status).toBe(404);
        expect((await servidor.chamar(sessao, "GET", `${base}/nao-e-uuid/passos`)).status).toBe(404);
        expect((await servidor.chamar(sessao, "GET", `${base}/${m.t.turno}/passos?depois=abc`)).status).toBe(400);
        // Pela tarefa U, o run dela responde.
        const pelaU = (await (await servidor.chamar(sessao, "GET", `/agentes/${m.ana.agenteId}/quadro/tarefas/${m.u.id}/runs/${m.u.turno}/passos`)).json()) as PassosDoRunDto;
        expect(pelaU.passos.map((p) => p.resumo)).toEqual(["da outra tarefa"]);
      } finally {
        trxAtual = null;
      }
    });
  });
});
