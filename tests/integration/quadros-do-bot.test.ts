import { afterEach, expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { QUADROS_PARA_TODOS } from "../../src/domain/flag-quadros.ts";
import { configurarLiberacaoQuadrosN } from "../../src/repositories/raio-x.repo.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assumirPelaTela, previaAssumir } from "../../src/use-cases/assumir-quadro.ts";
import { verComentarios } from "../../src/use-cases/comentar-tarefa.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { conferirPreviaDaTela } from "../../src/use-cases/importar-linear.ts";
import { proporExclusaoDoQuadro } from "../../src/use-cases/quadro-exclusao.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro, historicoDaTarefa } from "../../src/use-cases/quadro.ts";
import { verTrabalhos } from "../../src/use-cases/quadro-execucoes.ts";
import { aplicarQuadrosDoBot, quadrosDoBot } from "../../src/use-cases/quadros-do-bot.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const s = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${s}` });
  const gil = await agenteComConversa(trx, MARLON, { nome: `Gil ${s}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const pessoa = (anfitriaoId: string, ops: OpQuadro[], quadroDoBot?: string) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId, executor: "catcher", ops, ...(quadroDoBot ? { quadroDoBot } : {}) });
  return { ana: ana.agenteId, gil: gil.agenteId, anaConversa: ana.conversaId, nomeAna: `Ana ${s}`, nomeGil: `Gil ${s}`, deps, repos, pessoa };
}

async function turnoDe(d: Deps, agenteId: string, conversaId: string, origem: "conversa" | "delegacao" = "conversa") {
  const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: origem === "conversa" ? 0 : 1, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  if (!t) throw new Error("turno");
  return { turnoId: t.id, agenteId, conversaId };
}

/** ADA-14 (ADR-153): os N quadros de um bot pelo lote, pela tela e pelo gerir_quadro. */
describeIntegracao("quadros do bot: caso de uso (ADA-14)", () => {
  afterEach(() => configurarLiberacaoQuadrosN(QUADROS_PARA_TODOS));

  it("criar_quadro com nome novo cria o 2º quadro; sem nome segue o de sempre; o nome repetido recusa; a flag desligada recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }])).data).toMatchObject({ ok: true });
      expect((await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: "x", prazo: null }])).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      const segundo = await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Site" }, { tipo: "criar_tarefa", titulo: "Home" }]);
      expect(segundo.data).toMatchObject({ ok: true });
      const qs = await m.repos.quadros.vinculadosAo(m.ana);
      expect(qs.map((q) => [q.nome, q.padrao])).toEqual([[null, true], ["Site", false]]);
      expect((await m.repos.quadros.tarefas(qs[1]!.id)).map((t) => t.titulo)).toEqual(["Home"]);
      expect((await m.repos.quadros.tarefas(qs[0]!.id))).toHaveLength(0);
      const repetido = await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "site" }]);
      expect(repetido.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      configurarLiberacaoQuadrosN({ modo: "desligado", admins: [] });
      const { deps } = depsSobre(trx, MARLON);
      const semFlag = await aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Blog" }] });
      expect(semFlag.data).toMatchObject({ ok: false, erro: "nao_permitido" });
      expect(await m.repos.quadros.vinculadosAo(m.ana)).toHaveLength(2);
    });
  });

  it("o lote acha o quadro pelo nome e por 'Bot / Quadro'; a tela escolhe pelo ?quadro=; editar_quadro renomeia e põe no projeto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Site" }]);
      const site = (await m.repos.quadros.vinculadosAo(m.ana)).find((q) => q.nome === "Site")!;
      const doBot = await aplicarLoteQuadro(m.deps, { autor: { tipo: "agente", agenteId: m.gil }, quadro: `${m.nomeAna} / Site`, executor: "catcher", limite: "total", ops: [{ tipo: "criar_tarefa", titulo: "Pelo rótulo" }] });
      expect(doBot.data).toMatchObject({ ok: true });
      const peloNome = await aplicarLoteQuadro(m.deps, { autor: { tipo: "agente", agenteId: m.ana }, quadro: "Site", executor: "catcher", limite: "total", ops: [{ tipo: "criar_tarefa", titulo: "Pelo nome" }] });
      expect(peloNome.data).toMatchObject({ ok: true });
      expect((await m.pessoa(m.ana, [{ tipo: "criar_tarefa", titulo: "Pela tela" }], site.id)).data).toMatchObject({ ok: true });
      expect((await m.repos.quadros.tarefas(site.id)).map((t) => t.titulo).sort()).toEqual(["Pela tela", "Pelo nome", "Pelo rótulo"]);

      const proj = await aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, op: { tipo: "criar_projeto", nome: "Lançamento" } });
      expect(proj.data).toMatchObject({ ok: true });
      expect((await m.pessoa(m.ana, [{ tipo: "editar_quadro", projeto: "Inexistente" }], site.id)).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      expect((await m.pessoa(m.ana, [{ tipo: "editar_quadro", nome: "Tarefas" }], site.id)).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      const ed = await m.pessoa(m.ana, [{ tipo: "editar_quadro", nome: "Site novo", projeto: "lancamento" }], site.id);
      expect(ed.data).toMatchObject({ ok: true, quadro: { nome: "Site novo" } });
      expect(await m.repos.quadros.buscar(site.id)).toMatchObject({ nome: "Site novo", projetoId: proj.data.ok ? proj.data.projeto!.id : "" });
      // O padrão (o sem nome) segue intacto.
      expect((await m.repos.quadros.doAgente(m.ana))?.nome).toBeNull();
    });
  });

  it("vincular põe o quadro em outro bot; desvincular o dono passa o dono; o último bot não sai; o padrão é reposto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      const op = (o: Parameters<typeof aplicarQuadrosDoBot>[1]["op"]) => aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, op: o });
      { const v = await op({ tipo: "vincular_bot", quadro: q.id, bot: m.nomeGil }); expect(v.data, JSON.stringify(v.data)).toMatchObject({ ok: true }); }
      expect((await op({ tipo: "vincular_bot", quadro: q.id, bot: m.nomeGil })).data).toMatchObject({ ok: true, instrucao: expect.stringContaining("Nada mudou") });
      expect((await m.repos.quadros.doBot(m.gil, q.id))?.id).toBe(q.id);
      const dto = await quadrosDoBot(m.deps, m.gil);
      expect(dto.quadros[0]!.bots.map((b) => [b.id, b.dono]).sort()).toEqual([[m.ana, true], [m.gil, false]].sort());
      expect((await op({ tipo: "desvincular_bot", quadro: q.id, bot: m.nomeAna })).data).toMatchObject({ ok: true });
      expect((await m.repos.quadros.buscar(q.id))?.agenteId).toBe(m.gil);
      expect(await m.repos.quadros.doBot(m.ana, q.id)).toBeNull();
      expect((await op({ tipo: "desvincular_bot", quadro: q.id, bot: m.nomeGil })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await m.repos.quadros.doAgente(m.gil))?.id).toBe(q.id);
    });
  });

  it("excluir o bot dono passa o dono ao próximo vínculo: o quadro compartilhado segue na lista e no outro bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Só da Ana" }]);
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      const so = (await m.repos.quadros.vinculadosAo(m.ana)).find((x) => x.nome === "Só da Ana")!;
      await aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, op: { tipo: "vincular_bot", quadro: q.id, bot: m.nomeGil } });
      await gerirAgente(m.deps, { agenteId: m.ana, acao: "excluir" });
      expect((await m.repos.quadros.buscar(q.id))?.agenteId).toBe(m.gil);
      expect((await m.repos.quadros.listar()).map((x) => x.id)).toContain(q.id);
      expect((await m.repos.quadros.doAgente(m.gil))?.id).toBe(q.id);
      // O quadro só dela segue dela (volta com o restaurar).
      expect((await m.repos.quadros.buscar(so.id))?.agenteId).toBe(m.ana);
    });
  });

  it("o Assumir e a importação do Linear pela tela agem no quadro aberto (?quadro=), não no padrão", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Site" }]);
      const padrao = (await m.repos.quadros.doAgente(m.ana))!;
      const site = (await m.repos.quadros.vinculadosAo(m.ana)).find((q) => q.nome === "Site")!;
      const assumiu = await assumirPelaTela(m.deps, { anfitriaoId: m.ana, quadroDoBot: site.id, rotinas: [] });
      expect(assumiu.data).toMatchObject({ ok: true });
      expect(await m.repos.quadroImportacoes.assumido(site.id)).toBeTruthy();
      expect(await m.repos.quadroImportacoes.assumido(padrao.id)).toBeFalsy();
      expect((await previaAssumir(m.deps, { agenteId: m.ana, quadro: site.id })).data).toMatchObject({ ok: true, assumidoEm: expect.any(Number) });
      expect((await previaAssumir(m.deps, { agenteId: m.ana })).data).toMatchObject({ ok: true, assumidoEm: null });
      // A importação no quadro que assumiu recusa; no padrão segue (para adiante, sem o Linear neste servidor).
      const noSite = (await conferirPreviaDaTela(m.deps, { agenteId: m.ana, quadro: site.id, time: "NOD", filtro: null })).data;
      expect(noSite).toMatchObject({ ok: false, detalhe: expect.stringContaining("assumiu") });
      const noPadrao = (await conferirPreviaDaTela(m.deps, { agenteId: m.ana, time: "NOD", filtro: null })).data;
      expect(JSON.stringify(noPadrao)).not.toContain("assumiu");
    });
  });

  it("vincular_bot respeita a flag NOD_QUADROS_N (ADR-153 §7): desligada, recusa e não vincula", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      configurarLiberacaoQuadrosN({ modo: "desligado", admins: [] });
      const r = await aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, op: { tipo: "vincular_bot", quadro: q.id, bot: m.nomeGil } });
      expect(r.data).toMatchObject({ ok: false, erro: "nao_permitido" });
      expect(await m.repos.quadros.doBot(m.gil, q.id)).toBeNull();
    });
  });

  it("vincular_bot num quadro de antes (sem linha em quadro_bots) mantém o dono no quadro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // O servidor de antes (entre a 0152 e a troca) cria o quadro sem a linha do dono.
      await trx`insert into quadros (tenant_id, owner_id, agente_id) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${m.ana})`;
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      expect((await m.repos.quadros.doAgente(m.ana))?.id).toBe(q.id);
      const op = (o: Parameters<typeof aplicarQuadrosDoBot>[1]["op"]) => aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, op: o });
      expect((await op({ tipo: "vincular_bot", quadro: q.id, bot: m.nomeGil })).data).toMatchObject({ ok: true });
      expect((await m.repos.quadros.doAgente(m.ana))?.id).toBe(q.id);
      expect((await m.repos.quadros.doBot(m.gil, q.id))?.id).toBe(q.id);
      expect((await m.repos.quadros.vinculos(q.id)).map((v) => v.agenteId).sort()).toEqual([m.ana, m.gil].sort());
    });
  });

  it("desvincular o dono único de um quadro de antes (sem linha) recusa como o último bot, sem dizer que não estava", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`insert into quadros (tenant_id, owner_id, agente_id) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${m.ana})`;
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      const r = await aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, op: { tipo: "desvincular_bot", quadro: q.id, bot: m.nomeAna } });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
    });
  });

  it("o card de excluir diz qual dos quadros do bot sai (o nome no payload e na frase da decisão)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Site" }]);
      const ctx = await turnoDe(m.deps, m.ana, m.anaConversa);
      const r = await proporExclusaoDoQuadro(m.deps, { ...ctx, executor: "catcher", quadro: `${m.nomeAna} / Site`, bot: m.nomeAna, naConversa: true, limpo: true });
      expect(r.data).toMatchObject({ ok: true, payload: { quadroNome: "Site" } });
      const id = r.data.ok ? r.data.propostaId : "";
      expect((await m.repos.decisoes.buscar(id))?.frase).toContain(`Excluir o quadro "Site" do ${m.nomeAna}`);
    });
  });

  it("projetos: nome único entre ativos; arquivar deixa os quadros; restaurar com nome em uso recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const op = (o: Parameters<typeof aplicarQuadrosDoBot>[1]["op"]) => aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, op: o });
      const nome = `Proj ${Math.random().toString(36).slice(2, 6)}`;
      expect((await op({ tipo: "criar_projeto", nome })).data).toMatchObject({ ok: true });
      expect((await op({ tipo: "criar_projeto", nome: nome.toUpperCase() })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await op({ tipo: "editar_projeto", projeto: nome, meta: "Lançar" })).data).toMatchObject({ ok: true, projeto: { meta: "Lançar" } });
      expect((await op({ tipo: "arquivar_projeto", projeto: nome })).data).toMatchObject({ ok: true });
      expect((await op({ tipo: "criar_projeto", nome })).data).toMatchObject({ ok: true });
      const arquivado = (await m.repos.projetos.listar()).find((p) => p.nome === nome && p.arquivadoEm !== null)!;
      expect((await op({ tipo: "restaurar_projeto", projeto: arquivado.id })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
    });
  });

  it("gerir_quadro: listar_quadros lê; vincular_bot só num turno da pessoa; a op dos quadros vai sozinha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      const ctx = await turnoDe(m.deps, m.ana, m.anaConversa);
      const lista = await gerirQuadro(m.deps, { ...ctx, acoes: [{ tipo: "listar_quadros" }] as never });
      expect(lista.data).toMatchObject({ ok: true, quadros_do_bot: { quadros: [{ nome: "Tarefas", padrao: true }] } });
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      const juntas = await gerirQuadro(m.deps, { ...ctx, acoes: [{ tipo: "listar_quadros" }, { tipo: "criar_tarefa", titulo: "x" }] as never });
      expect(juntas.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      const tarefa = await turnoDe(m.deps, m.ana, m.anaConversa, "delegacao");
      const negado = await gerirQuadro(m.deps, { ...tarefa, acoes: [{ tipo: "vincular_bot", quadro: q.id, bot: m.nomeGil }] as never });
      expect(negado.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(await m.repos.quadros.doBot(m.gil, q.id)).toBeNull();
      const ok = await gerirQuadro(m.deps, { ...ctx, acoes: [{ tipo: "vincular_bot", quadro: "Tarefas", bot: m.nomeGil }] as never });
      expect(ok.data).toMatchObject({ ok: true });
      expect((await m.repos.quadros.doBot(m.gil, q.id))?.id).toBe(q.id);
      const abrir = await gerirQuadro(m.deps, { ...ctx, acoes: [{ tipo: "abrir_quadro", quadro: q.id }] as never });
      expect(abrir.data).toMatchObject({ ok: true, quadro_id: q.id });
      expect(await m.repos.preferencias.quadroAberto(m.ana)).toBe(q.id);
    });
  });

  it("QA: desvincular do quadro padrão passa o padrão do bot ao outro quadro dele (não fica sem padrão)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Site" }]);
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      const site = (await m.repos.quadros.vinculadosAo(m.ana)).find((x) => x.nome === "Site")!;
      const op = (o: Parameters<typeof aplicarQuadrosDoBot>[1]["op"]) => aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, op: o });
      expect((await op({ tipo: "vincular_bot", quadro: q.id, bot: m.nomeGil })).data).toMatchObject({ ok: true });
      expect((await op({ tipo: "desvincular_bot", quadro: q.id, bot: m.nomeAna })).data).toMatchObject({ ok: true });
      expect((await m.repos.quadros.vinculadosAo(m.ana)).map((x) => [x.id, x.padrao])).toEqual([[site.id, true]]);
    });
  });

  it("QA: excluir o dono não passa o quadro a um bot já excluído (o próximo vínculo vivo fica com ele)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const ze = await agenteComConversa(trx, MARLON, { nome: `Zé ${Math.random().toString(36).slice(2, 7)}` });
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      const op = (bot: string) => aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ana, op: { tipo: "vincular_bot", quadro: q.id, bot } });
      const nomeZe = (await m.repos.agentes.buscar(ze.agenteId))!.nome;
      expect((await op(m.nomeGil)).data).toMatchObject({ ok: true });
      expect((await op(nomeZe)).data).toMatchObject({ ok: true });
      // Exclui primeiro quem seria o próximo dono (a ordem empata no mesmo instante e cai no id): o outro fica com o quadro.
      const [prox, outro] = (await m.repos.quadros.vinculos(q.id)).filter((v) => v.agenteId !== m.ana).map((v) => v.agenteId);
      await gerirAgente(m.deps, { agenteId: prox!, acao: "excluir" });
      await gerirAgente(m.deps, { agenteId: m.ana, acao: "excluir" });
      expect((await m.repos.quadros.buscar(q.id))?.agenteId).toBe(outro);
    });
  });

  it("QA: comentários, trabalhos e histórico da tarefa só pelo bot em que o quadro dela está", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null }]);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: null, prazo: null, nome: "Site" }]);
      const site = (await m.repos.quadros.vinculadosAo(m.ana)).find((x) => x.nome === "Site")!;
      await m.pessoa(m.ana, [{ tipo: "criar_tarefa", titulo: "No site", status: "backlog" }], site.id);
      const tarefaId = (await m.repos.quadros.tarefas(site.id))[0]!.id;
      expect((await verComentarios(m.deps, { agenteId: m.ana, tarefaId })).data.comentarios).toEqual([]);
      expect((await verTrabalhos(m.deps, { agenteId: m.ana, tarefaId })).data).toBeTruthy();
      expect((await historicoDaTarefa(m.deps, { agenteId: m.ana, tarefaId })).data.historico.length).toBeGreaterThan(0);
      await expect(verComentarios(m.deps, { agenteId: m.gil, tarefaId })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      await expect(verTrabalhos(m.deps, { agenteId: m.gil, tarefaId })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      await expect(historicoDaTarefa(m.deps, { agenteId: m.gil, tarefaId })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("QA: editar_quadro com nome e projeto entra no lote, e o Desfazer volta o nome e o projeto (plano §4.2: com Desfazer)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pessoa(m.ana, [{ tipo: "criar_quadro", meta: "Lançar", prazo: null, nome: "Site" }]);
      const q = (await m.repos.quadros.doAgente(m.ana))!;
      const proj = await aplicarQuadrosDoBot(m.deps, { autor: { tipo: "pessoa" }, op: { tipo: "criar_projeto", nome: `Lanç ${Math.random().toString(36).slice(2, 6)}` } });
      const projeto = proj.data.ok ? proj.data.projeto! : null;
      // Só o nome: um lote, e o Desfazer o volta.
      const so = await m.pessoa(m.ana, [{ tipo: "editar_quadro", nome: "Loja" }]);
      expect(so.data).toMatchObject({ ok: true, quadro: { nome: "Loja" }, lote: { id: expect.any(String) } });
      expect((await m.pessoa(m.ana, [{ tipo: "desfazer" }])).data).toMatchObject({ ok: true, desfeito: true });
      expect((await m.repos.quadros.buscar(q.id))?.nome).toBe("Site");
      // A meta, o nome e o projeto juntos: o Desfazer volta os três.
      expect((await m.pessoa(m.ana, [{ tipo: "editar_quadro", meta: "Outra", nome: "Loja", projeto: projeto!.nome }])).data).toMatchObject({ ok: true });
      expect(await m.repos.quadros.buscar(q.id)).toMatchObject({ meta: "Outra", nome: "Loja", projetoId: projeto!.id });
      expect((await m.pessoa(m.ana, [{ tipo: "desfazer" }])).data).toMatchObject({ ok: true, desfeito: true });
      expect(await m.repos.quadros.buscar(q.id)).toMatchObject({ meta: "Lançar", nome: "Site", projetoId: null });
      // O mesmo nome de agora não abre lote.
      expect((await m.pessoa(m.ana, [{ tipo: "editar_quadro", nome: "Site" }])).data).toMatchObject({ ok: true, lote: null });
    });
  });
});
