import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { PrDaTarefa, PrLido } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { AVISO_SEM_CONEXAO } from "../../src/domain/prs-da-tarefa.ts";
import { definirDestinoDoLog } from "../../src/obs/log.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { sincronizarPrsDoQuadro } from "../../src/use-cases/prs-do-quadro.ts";
import { aplicarLoteQuadro, montarQuadro, resumoParaBot, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { fecharComResposta, retomarComResposta } from "../../src/use-cases/responder-decisao.ts";
import { DAR_DONE } from "../../src/use-cases/tarefa-casa.ts";

// 2ª revisão do PR #621: o espião só registra com que executor o caso de uso chama o lote; a chamada segue para o de verdade.
vi.mock("../../src/use-cases/quadro.ts", async (original) => {
  const m = await original<typeof import("../../src/use-cases/quadro.ts")>();
  return { ...m, aplicarLoteQuadro: vi.fn(m.aplicarLoteQuadro) };
});
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-421: os PRs que o laço lê do GitHub entram na tarefa, cada transição vira uma linha de sistema e o merge do último
 * PR leva a tarefa para Feito quando a coluna permite (senão só registra). O laço e o gh ficam no teste de unidade do
 * laço (FontePrs falsa); aqui o caso de uso no Postgres.
 */
const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-11-02T12:00:00Z");

const pr = (p: Partial<PrDaTarefa> = {}): PrDaTarefa => ({
  repo: "gamefik/nod", numero: 612, url: "https://github.com/gamefik/nod/pull/612", branch: "faustino/nod-421-pr-na-tarefa", estado: "aberto", ci: "pendente", conflito: false, ...p,
});

/** A tela não usa o branch (revisão do PR #621): o DTO sai sem ele. */
const naTela = ({ branch: _b, ...p }: PrDaTarefa) => p;

async function montar(trx: Tx, status = "fazendo", escopo: Escopo = MARLON) {
  const ana = await agenteComConversa(trx, escopo, { nome: `Ana ${Math.random().toString(36).slice(2, 7)}` });
  const { deps, repos } = depsSobre(trx, escopo, { agora: () => AGORA });
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const lote = (p: Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId: ana.agenteId, executor: "catcher", ...p });
  await lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "importar_linear", itens: [{ identificador: "NOD-421", titulo: "PR na tarefa" }, { identificador: "NOD-4", titulo: "Outra" }] }] });
  const q = (await repos.quadros.doAgente(ana.agenteId))!;
  const tarefa = (await repos.quadros.tarefas(q.id)).find((t) => t.linearId === "NOD-421")!;
  if (tarefa.status !== status) await lote({ ops: [{ tipo: "mudar_tarefa", tarefa: tarefa.id, status }] });
  const sync = (prs: PrLido[], aviso?: string | null, executor: "local" | "catcher" = "catcher") => sincronizarPrsDoQuadro(deps, { prs, executor, ...(aviso !== undefined ? { aviso } : {}) });
  const ver = async () => {
    const dto = await montarQuadro(deps, (await repos.quadros.buscar(q.id))!);
    return { dto, t: dto.tarefas.find((x) => x.id === tarefa.id)!, outra: dto.tarefas.find((x) => x.linearId === "NOD-4")! };
  };
  return { deps, repos, q, tarefa, sync, ver, lote, agenteId: ana.agenteId };
}

describeIntegracao("PRs na tarefa (NOD-421)", () => {
  it("PR com o id da tarefa no branch aparece na tarefa e no resumo do bot; o mesmo estado lido de novo não duplica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.sync([pr(), pr({ numero: 7, url: "https://github.com/gamefik/nod/pull/7", branch: "nod-42-x" })]);
      expect(r.data).toEqual({ ligados: 1, linhas: 1, movidas: 0 });
      expect(r.events?.map((e) => e.kind)).toEqual(["quadro_mudou"]);
      const { dto, t, outra } = await m.ver();
      expect(t.prs).toEqual([naTela(pr())]);
      expect(t.prs?.[0]).not.toHaveProperty("branch");
      expect(t.prUrl).toBe("https://github.com/gamefik/nod/pull/612");
      expect(t.linhas?.map((l) => l.texto)).toEqual(["GitHub · PR gamefik/nod #612 ligado"]);
      expect(outra.prs).toEqual([]);
      expect(resumoParaBot(dto).tarefas.find((x) => x.id === t.id)?.prs).toEqual(["gamefik/nod #612 · aberto · CI pendente"]);
      expect((await m.sync([pr()])).data).toEqual({ ligados: 0, linhas: 0, movidas: 0 });
    });
  });

  // QA do PR #702 (ADA-28, escopo E): o merge pede o Done com a tarefa ainda em Fazendo; "Dar Done" ia para a próxima
  // coluna (Revisando), não para Feito, e o pedido fechava sem a tarefa terminar.
  it("ADA-28: com quem_fecha pessoa, o merge em Fazendo pede o Done e Dar Done leva a Feito (não a Revisando)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote({ ops: [{ tipo: "editar_quadro", quem_fecha: "pessoa" }] })).data.ok).toBe(true);
      await m.sync([pr()]);
      expect((await m.sync([pr({ ci: "ok", estado: "mergeado" })])).data.movidas).toBe(0);
      expect((await m.ver()).t.status).toBe("fazendo");
      const [p, ...resto] = await trx<{ id: string }[]>`select id from decisoes where tarefa_id = ${m.tarefa.id} and tarefa_pede_done and estado = 'pendente'`;
      expect(resto).toEqual([]);
      const fechada = await fecharComResposta(m.deps, { decisaoId: p!.id, texto: DAR_DONE });
      await retomarComResposta(m.deps, { decisao: fechada.data.decisao, texto: DAR_DONE, respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
      expect((await m.ver()).t.status).toBe("feito");
    });
  });

  it("CI, conflito e merge viram linhas de sistema; com a tarefa em Fazendo o merge leva para Feito por um lote", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr()]);
      await m.sync([pr({ ci: "falhou" })]);
      await m.sync([pr({ ci: "ok", conflito: true })]);
      await m.sync([pr({ ci: "ok" })]);
      const r = await m.sync([pr({ ci: "ok", estado: "mergeado" })]);
      expect(r.data.movidas).toBe(1);
      expect(r.events?.map((e) => e.kind)).toContain("quadro_mudou");
      const { dto, t } = await m.ver();
      expect(t.status).toBe("feito");
      expect(dto.ultimoLote?.autor).toEqual({ tipo: "pessoa" });
      expect(t.linhas?.map((l) => l.texto)).toEqual([
        "GitHub · PR gamefik/nod #612 ligado",
        "GitHub · CI falhou no #612",
        "GitHub · CI ok no #612",
        "GitHub · conflito no #612",
        "GitHub · conflito resolvido no #612",
        "GitHub · #612 mergeado → Feito",
      ]);
      // O Desfazer do lote automático volta a tarefa; o mesmo merge lido de novo não a leva outra vez.
      await m.lote({ ops: [{ tipo: "desfazer" }] });
      expect((await m.sync([pr({ ci: "ok", estado: "mergeado" })])).data.movidas).toBe(0);
      expect((await m.ver()).t.status).toBe("fazendo");
    });
  });

  it("5ª revisão do PR #621: PR que já chega mergeado na primeira leitura é ligado, mas não leva a tarefa a Feito", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antigo = pr({ numero: 170, url: "https://github.com/gamefik/nod/pull/170", branch: "nod-421-antigo", estado: "mergeado", ci: "ok" });
      expect((await m.sync([antigo])).data).toEqual({ ligados: 1, linhas: 1, movidas: 0 });
      expect((await m.sync([antigo])).data).toEqual({ ligados: 0, linhas: 0, movidas: 0 });
      const { t } = await m.ver();
      expect(t.status).toBe("fazendo");
      expect(t.linhas?.map((l) => l.texto)).toEqual(["GitHub · PR gamefik/nod #170 ligado (mergeado)"]);
    });
  });

  it("5ª revisão do PR #621: PR antigo já mergeado + PR novo aberto: o merge novo do último move; o fechamento sem merge não", async () => {
    const antigo = pr({ numero: 170, url: "https://github.com/gamefik/nod/pull/170", branch: "nod-421-antigo", estado: "mergeado" });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([antigo, pr()]);
      expect((await m.sync([antigo, pr({ estado: "mergeado" })])).data.movidas).toBe(1);
      expect((await m.ver()).t.status).toBe("feito");
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([antigo, pr()]);
      // O merge antigo não ficou pendente (não foi observado): o PR novo fechado sem merge não completa a tarefa.
      expect((await m.sync([antigo, pr({ estado: "fechado" })])).data.movidas).toBe(0);
      expect((await m.ver()).t.status).toBe("fazendo");
    });
  });

  it("com dois PRs, fica até o segundo ser mergeado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "revisao");
      const outro = pr({ numero: 613, url: "https://github.com/gamefik/nod/pull/613", branch: "nod-421-parte-2" });
      await m.sync([pr(), outro]);
      expect((await m.sync([pr({ estado: "mergeado" }), outro])).data.movidas).toBe(0);
      expect((await m.ver()).t.status).toBe("revisao");
      expect((await m.sync([pr({ estado: "mergeado" }), { ...outro, estado: "mergeado" }])).data.movidas).toBe(1);
      expect((await m.ver()).t.status).toBe("feito");
    });
  });

  it("3ª revisão do PR #621: PR1 mergeado e PR2 fechado sem merge, a tarefa vai para Feito no fechamento (só na transição)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const outro = pr({ numero: 613, url: "https://github.com/gamefik/nod/pull/613", branch: "nod-421-parte-2" });
      await m.sync([pr(), outro]);
      expect((await m.sync([pr({ estado: "mergeado" }), outro])).data.movidas).toBe(0);
      expect((await m.ver()).t.status).toBe("fazendo");
      const r = await m.sync([pr({ estado: "mergeado" }), { ...outro, estado: "fechado" }]);
      expect(r.data.movidas).toBe(1);
      const { t } = await m.ver();
      expect(t.status).toBe("feito");
      expect(t.linhas?.at(-1)?.texto).toBe("GitHub · #613 fechado sem merge → Feito");
      // Só a transição move: desfeito, o mesmo estado lido de novo não leva a tarefa outra vez.
      await m.lote({ ops: [{ tipo: "desfazer" }] });
      expect((await m.sync([pr({ estado: "mergeado" }), { ...outro, estado: "fechado" }])).data.movidas).toBe(0);
      expect((await m.ver()).t.status).toBe("fazendo");
    });
  });

  it("4ª revisão do PR #621: PR1 mergeado com a tarefa em Backlog, a pessoa a põe em Fazendo e o PR2 fecha sem merge: não move", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "backlog");
      await m.sync([pr()]);
      expect((await m.sync([pr({ estado: "mergeado" })])).data.movidas).toBe(0);
      expect((await m.ver()).t.linhas?.at(-1)?.texto).toBe("GitHub · #612 mergeado · ficou em Backlog");
      await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tarefa.id, status: "fazendo" }] });
      const outro = pr({ numero: 613, url: "https://github.com/gamefik/nod/pull/613", branch: "nod-421-parte-2" });
      await m.sync([pr({ estado: "mergeado" }), outro]);
      // O merge antigo já teve desfecho (ficou em Backlog): o fechamento do PR2 não o reaproveita.
      expect((await m.sync([pr({ estado: "mergeado" }), { ...outro, estado: "fechado" }])).data.movidas).toBe(0);
      const { t } = await m.ver();
      expect(t.status).toBe("fazendo");
      expect(t.linhas?.at(-1)?.texto).toBe("GitHub · #613 fechado sem merge");
    });
  });

  it("4ª revisão do PR #621: o merge pendente (PR2 aberto) vale no fechamento mesmo com a tarefa movida de Backlog para Fazendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "backlog");
      const outro = pr({ numero: 613, url: "https://github.com/gamefik/nod/pull/613", branch: "nod-421-parte-2" });
      await m.sync([pr(), outro]);
      expect((await m.sync([pr({ estado: "mergeado" }), outro])).data.movidas).toBe(0);
      expect((await m.ver()).t.linhas?.at(-1)?.texto).toBe("GitHub · #612 mergeado");
      await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tarefa.id, status: "fazendo" }] });
      expect((await m.sync([pr({ estado: "mergeado" }), { ...outro, estado: "fechado" }])).data.movidas).toBe(1);
      expect((await m.ver()).t.status).toBe("feito");
    });
  });

  it("4ª revisão do PR #621: tirada de Feito à mão, a tarefa não volta pelo mesmo merge quando outro PR fecha sem merge", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr()]);
      expect((await m.sync([pr({ estado: "mergeado" })])).data.movidas).toBe(1);
      await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tarefa.id, status: "fazendo" }] });
      const outro = pr({ numero: 613, url: "https://github.com/gamefik/nod/pull/613", branch: "nod-421-parte-2" });
      // O PR2 aberto e fechado sem merge, e um PR3 que já chega fechado: nenhum dos dois leva a tarefa de volta.
      await m.sync([pr({ estado: "mergeado" }), outro]);
      expect((await m.sync([pr({ estado: "mergeado" }), { ...outro, estado: "fechado" }])).data.movidas).toBe(0);
      const terceiro = pr({ numero: 614, url: "https://github.com/gamefik/nod/pull/614", branch: "nod-421-parte-3", estado: "fechado" });
      expect((await m.sync([pr({ estado: "mergeado" }), { ...outro, estado: "fechado" }, terceiro])).data.movidas).toBe(0);
      expect((await m.ver()).t.status).toBe("fazendo");
    });
  });

  it("4ª revisão do PR #621: o lote para Feito não abre turno (a tarefa tem bot responsável)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "backlog");
      await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tarefa.id, agente: m.agenteId }] });
      await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tarefa.id, status: "fazendo" }] });
      await m.sync([pr()]);
      const contar = async () => (await trx<{ n: number }[]>`select count(*)::int as n from turnos`)[0]!.n;
      const antes = await contar();
      const espiao = vi.mocked(aplicarLoteQuadro);
      espiao.mockClear();
      const r = await m.sync([pr({ estado: "mergeado" })]);
      expect(r.data.movidas).toBe(1);
      expect((await m.ver()).t.status).toBe("feito");
      const lote = await espiao.mock.results[0]!.value;
      expect(lote.data).toMatchObject({ ok: true, comecaram: [] });
      expect(r.events?.map((e) => e.kind)).not.toContain("turno_criado");
      expect(await contar()).toBe(antes);
    });
  });

  it("2ª revisão do PR #621: o lote para Feito usa o executor do servidor, não o catcher fixo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr()]);
      const espiao = vi.mocked(aplicarLoteQuadro);
      espiao.mockClear();
      expect((await m.sync([pr({ estado: "mergeado" })], undefined, "local")).data.movidas).toBe(1);
      expect(espiao).toHaveBeenCalledTimes(1);
      expect(espiao.mock.calls[0]![1]).toMatchObject({ executor: "local", quadro: m.q.id });
    });
  });

  it("em Backlog ou Precisa de você o merge só registra; fechado sem merge não move", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "backlog");
      await m.sync([pr()]);
      expect((await m.sync([pr({ estado: "mergeado" })])).data.movidas).toBe(0);
      const { t } = await m.ver();
      expect(t.status).toBe("backlog");
      expect(t.linhas?.at(-1)?.texto).toBe("GitHub · #612 mergeado · ficou em Backlog");
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr()]);
      await m.sync([pr({ estado: "fechado" })]);
      const { t } = await m.ver();
      expect(t.status).toBe("fazendo");
      expect(t.linhas?.at(-1)?.texto).toBe("GitHub · #612 fechado sem merge");
    });
  });

  it("pr_url gravado pelo agente liga sem id no branch; experimento desligado não grava nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tarefa.id, pr_url: "https://github.com/gamefik/nod/pull/99" }] });
      await m.sync([pr({ numero: 99, url: "https://github.com/gamefik/nod/pull/99", branch: "sem-id" })]);
      expect((await m.ver()).t.prs?.map((p) => p.numero)).toEqual([99]);
      await m.repos.preferencias.gravar({ experimentos: { quadro: false } });
      expect((await m.sync([pr()])).data).toEqual({ ligados: 0, linhas: 0, movidas: 0 });
    });
  });

  it("revisão do PR #621: mergeable UNKNOWN mantém o conflito visto; conflito → UNKNOWN → conflito não gera linha falsa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr({ conflito: true })]);
      expect((await m.sync([{ ...pr(), conflito: null }])).data).toEqual({ ligados: 0, linhas: 0, movidas: 0 });
      expect((await m.sync([pr({ conflito: true })])).data).toEqual({ ligados: 0, linhas: 0, movidas: 0 });
      const { t } = await m.ver();
      expect(t.prs?.[0]?.conflito).toBe(true);
      expect(t.linhas?.map((l) => l.texto)).toEqual(["GitHub · PR gamefik/nod #612 ligado", "GitHub · conflito no #612"]);
    });
  });

  it("revisão do PR #621: tarefa movida para outro quadro não ganha pr_ligado de novo a cada volta (o PR segue a tarefa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr()]);
      const bia = await agenteComConversa(trx, MARLON, { nome: `Bia ${Math.random().toString(36).slice(2, 7)}` });
      await aplicarLoteQuadro(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: bia.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: "Outra meta" }] });
      const q2 = (await m.repos.quadros.doAgente(bia.agenteId))!;
      await trx`update quadro_tarefas set quadro_id = ${q2.id} where id = ${m.tarefa.id}`;
      for (let i = 0; i < 3; i++) expect((await m.sync([pr()])).data).toEqual({ ligados: 0, linhas: 0, movidas: 0 });
      expect((await m.sync([pr({ ci: "ok" })])).data).toEqual({ ligados: 0, linhas: 1, movidas: 0 });
      const [linha] = await trx<{ quadro_id: string }[]>`select quadro_id from quadro_tarefa_prs where tarefa_id = ${m.tarefa.id}`;
      expect(linha?.quadro_id).toBe(q2.id);
      const dto = await montarQuadro(m.deps, q2);
      const t = dto.tarefas.find((x) => x.id === m.tarefa.id)!;
      expect(t.prs?.map((p) => p.numero)).toEqual([612]);
      expect(t.linhas?.filter((l) => l.tipo === "pr_ligado")).toHaveLength(1);
    });
  });

  it("NOD-443 (revisão 5 do PR #628, achado 4): o aviso do GitHub é só da dona — quem participa não o vê, nem o bot dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([], "GitHub · sem acesso a gamefik/privado");
      const q = (await m.repos.quadros.buscar(m.q.id))!;
      expect((await montarQuadro(m.deps, q)).avisoGithub).toBe("GitHub · sem acesso a gamefik/privado");
      const daAna = await montarQuadro(m.deps, q, PESSOA_ANA);
      expect(daAna.avisoGithub).toBeNull();
      expect(resumoParaBot(daAna)).not.toHaveProperty("avisoGithub");
    });
  });

  it("NOD-443 (revisão 6 do PR #628, achado 6, decisão): os PRs e as linhas da tarefa são o estado dela no mural compartilhado — quem participa os vê; o aviso do GitHub não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr()], "GitHub · sem acesso a gamefik/privado");
      const q = (await m.repos.quadros.buscar(m.q.id))!;
      const daAna = await montarQuadro(m.deps, q, PESSOA_ANA);
      const t = daAna.tarefas.find((x) => x.id === m.tarefa.id)!;
      expect(t.prs).toEqual([naTela(pr())]);
      expect(t.linhas?.map((l) => l.texto)).toEqual(["GitHub · PR gamefik/nod #612 ligado"]);
      expect(daAna.avisoGithub).toBeNull();
    });
  });

  it("revisão do PR #621: o aviso do topo do quadro é gravado uma vez até mudar, vai ao bot e limpa com null", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.ver()).dto.avisoGithub).toBeNull();
      const r1 = await m.sync([], AVISO_SEM_CONEXAO);
      expect(r1.data.avisos).toBe(1);
      expect(r1.events?.map((e) => e.kind)).toEqual(["quadro_mudou"]);
      const { dto } = await m.ver();
      expect(dto.avisoGithub).toBe("GitHub não conectado no servidor: os PRs não sincronizam");
      expect(resumoParaBot(dto).avisoGithub).toBe(AVISO_SEM_CONEXAO);
      // Uma vez por quadro até mudar: a mesma volta repetida não grava nem avisa a tela.
      const r2 = await m.sync([], AVISO_SEM_CONEXAO);
      expect(r2.data.avisos).toBeUndefined();
      expect(r2.events ?? []).toEqual([]);
      // 404 num repo: troca o texto; o PR do outro repo segue ligando.
      const r3 = await m.sync([pr()], "GitHub · sem acesso a gamefik/privado");
      expect(r3.data).toMatchObject({ ligados: 1, avisos: 1 });
      expect((await m.ver()).dto.avisoGithub).toBe("GitHub · sem acesso a gamefik/privado");
      // Sem aviso (undefined) não mexe; null limpa.
      await m.sync([pr()]);
      expect((await m.ver()).dto.avisoGithub).toBe("GitHub · sem acesso a gamefik/privado");
      expect((await m.sync([], null)).data.avisos).toBe(1);
      const limpo = (await m.ver()).dto;
      expect(limpo.avisoGithub).toBeNull();
      expect(resumoParaBot(limpo)).not.toHaveProperty("avisoGithub");
    });
  });

  it("revisão do PR #621: o lote para Feito que falha vai para o log e a linha sai sem \"→ Feito\"", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.sync([pr()]);
      // O lote relê o experimento: desligado entre a leitura do caso de uso e o lote = o lote recusa.
      const pref = m.repos.preferencias;
      const real = pref.buscar.bind(pref);
      let chamadas = 0;
      pref.buscar = async () => { const v = await real(); if (chamadas++ > 0 && v.experimentos) v.experimentos.quadro = false; return v; };
      const linhas: string[] = [];
      definirDestinoDoLog((l) => linhas.push(l));
      try {
        expect((await m.sync([pr({ estado: "mergeado" })])).data).toEqual({ ligados: 0, linhas: 1, movidas: 0 });
      } finally {
        definirDestinoDoLog(null);
        pref.buscar = real;
      }
      const falhou = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.evento === "prs_do_quadro_lote_falhou");
      expect(falhou).toEqual([expect.objectContaining({ nivel: "aviso", quadro_id: m.q.id, tarefas: 1, erro: "experimento_desligado" })]);
      const { t } = await m.ver();
      expect(t.status).toBe("fazendo");
      expect(t.linhas?.at(-1)?.texto).toBe("GitHub · #612 mergeado");
    });
  });

  it("revisão do PR #621 (RLS): o laço de uma pessoa não lê nem grava as tarefas de outra pessoa nem de outro tenant", async () => {
    await withRollback(MARLON, async (trx) => {
      const marlon = await montar(trx);
      await marlon.sync([pr()], AVISO_SEM_CONEXAO);
      const contar = async () => (await trx<{ prs: number; linhas: number; quadros: number }[]>`
        select (select count(*)::int from quadro_tarefa_prs) as prs, (select count(*)::int from quadro_tarefa_linhas) as linhas,
               (select count(*)::int from quadros where aviso_github is not null) as quadros`)[0]!;
      const doMarlon = await contar();
      expect(doMarlon.prs).toBeGreaterThanOrEqual(1);

      // Ana, mesmo tenant: não enxerga o PR, a linha nem o aviso do quadro do Marlon; o mesmo PR liga só na tarefa dela.
      await vincularEscopo(trx, ANA);
      expect(await trx`select 1 from quadro_tarefa_prs where quadro_id = ${marlon.q.id}`).toHaveLength(0);
      expect(await trx`select 1 from quadros where id = ${marlon.q.id}`).toHaveLength(0);
      const ana = await montar(trx, "fazendo", ANA);
      expect(await ana.repos.quadros.prsDoQuadro(marlon.q.id)).toEqual([]);
      expect(await ana.repos.quadros.definirAvisoGithub(marlon.q.id, "invasão")).toBe(false);
      // 2ª revisão: gravar um PR NOVO na tarefa dele. Com `values` a Ana gravava o PR e a linha (owner dela, e a FK não
      // passa pelo RLS); o insert … select da tarefa da dona não grava nada. As linhas contam antes do retorno.
      const novo = pr({ numero: 777, url: "https://github.com/gamefik/nod/pull/777" });
      const gravouPr = await ana.repos.quadros.salvarPr(marlon.q.id, marlon.tarefa.id, novo);
      const gravouLinha = await ana.repos.quadros.inserirLinha(marlon.q.id, marlon.tarefa.id, { tipo: "pr_ligado", texto: "invasão", dados: {} });
      expect(await trx`select 1 from quadro_tarefa_prs where tarefa_id = ${marlon.tarefa.id}`).toHaveLength(0);
      expect(await trx`select 1 from quadro_tarefa_linhas where tarefa_id = ${marlon.tarefa.id}`).toHaveLength(0);
      expect([gravouPr, gravouLinha]).toEqual([false, false]);
      // O mesmo PR dele: também nada (antes o upsert esbarrava na linha dele e o RLS recusava com erro).
      expect(await ana.repos.quadros.salvarPr(marlon.q.id, marlon.tarefa.id, pr({ ci: "falhou" }))).toBe(false);
      expect((await ana.sync([pr({ ci: "falhou" })], null)).data).toMatchObject({ ligados: 1, linhas: 2 });

      // Outro tenant (a mesma pessoa, inclusive): nada aparece e nada é gravado.
      const OUTRO: Escopo = { tenantId: randomUUID(), pessoaId: PESSOA_MARLON };
      await vincularEscopo(trx, OUTRO);
      expect(await contar()).toEqual({ prs: 0, linhas: 0, quadros: 0 });
      const { deps: depsOutro, repos: reposOutro } = depsSobre(trx, OUTRO, { agora: () => AGORA });
      // 2ª revisão: com o experimento ligado no outro tenant (senão o caso de uso sai antes e o teste não prova nada).
      await reposOutro.preferencias.gravar({ experimentos: { quadro: true } });
      expect((await reposOutro.preferencias.buscar()).experimentos?.quadro).toBe(true);
      expect((await sincronizarPrsDoQuadro(depsOutro, { prs: [pr({ ci: "ok" })], aviso: null, executor: "catcher" })).data).toEqual({ ligados: 0, linhas: 0, movidas: 0 });
      expect(await reposOutro.quadros.salvarPr(marlon.q.id, marlon.tarefa.id, pr({ numero: 888, url: "https://github.com/gamefik/nod/pull/888" }))).toBe(false);
      expect(await reposOutro.quadros.inserirLinha(marlon.q.id, marlon.tarefa.id, { tipo: "pr_ligado", texto: "invasão", dados: {} })).toBe(false);
      expect(await contar()).toEqual({ prs: 0, linhas: 0, quadros: 0 });

      // De volta ao Marlon: tudo dele como estava (o CI falhou da Ana não entrou, o aviso não foi limpo).
      await vincularEscopo(trx, MARLON);
      expect(await contar()).toEqual(doMarlon);
      const { dto, t } = await marlon.ver();
      expect(dto.avisoGithub).toBe(AVISO_SEM_CONEXAO);
      expect(t.prs?.[0]?.ci).toBe("pendente");
      expect(t.linhas?.map((l) => l.texto)).toEqual(["GitHub · PR gamefik/nod #612 ligado"]);
    });
  });
});
