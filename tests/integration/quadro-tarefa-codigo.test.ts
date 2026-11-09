import { expect, it, vi } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { SQL_MUDOU_DE_QUADRO_DEPOIS } from "../../src/repositories/quadros.repo.ts";
import { comentarTarefa, verComentarios } from "../../src/use-cases/comentar-tarefa.ts";
import type { IssueLinear } from "../../src/contracts/quadro-importacao.ts";
import { aplicarImportacao, iniciarImportacao } from "../../src/use-cases/importar-linear.ts";
import { aplicarLoteQuadro, historicoDaTarefa, listarQuadros, montarQuadro, verTarefaPorCodigo, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-416 (ADR-144): criar uma tarefa e encontrá-la no quadro. A tarefa nasce no Backlog sem acionar ninguém, ganha o
 * código do quadro (ZE-1), o histórico diz quem mudou o quê (pessoa, bot ou regra) e ela muda de quadro levando o
 * histórico, com o link antigo ainda abrindo.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-02T12:00:00Z");

async function montar(trx: Tx) {
  // Nomes com letras únicas por teste: o prefixo sai das 3 primeiras letras (e o banco de teste pode ter outros quadros).
  const sufixo = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 3).padEnd(3, "x");
  const zeNome = `Zq${sufixo}`;
  const maNome = `Mq${sufixo}`;
  const ze = await agenteComConversa(trx, MARLON, { nome: zeNome });
  const ma = await agenteComConversa(trx, MARLON, { nome: maNome });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const lote = (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, executor: "catcher", ...p });
  const ok = async (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => {
    const r = await lote(p);
    if (!r.data.ok) throw new Error(r.data.detalhe);
    return r.data;
  };
  return { ze, ma, zeNome, maNome, deps, repos, lote, ok };
}

describeIntegracao("tarefa: código, histórico e mover de quadro (NOD-416)", () => {
  it("criar pela tela (pessoa) e pela conversa (bot) sem status: Backlog, sem turno, código do quadro em sequência", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const criado = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const prefixo = criado.quadro!.prefixo!;
      expect(prefixo).toMatch(/^ZQ[A-Z]$/);
      // Pela tela: a rota manda criar_tarefa com o título só.
      const tela = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "Corrigir o login do Mac", agente: m.maNome }] });
      // Pela conversa: o bot chama gerir_quadro.
      const chat = await m.ok({ autor: { tipo: "agente", agenteId: m.ma.agenteId }, quadro: m.zeNome, autorNaConversa: true, ops: [{ tipo: "criar_tarefa", titulo: "Revisar copy", agente: m.maNome }] });
      for (const r of [tela, chat]) expect(r.comecaram).toEqual([]);
      const tarefas = chat.quadro!.tarefas;
      expect(tarefas.map((t) => [t.titulo, t.status, t.agenteNome, t.turnoId, t.codigo])).toEqual([
        ["Corrigir o login do Mac", "backlog", m.maNome, null, `${prefixo}-1`],
        ["Revisar copy", "backlog", m.maNome, null, `${prefixo}-2`],
      ]);
      expect(await trx`select 1 from turnos where agente_id = ${m.ma.agenteId} and origem = 'delegacao'`).toHaveLength(0);
      expect(tarefas[0]!.branch).toBe(`${prefixo.toLowerCase()}-1-corrigir-o-login-do-mac`);
      // O código fica guardado e resolve.
      expect((await verTarefaPorCodigo(m.deps, { codigo: `${prefixo.toLowerCase()}-2` })).data).toMatchObject({ tarefaId: tarefas[1]!.id, agenteId: m.ze.agenteId, codigoAtual: `${prefixo}-2` });
      // O bot também lê o código no resumo.
      const h = (await historicoDaTarefa(m.deps, { agenteId: m.ze.agenteId, tarefaId: tarefas[1]!.id })).data.historico;
      expect(h.map((x) => [x.campo, x.paraNome, x.autor, x.autorNome])).toEqual([["criada", "Backlog", "agente", m.maNome], ["agente", m.maNome, "agente", m.maNome]]);
    });
  });

  it("revisão 2 do PR #623: sem status, a tarefa nasce na espera que não aciona, mesmo com A fazer antes do Backlog", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "mover_coluna", coluna: "afazer", antes_de: "backlog" }] });
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "T", agente: m.maNome }] });
      expect(r.comecaram).toEqual([]);
      expect(r.quadro!.tarefas[0]).toMatchObject({ status: "backlog", turnoId: null });
      expect(await trx`select 1 from turnos where agente_id = ${m.ma.agenteId} and origem = 'delegacao'`).toHaveLength(0);
    });
  });

  it("revisão 2 do PR #623: sem coluna de espera que não aciona (Backlog removido, ou só andamento), cria sem iniciar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "remover_coluna", coluna: "backlog", destino: "afazer" }] });
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "T", agente: m.maNome }] });
      expect(r.comecaram).toEqual([]);
      expect(r.quadro!.tarefas[0]).toMatchObject({ status: "afazer", turnoId: null });
      // Só colunas de andamento da pessoa: nasce na primeira, sem turno.
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "substituir_colunas", colunas: [{ nome: "Produção", grupo: "iniciado" }, { id: "voce", nome: "Precisa de você", grupo: "iniciado" }, { nome: "Entregue", grupo: "feito" }, { id: "cancelado", nome: "Cancelado", grupo: "fechado" }] }] });
      const r2 = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "U", agente: m.zeNome }] });
      expect(r2.comecaram).toEqual([]);
      expect(r2.quadro!.tarefas[0]).toMatchObject({ turnoId: null });
      expect(await trx`select 1 from turnos where origem = 'delegacao' and agente_id in (${m.ma.agenteId}, ${m.ze.agenteId})`).toHaveLength(0);
      // Começar continua sendo pedir: status afazer na mesma coluna recomeça.
      const c = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T", status: "afazer" }] });
      expect(c.comecaram).toHaveLength(1);
    });
  });

  it("status pedido A fazer com responsável ainda começa (regressão): o pedido é do autor, o Fazendo é da regra", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "T" }] });
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T", status: "afazer", agente: m.maNome }] });
      expect(r.comecaram).toHaveLength(1);
      const t = r.quadro!.tarefas[0]!;
      expect(t.status).toBe("fazendo");
      const h = (await historicoDaTarefa(m.deps, { agenteId: m.ze.agenteId, tarefaId: t.id })).data.historico;
      expect(h.map((x) => [x.campo, x.deNome, x.paraNome, x.autor])).toEqual([
        ["criada", null, "Backlog", "pessoa"],
        ["status", "Backlog", "A fazer", "pessoa"],
        ["agente", null, m.maNome, "pessoa"],
        ["status", "A fazer", "Fazendo", "regra"],
      ]);
      expect(h.every((x) => x.criadoEm > 0)).toBe(true);
    });
  });

  it("mover de quadro: código novo, o antigo resolve, histórico vai junto, cai na coluna do mesmo grupo e não aciona ninguém", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login", agente: m.maNome }, { tipo: "criar_tarefa", titulo: "Revisão", status: "revisao" }] });
      // O destino tem as colunas da pessoa: sem Backlog nem Em revisão.
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "substituir_colunas", colunas: [{ nome: "Pedido", grupo: "nao_iniciado" }, { nome: "Produção", grupo: "iniciado" }, { id: "voce", nome: "Precisa de você", grupo: "iniciado" }, { nome: "Entregue", grupo: "feito" }, { id: "cancelado", nome: "Cancelado", grupo: "fechado" }] }] });
      const pz = dz.quadro!.prefixo!;
      const pm = dm.quadro!.prefixo!;
      const [login, revisao] = dz.quadro!.tarefas;
      const colunaDe = (nome: string) => dm.quadro!.colunas.find((c) => c.nome === nome)!.id;

      // Pela tela (a pessoa), pelo código antigo, para o quadro pelo prefixo.
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: `${pz}-1`, quadro: pm }] });
      expect(r.movida).toEqual({ tarefaId: login!.id, codigo: `${pm}-1`, codigoAntigo: `${pz}-1` });
      expect(r.comecaram).toEqual([]);
      expect(r.quadro!.tarefas.find((t) => t.id === login!.id)).toMatchObject({ status: colunaDe("Pedido"), agenteId: m.ma.agenteId, turnoId: null, codigo: `${pm}-1` });
      // Pela conversa (um bot), pelo título, para o quadro pelo nome do anfitrião. Em revisão sem turno vivo fica no grupo
      // Andamento (revisão 8 do PR #623): o destino só tem Produção, a de execução, e ela cai lá sem execução nenhuma.
      const r2 = await m.ok({ autor: { tipo: "agente", agenteId: m.ze.agenteId }, autorNaConversa: true, ops: [{ tipo: "mover_quadro", tarefa: "Revisão", quadro: m.maNome }] });
      expect(r2.quadro!.tarefas.find((t) => t.id === revisao!.id)).toMatchObject({ status: colunaDe("Produção"), codigo: `${pm}-2`, turnoId: null, execucao: null });
      expect(await trx`select 1 from turnos where agente_id = ${m.ma.agenteId} and origem = 'delegacao'`).toHaveLength(0);
      expect(await m.repos.quadros.tarefas(dz.quadro!.id)).toEqual([]);

      // O código antigo continua abrindo, no quadro de agora.
      expect((await verTarefaPorCodigo(m.deps, { codigo: `${pz}-1` })).data).toEqual({ agenteId: m.ma.agenteId, quadroId: dm.quadro!.id, tarefaId: login!.id, codigo: `${pz}-1`, codigoAtual: `${pm}-1` });
      // O histórico veio junto: criada no quadro do Zé, a mudança de quadro (pessoa) e a de coluna (regra).
      const h = (await historicoDaTarefa(m.deps, { agenteId: m.ma.agenteId, tarefaId: login!.id })).data.historico;
      expect(h.map((x) => [x.campo, x.deNome, x.paraNome, x.autor])).toEqual([
        ["criada", null, "Backlog", "pessoa"],
        ["agente", null, m.maNome, "pessoa"],
        ["quadro", m.zeNome, m.maNome, "pessoa"],
        ["status", "Backlog", "Pedido", "regra"],
      ]);
      // O bot que ainda procura pelo código velho no quadro velho recebe a dica.
      const velho = await m.lote({ autor: { tipo: "agente", agenteId: m.ze.agenteId }, quadro: m.zeNome, ops: [{ tipo: "mudar_tarefa", tarefa: `${pz}-1`, status: "feito" }] });
      expect(velho.data).toMatchObject({ ok: false, erro: "nao_encontrado", detalhe: expect.stringContaining(`agora é ${pm}-1, no quadro de ${m.maNome}`) });
      // No quadro novo, o código novo vale para mudar.
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: `${pm}-1`, status: "Entregue" }] });

      // Voltar ao quadro de antes devolve o código que ela já tinha lá.
      const volta = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mover_quadro", tarefa: login!.id, quadro: m.zeNome }] });
      expect(volta.movida).toMatchObject({ codigo: `${pz}-1`, codigoAntigo: `${pm}-1` });
      expect(volta.quadro!.tarefas[0]).toMatchObject({ status: "feito" });

      // Bordas: o mesmo quadro e o quadro que não existe.
      expect((await m.lote({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: `${pz}-1`, quadro: m.zeNome }] })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await m.lote({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: `${pz}-1`, quadro: "Ninguém" }] })).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      // A lista do "Mover para…".
      const qs = (await listarQuadros(m.deps, {})).data.quadros;
      expect(qs.filter((q) => [m.ze.agenteId, m.ma.agenteId].includes(q.agenteId)).map((q) => q.prefixo).sort()).toEqual([pm, pz].sort());
      // Revisão 3 do PR #623: os nomes saem de uma leitura só dos bots, não de um buscar por quadro (N+1).
      const buscar = vi.spyOn(m.repos.agentes, "buscar");
      const listar = vi.spyOn(m.repos.agentes, "listar");
      const deNovo = (await listarQuadros(m.deps, {})).data.quadros;
      expect(buscar).not.toHaveBeenCalled();
      expect(listar).toHaveBeenCalledTimes(1);
      expect(deNovo.filter((q) => q.agenteId === m.ze.agenteId).map((q) => q.agenteNome)).toEqual([m.zeNome]);
      buscar.mockRestore();
      listar.mockRestore();
    });
  });

  it("revisão 7 do PR #623: mover → remover o quadro de origem → os comentários da tarefa continuam (vão com ela)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const id = dz.quadro!.tarefas[0]!.id;
      const c = await comentarTarefa(m.deps, { autor: { tipo: "pessoa" }, anfitriaoId: m.ze.agenteId, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: "Login", texto: "Primeiro" });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      expect(await trx`select quadro_id from quadro_comentarios where tarefa_id = ${id}`).toEqual([{ quadro_id: dm.quadro!.id }]);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "remover_quadro" }] });
      const lista = (await verComentarios(m.deps, { agenteId: m.ma.agenteId, tarefaId: id })).data.comentarios;
      expect(lista.map((x) => x.texto)).toEqual(["Primeiro"]);
    });
  });

  it("merge da main (NOD-421): mover leva os PRs ligados e as linhas de sistema da tarefa (0142) ao quadro destino", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const id = dz.quadro!.tarefas[0]!.id;
      const url = "https://github.com/gamefik/nod/pull/4242";
      expect(await m.repos.quadros.salvarPr(dz.quadro!.id, id, { repo: "gamefik/nod", numero: 4242, url, branch: "zq-1-login", estado: "aberto", ci: "ok", conflito: false })).toBe(true);
      expect(await m.repos.quadros.inserirLinha(dz.quadro!.id, id, { tipo: "pr_ligado", texto: "PR ligado: gamefik/nod #4242", dados: {} })).toBe(true);
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      const movida = r.quadro!.tarefas.find((t) => t.id === id)!;
      expect(r.quadro!.id).toBe(dm.quadro!.id);
      expect(movida.prs?.map((p) => p.url)).toEqual([url]);
      expect(movida.linhas?.map((l) => l.texto)).toEqual(["PR ligado: gamefik/nod #4242"]);
      expect(await trx`select quadro_id from quadro_tarefa_prs where tarefa_id = ${id}`).toEqual([{ quadro_id: dm.quadro!.id }]);
      expect(await trx`select quadro_id from quadro_tarefa_linhas where tarefa_id = ${id}`).toEqual([{ quadro_id: dm.quadro!.id }]);
    });
  });

  it("revisão 7 do PR #623: mover para a coluna com passagem de outro bot cai no mesmo grupo sem passagem e não aciona ninguém", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login", status: "afazer", agente: m.maNome }] });
      const id = dz.quadro!.tarefas[0]!.id;
      const turnoId = (await m.repos.quadros.tarefa(id))!.turnoId;
      expect(turnoId).not.toBeNull();
      // O destino: Fazendo e Backlog passam a tarefa ao Zé (ADR-142).
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "definir_passagem", coluna: "fazendo", agente: m.zeNome }, { tipo: "definir_passagem", coluna: "backlog", agente: m.zeNome }] });
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      expect(r.comecaram).toEqual([]);
      expect(r.quadro!.tarefas.find((t) => t.id === id)).toMatchObject({ status: "revisao", agenteId: m.ma.agenteId, turnoId });
      expect(await trx`select 1 from turnos where agente_id = ${m.ze.agenteId} and origem = 'delegacao'`).toHaveLength(0);
      // Do Backlog: o destino só tem o Backlog com passagem em Não iniciado; fica nele (A fazer acionaria), com a Maria.
      const outra = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "Copy", agente: m.maNome }] });
      const id2 = outra.quadro!.tarefas.find((t) => t.titulo === "Copy")!.id;
      const r2 = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id2, quadro: m.maNome }] });
      expect(r2.quadro!.tarefas.find((t) => t.id === id2)).toMatchObject({ status: "backlog", agenteId: m.ma.agenteId, turnoId: null });
      expect(r2.comecaram).toEqual([]);
    });
  });

  it("revisão 8 do PR #623: a tarefa de uma coluna sua de Andamento, sem turno vivo, fica em Andamento no destino fora de Fazendo (Em revisão), sem iniciar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_coluna", nome: "Em teste", grupo: "iniciado", depois_de: "fazendo" }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      // Três tarefas em "Em teste": sem responsável (nunca rodou), com o turno já concluído e com o turno vivo. A quarta
      // espera a pessoa (Precisa de você) e volta para "Em teste": o voltarPara segue a mesma regra (revisão 8, item 2).
      const dz0 = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [
        { tipo: "criar_tarefa", titulo: "Solta", status: "Em teste" },
        { tipo: "criar_tarefa", titulo: "Acabou", status: "Em teste", agente: m.maNome },
        { tipo: "criar_tarefa", titulo: "Rodando", status: "Em teste", agente: m.maNome },
        { tipo: "criar_tarefa", titulo: "Esperando", status: "Em teste" },
        { tipo: "criar_tarefa", titulo: "Esperando com bot", status: "Em teste", agente: m.maNome },
      ] });
      const turnoEsperandoBot = (await m.repos.quadros.tarefa(dz0.quadro!.tarefas.find((t) => t.titulo === "Esperando com bot")!.id))!.turnoId!;
      await trx`update turnos set estado = 'concluido' where id = ${turnoEsperandoBot}`;
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: dz0.quadro!.tarefas.find((t) => t.titulo === "Esperando com bot")!.id, status: "voce", pergunta: "Sigo?" }] });
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: dz0.quadro!.tarefas.find((t) => t.titulo === "Esperando")!.id, status: "voce", pergunta: "Pode seguir?" }] });
      const emTeste = dz.quadro!.colunas.find((c) => c.nome === "Em teste")!.id;
      const por = (titulo: string) => dz.quadro!.tarefas.find((t) => t.titulo === titulo)!;
      expect([por("Solta"), por("Acabou"), por("Rodando")].map((t) => t.status)).toEqual([emTeste, emTeste, emTeste]);
      const turnoAcabou = (await m.repos.quadros.tarefa(por("Acabou").id))!.turnoId!;
      const turnoRodando = (await m.repos.quadros.tarefa(por("Rodando").id))!.turnoId!;
      expect(turnoAcabou).not.toBeNull();
      await trx`update turnos set estado = 'concluido' where id = ${turnoAcabou}`;
      for (const titulo of ["Solta", "Acabou", "Rodando", "Esperando", "Esperando com bot"]) await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: por(titulo).id, quadro: m.maNome }] });
      const destino = (await m.repos.quadros.doAgente(m.ma.agenteId))!;
      const no = async (titulo: string) => (await m.repos.quadros.tarefa(por(titulo).id))!;
      // Sem execução: fica no grupo Andamento, na coluna que não é a de execução (Em revisão), sem iniciar ninguém; a regra
      // assina a mudança no histórico, e o cartão não acende execução (o turno não está vivo).
      expect(await no("Solta")).toMatchObject({ quadroId: destino.id, status: "revisao", turnoId: null });
      expect(await no("Acabou")).toMatchObject({ quadroId: destino.id, status: "revisao" });
      expect(await no("Esperando")).toMatchObject({ quadroId: destino.id, status: "voce", voltarPara: "revisao" });
      // Com responsável, a resposta da pessoa reabre o turno: a volta é para a execução (revisão 9 do PR #623).
      expect(await no("Esperando com bot")).toMatchObject({ quadroId: destino.id, status: "voce", voltarPara: "fazendo" });
      const { data: h } = await historicoDaTarefa(m.deps, { agenteId: m.ma.agenteId, tarefaId: por("Acabou").id });
      expect(h.historico.some((x) => x.campo === "status" && x.de === emTeste && x.para === "revisao" && x.autor === "regra")).toBe(true);
      const tela = (await montarQuadro(m.deps, destino)).tarefas;
      expect(tela.filter((t) => ["Solta", "Acabou"].includes(t.titulo)).map((t) => t.execucao)).toEqual([null, null]);
      // Com o turno vivo, o trabalho anda: Fazendo, com o mesmo turno.
      expect(await no("Rodando")).toMatchObject({ quadroId: destino.id, status: "fazendo", turnoId: turnoRodando });
      expect(await trx`select 1 from turnos where agente_id = ${m.ma.agenteId} and estado = 'pendente' and id <> ${turnoRodando}`).toHaveLength(0);
    });
  });

  it("mover não para o turno que a tarefa já tem; o Desfazer de um lote antigo da origem não a puxa de volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const comeca = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "Login", status: "afazer", agente: m.maNome }] });
      const turnoId = comeca.comecaram[0]!.turnoId;
      const id = dz.quadro!.tarefas[0]!.id;
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      expect(r.quadro!.tarefas[0]).toMatchObject({ id, status: "fazendo", turnoId });
      expect(await m.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "pendente" });
      // O último lote do quadro do Zé é o que começou a tarefa: depois do mover ele não se desfaz (revisão 2 do PR #623,
      // a barreira), e a tarefa fica no quadro da Maria, com o turno.
      const d = await m.lote({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "desfazer" }] });
      expect(d.data).toMatchObject({ ok: false, erro: "entrada_invalida", detalhe: expect.stringContaining("mudou de quadro") });
      expect(await m.repos.quadros.tarefa(id)).toMatchObject({ quadroId: r.quadro!.id, status: "fazendo", turnoId });
    });
  });

  it("revisão 2 do PR #623: o Desfazer do lote que criou o quadro destino não apaga a tarefa movida para ele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      expect(dm.quadro!.ultimoLote).not.toBeNull();
      const id = dz.quadro!.tarefas[0]!.id;
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      // A tela não oferece mais o Desfazer em nenhum dos dois quadros.
      expect(r.quadro!.ultimoLote).toBeNull();
      expect((await m.repos.quadros.ultimoLote(dz.quadro!.id))).not.toBeNull();
      const d = await m.lote({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "desfazer" }] });
      expect(d.data).toMatchObject({ ok: false, erro: "entrada_invalida", detalhe: expect.stringContaining("mudou de quadro") });
      expect(await m.repos.quadros.tarefa(id)).toMatchObject({ quadroId: dm.quadro!.id });
      expect(await m.repos.quadros.buscar(dm.quadro!.id)).not.toBeNull();
      expect(await trx`select 1 from quadro_tarefa_codigos where tarefa_id = ${id}`).toHaveLength(2);
      // Um lote novo depois do mover volta a se desfazer.
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "Outra" }] });
      const d2 = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "desfazer" }] });
      expect(d2.quadro!.tarefas.map((t) => t.id)).toEqual([id]);
    });
  });

  it("revisão 2 do PR #623: o Desfazer de um lote de colunas do destino depois de um mover não deixa a tarefa fora das colunas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login", status: "afazer" }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_coluna", nome: "Pedido", grupo: "nao_iniciado" }, { tipo: "remover_coluna", coluna: "afazer", destino: "Pedido" }, { tipo: "remover_coluna", coluna: "backlog", destino: "Pedido" }] });
      const pedido = dm.quadro!.colunas.find((c) => c.nome === "Pedido")!.id;
      const id = dz.quadro!.tarefas[0]!.id;
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      expect(r.quadro!.tarefas[0]).toMatchObject({ status: pedido });
      const d = await m.lote({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "desfazer" }] });
      expect(d.data).toMatchObject({ ok: false, erro: "entrada_invalida", detalhe: expect.stringContaining("mudou de quadro") });
      // O quadro segue vivo: o próximo lote passa.
      const depois = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: id, status: "Pedido" }, { tipo: "criar_tarefa", titulo: "Nova" }] });
      expect(depois.quadro!.tarefas.map((t) => t.status)).toEqual([pedido, pedido]);
    });
  });

  it("revisão 2 do PR #623: mover recalcula a meta dos dois quadros (cumprida na origem, reaberta no destino)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: "Lançar" }, { tipo: "criar_tarefa", titulo: "Pronta", status: "feito" }, { tipo: "criar_tarefa", titulo: "Aberta" }] });
      expect(dz.quadro!.cumpridoEm).toBeNull();
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: "Entregar" }, { tipo: "criar_tarefa", titulo: "Entregue", status: "feito" }] });
      expect(dm.quadro!.cumpridoEm).not.toBeNull();
      expect(dm.quadro!.resumo).not.toBeNull();
      const aberta = dz.quadro!.tarefas.find((t) => t.titulo === "Aberta")!.id;
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: aberta, quadro: m.maNome }] });
      // O destino ganhou uma tarefa aberta: a meta reabre.
      expect(r.quadro).toMatchObject({ cumpridoEm: null, resumo: null });
      // A origem ficou só com a feita: a meta fecha, com o resumo.
      const origem = (await m.repos.quadros.buscar(dz.quadro!.id))!;
      expect(origem.cumpridoEm).not.toBeNull();
      expect(origem.resumo).toEqual(expect.any(String));
    });
  });

  it("revisão do PR #623: o bot não move de turno não limpo nem no fim da corrente; a rota confere o anfitrião; bot excluído não é destino", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const id = dz.quadro!.tarefas[0]!.id;
      const doBot = { autor: { tipo: "agente" as const, agenteId: m.ze.agenteId }, ops: [{ tipo: "mover_quadro" as const, tarefa: id, quadro: m.maNome }] };
      // Turno em que entrou algo de fora (ADR-062): não move, como o Desfazer e as colunas.
      expect((await m.lote({ ...doBot, origemConfiavel: false })).data).toMatchObject({ ok: false, erro: "entrada_invalida", detalhe: expect.stringContaining("turno limpo") });
      // No fim da corrente de bots (ADR-063): não move.
      expect((await m.lote({ ...doBot, profundidade: 3 })).data).toMatchObject({ ok: false, erro: "entrada_invalida", detalhe: expect.stringContaining("corrente") });
      expect(await m.repos.quadros.tarefa(id)).toMatchObject({ quadroId: dz.quadro!.id });
      // A rota é /agentes/:id/quadro/tarefas/:tid/mover: a tarefa precisa ser do quadro de :id.
      expect((await m.lote({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.zeNome }] })).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      expect(await m.repos.quadros.tarefa(id)).toMatchObject({ quadroId: dz.quadro!.id });
      // O quadro de um bot excluído não é destino (pelo id do quadro, pelo id do bot nem pelo prefixo).
      const destino = (await m.repos.quadros.doAgente(m.ma.agenteId))!;
      await m.repos.agentes.excluir(m.ma.agenteId, AGORA);
      for (const ref of [destino.id, m.ma.agenteId, destino.prefixo!]) {
        expect((await m.lote({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: ref }] })).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      }
      // E o "Mover para" da tela (GET /quadros) não oferece o quadro do bot excluído.
      expect((await listarQuadros(m.deps, {})).data.quadros.map((q) => q.id)).not.toContain(destino.id);
      expect(await m.repos.quadros.tarefa(id)).toMatchObject({ quadroId: dz.quadro!.id });
    });
  });

  it("revisão do PR #630: o código de uma tarefa que é o id do Linear de outra não escolhe, nem no mover nem no link", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Da casa" }] });
      const pz = dz.quadro!.prefixo!;
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "importar_linear", itens: [{ identificador: `${pz}-1`, titulo: "Do Linear" }] }] });
      const daCasa = dz.quadro!.tarefas[0]!;
      const doLinear = dm.quadro!.tarefas[0]!;
      // O mover pelo chat: recusa e diz as duas (com os ids) para o bot perguntar.
      const r = (await m.lote({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mover_quadro", tarefa: `${pz}-1`, quadro: m.zeNome }] })).data;
      expect(r).toMatchObject({ ok: false, erro: "entrada_invalida" });
      if (r.ok) throw new Error("moveu");
      expect(r.detalhe).toContain(daCasa.id);
      expect(r.detalhe).toContain(doLinear.id);
      // O link: as mesmas duas, para a pessoa escolher.
      const link = (await verTarefaPorCodigo(m.deps, { codigo: `${pz}-1` })).data;
      if (!("ambigua" in link)) throw new Error("o link escolheu");
      expect(link.ambigua.map((o) => [o.tarefaId, o.doLinear]).sort()).toEqual([[daCasa.id, false], [doLinear.id, true]].sort());
      // Pelo id, o mover passa.
      const movida = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mover_quadro", tarefa: doLinear.id, quadro: m.zeNome }] });
      expect(movida.quadro!.tarefas.map((t) => t.titulo).sort()).toEqual(["Da casa", "Do Linear"]);
      // Sem colisão, o id do Linear acha a importada nos dois caminhos.
      const dm2 = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "importar_linear", itens: [{ identificador: "LIN-77", titulo: "Só do Linear" }] }] });
      const so = dm2.quadro!.tarefas.find((t) => t.linearId === "LIN-77")!;
      expect((await verTarefaPorCodigo(m.deps, { codigo: "lin-77" })).data).toMatchObject({ tarefaId: so.id });
    });
  });

  it("revisão do PR #623: o lote e o mover pegam o advisory dos prefixos antes do FOR UPDATE do quadro (a ordem da criação)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      // Quadros de um servidor de antes da 0137: sem prefixo, o lote vai escolher um (e pega o advisory).
      await trx`update quadros set prefixo = null where agente_id in (${m.ze.agenteId}, ${m.ma.agenteId})`;
      const ordem: string[] = [];
      const repo = m.repos.quadros;
      const travarPrefixos = repo.travarPrefixos.bind(repo);
      const buscarTravado = repo.buscarTravado.bind(repo);
      repo.travarPrefixos = async () => { ordem.push("advisory"); return travarPrefixos(); };
      repo.buscarTravado = async (id: string) => { ordem.push("quadro"); return buscarTravado(id); };

      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "Outra" }] });
      expect(ordem[0]).toBe("advisory");
      expect(ordem).toContain("quadro");

      await trx`update quadros set prefixo = null where agente_id in (${m.ze.agenteId}, ${m.ma.agenteId})`;
      ordem.length = 0;
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: dz.quadro!.tarefas[0]!.id, quadro: m.maNome }] });
      expect(ordem[0]).toBe("advisory");
      expect(ordem.filter((x) => x === "quadro")).toHaveLength(2);
    });
  });

  it("revisão 2 do PR #623: se outro mover levou a tarefa a um terceiro quadro enquanto este esperava as travas, recusa com conflito", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const terceiro = await agenteComConversa(trx, MARLON, { nome: `${m.zeNome}c` });
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const dc = await m.ok({ anfitriaoId: terceiro.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      // O terceiro quadro é de um servidor de antes (sem prefixo): pegar o prefixo dele exigiria o advisory.
      await trx`update quadros set prefixo = null where id = ${dc.quadro!.id}`;
      const id = dz.quadro!.tarefas[0]!.id;
      const repo = m.repos.quadros;
      const ordem: string[] = [];
      const travarPrefixos = repo.travarPrefixos.bind(repo);
      const buscarTravado = repo.buscarTravado.bind(repo);
      repo.travarPrefixos = async () => { ordem.push("advisory"); return travarPrefixos(); };
      let levou = false;
      repo.buscarTravado = async (qid: string) => {
        ordem.push("quadro");
        // O outro mover terminou enquanto este esperava a primeira trava: a tarefa está no terceiro quadro.
        if (!levou) { levou = true; await trx`update quadro_tarefas set quadro_id = ${dc.quadro!.id} where id = ${id}`; }
        return buscarTravado(qid);
      };
      const r = await m.lote({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      expect(r.data).toMatchObject({ ok: false, erro: "conflito", detalhe: expect.stringContaining("mudou de quadro") });
      expect(await repo.tarefa(id)).toMatchObject({ quadroId: dc.quadro!.id });
      // Nenhum advisory depois do FOR UPDATE (nem para o prefixo do terceiro quadro, que não estava travado).
      expect(ordem).toEqual(["quadro", "quadro"]);
    });
  });

  it("revisão 7 do PR #623: o destino que não volta da trava (removido enquanto este esperava) recusa com quadro_sumiu, sem reler fora da trava", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const id = dz.quadro!.tarefas[0]!.id;
      const repo = m.repos.quadros;
      const buscarTravado = repo.buscarTravado.bind(repo);
      const buscar = repo.buscar.bind(repo);
      let travou = false;
      const lidosDepois: string[] = [];
      repo.buscarTravado = async (qid: string) => {
        travou = true;
        // A pessoa removeu o quadro da Maria enquanto este mover esperava a trava.
        if (qid === dm.quadro!.id) await repo.apagar(qid);
        return buscarTravado(qid);
      };
      repo.buscar = async (qid: string) => { if (travou) lidosDepois.push(qid); return buscar(qid); };
      const r = await m.lote({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      expect(r.data).toMatchObject({ ok: false, erro: "nao_encontrado", motivo: "quadro_sumiu" });
      // Origem e destino vêm das linhas travadas: nenhuma releitura solta depois da trava.
      expect(lidosDepois).toEqual([]);
      expect(await repo.tarefa(id)).toMatchObject({ quadroId: dz.quadro!.id });
    });
  });

  it("revisão 7 do PR #623: o bot que procura pelo id (uuid) a tarefa que mudou de quadro ouve onde ela está, como pelo código", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const id = dz.quadro!.tarefas[0]!.id;
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      const pm = dm.quadro!.prefixo!;
      // O id não muda no mover: o bot do quadro velho que guardou o id recebe a dica de onde ela está.
      const velho = await m.lote({ autor: { tipo: "agente", agenteId: m.ze.agenteId }, quadro: m.zeNome, ops: [{ tipo: "mudar_tarefa", tarefa: id, status: "feito" }] });
      expect(velho.data).toMatchObject({ ok: false, erro: "nao_encontrado", detalhe: expect.stringContaining(`a tarefa ${id} está no quadro de ${m.maNome}, como ${pm}-1 (passe quadro "${m.maNome}")`) });
      // O mover pelo id acha a tarefa em qualquer quadro da pessoa (não precisa de dica): de volta ao Zé.
      const volta = await m.ok({ autor: { tipo: "agente", agenteId: m.ze.agenteId }, autorNaConversa: true, ops: [{ tipo: "mover_quadro", tarefa: id.toUpperCase(), quadro: m.zeNome }] });
      expect(volta.movida).toMatchObject({ tarefaId: id });
    });
  });

  it("revisão 2 do PR #623: o histórico dá o nome das colunas da pessoa no quadro de origem, sem uma busca por linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "substituir_colunas", colunas: [{ nome: "Pedido", grupo: "nao_iniciado" }, { nome: "Produção", grupo: "iniciado" }, { id: "voce", nome: "Precisa de você", grupo: "iniciado" }, { nome: "Entregue", grupo: "feito" }, { id: "cancelado", nome: "Cancelado", grupo: "fechado" }] }] });
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "Bolo", agente: m.maNome }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const id = dz.quadro!.tarefas[0]!.id;
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mover_quadro", tarefa: id, quadro: m.maNome }] });
      await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: id, status: "revisao" }] });
      const contagem = { quadro: 0, agente: 0 };
      const buscar = m.repos.quadros.buscar.bind(m.repos.quadros);
      const buscarAgente = m.repos.agentes.buscar.bind(m.repos.agentes);
      m.repos.quadros.buscar = async (...a) => { contagem.quadro++; return buscar(...a); };
      m.repos.agentes.buscar = async (...a) => { contagem.agente++; return buscarAgente(...a); };
      const h = (await historicoDaTarefa(m.deps, { agenteId: m.ma.agenteId, tarefaId: id })).data.historico;
      expect(h.map((x) => [x.campo, x.deNome, x.paraNome])).toEqual([
        ["criada", null, "Pedido"],
        ["agente", null, m.maNome],
        ["quadro", m.zeNome, m.maNome],
        ["status", "Pedido", "Backlog"],
        ["status", "Backlog", "Em revisão"],
      ]);
      expect(contagem).toEqual({ quadro: 0, agente: 0 });
    });
  });

  it("remover o quadro apaga o histórico das tarefas dele e guarda os códigos (o prefixo fica reservado); outra pessoa não acha o código", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const prefixo = dz.quadro!.prefixo!;
      const codigo = `${prefixo}-1`;

      await vincularEscopo(trx, { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA });
      const ana = depsSobre(trx, { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA }, { agora: () => AGORA });
      await ana.repos.preferencias.gravar({ experimentos: { quadro: true } });
      await expect(verTarefaPorCodigo(ana.deps, { codigo })).rejects.toThrow(ErroDeDominio);
      await vincularEscopo(trx, MARLON);

      const id = dz.quadro!.tarefas[0]!.id;
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "remover_quadro" }] });
      expect(await trx`select 1 from quadro_tarefa_historico where tarefa_id = ${id}`).toHaveLength(0);
      await expect(verTarefaPorCodigo(m.deps, { codigo })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      // Revisão 5 do PR #623: o código fica (sem a tarefa), e o prefixo não volta para outro quadro. Senão o quadro novo
      // pegava o mesmo prefixo e o link velho (ZE-1) abria outra tarefa.
      expect(await trx`select 1 from quadro_tarefa_codigos where tarefa_id = ${id}`).toHaveLength(1);
      const novo = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Outra" }] });
      expect(novo.quadro!.prefixo).not.toBe(prefixo);
      expect(novo.quadro!.prefixo!.startsWith(prefixo)).toBe(true);
      await expect(verTarefaPorCodigo(m.deps, { codigo })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("revisão 11 do PR #630: a importação que troca o prefixo; a tarefa antiga abre pelo código novo e pelo velho, antes e depois do Desfazer", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // A chave do time: 3 letras que nenhum quadro nem código da pessoa usa (o banco de teste guarda os de outras rodadas;
      // um prefixo já reservado faria o bot "<chave>inho" ganhar outro prefixo e o teste cair sem bug).
      const usados = new Set((await trx<{ prefixo: string }[]>`select prefixo from quadros where prefixo is not null union select prefixo from quadro_tarefa_codigos`).map((r) => r.prefixo));
      const sortear = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
      let time = sortear();
      while (usados.has(time)) time = sortear();
      const issue = (n: number): IssueLinear => ({
        identificador: `${time}-${n}`, numero: n, titulo: `Issue ${n}`, url: `https://linear.app/gamefik/issue/${time}-${n}/issue-${n}`, descricao: "corpo",
        estado: "Backlog", noEstadoDesde: AGORA, etiquetas: [], mae: null, bloqueadaPor: [], comentarios: [], anexos: [],
      });
      const importar = async (issues: IssueLinear[]) => {
        const q = (await m.repos.quadros.doAgente(m.ze.agenteId))!;
        const i = await iniciarImportacao(m.deps, { quadro: q, time, filtro: null, total: issues.length, conversaId: null });
        if (!i.data.ok) throw new Error(i.data.detalhe);
        expect((await aplicarImportacao(m.deps, i.data.importacao.id, issues)).data).toBe("aplicada");
        return (await m.repos.quadroImportacoes.ultima(q.id))!;
      };
      const abre = async (codigo: string) => (await verTarefaPorCodigo(m.deps, { codigo })).data;

      const dono = await agenteComConversa(trx, MARLON, { nome: `${time}inho` });
      const ocupa = await m.ok({ anfitriaoId: dono.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      expect(ocupa.quadro!.prefixo).toBe(time);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const velho = dz.quadro!.prefixo!;
      // 1ª importação: outro quadro usa a chave do time, o prefixo fica; a tarefa ganha o número da issue (livre).
      await importar([issue(901)]);
      const antiga = (await m.repos.quadros.tarefas(dz.quadro!.id)).find((t) => t.linearId === `${time}-901`)!;
      expect(antiga.numero).toBe(901);
      expect(await abre(`${velho}-901`)).toMatchObject({ tarefaId: antiga.id, codigoAtual: `${velho}-901` });
      // O quadro que ocupava a chave sai (vazio, não reserva o prefixo): a 2ª importação troca o prefixo pelo do time.
      await m.ok({ anfitriaoId: dono.agenteId, ops: [{ tipo: "remover_quadro" }] });
      const imp = await importar([issue(901), issue(902)]);
      expect((await m.repos.quadros.doAgente(m.ze.agenteId))!.prefixo).toBe(time);
      expect(await abre(`${time}-901`)).toMatchObject({ tarefaId: antiga.id, codigoAtual: `${time}-901` });
      expect(await abre(`${velho}-901`)).toMatchObject({ tarefaId: antiga.id, codigoAtual: `${time}-901` });
      const nova = (await m.repos.quadros.tarefas(dz.quadro!.id)).find((t) => t.linearId === `${time}-902`)!;
      expect(await abre(`${time}-902`)).toMatchObject({ tarefaId: nova.id, codigoAtual: `${time}-902` });

      // O Desfazer devolve o prefixo velho: a antiga abre pelos dois códigos, com o código atual de volta ao velho.
      expect(await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "desfazer", lote: imp.loteId! }] })).toMatchObject({ desfeito: true });
      expect((await m.repos.quadros.doAgente(m.ze.agenteId))!.prefixo).toBe(velho);
      expect(await abre(`${velho}-901`)).toMatchObject({ tarefaId: antiga.id, codigoAtual: `${velho}-901` });
      expect(await abre(`${time}-901`)).toMatchObject({ tarefaId: antiga.id, codigoAtual: `${velho}-901` });
      // A criada pela importação desfeita não abre mais por código nenhum.
      await expect(abre(`${time}-902`)).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("revisão 5 do PR #623: o código antigo (de outro quadro) resolve a tarefa que voltou para este quadro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }] });
      const dm = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const pm = dm.quadro!.prefixo!;
      const id = dm.quadro!.tarefas[0]!.id;
      const r = await m.ok({ anfitriaoId: m.ma.agenteId, ops: [{ tipo: "mover_quadro", tarefa: `${pm}-1`, quadro: m.zeNome }] });
      expect(r.movida!.codigoAntigo).toBe(`${pm}-1`);
      // O bot ainda chama a tarefa pelo código de antes, agora no quadro do Zé (o prefixo não bate com o dele).
      const mudou = await m.ok({ autor: { tipo: "agente", agenteId: m.ze.agenteId }, quadro: m.zeNome, autorNaConversa: true, limite: "total", ops: [{ tipo: "mudar_tarefa", tarefa: `${pm}-1`, status: "feito" }] });
      expect(mudou.quadro!.tarefas.find((t) => t.id === id)).toMatchObject({ status: "feito" });
      // O código de uma tarefa que não está neste quadro continua não achando (sem pegar outra).
      const fora = await m.lote({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: `${pm}-9`, status: "feito" }] });
      expect(fora.data).toMatchObject({ ok: false, erro: "nao_encontrado" });
    });
  });

  it("revisão 5 do PR #623: o Desfazer que devolve uma tarefa excluída registra \"restaurada\" com o autor", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Login" }] });
      const id = dz.quadro!.tarefas[0]!.id;
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: id, excluir: true }] });
      await m.ok({ autor: { tipo: "agente", agenteId: m.ze.agenteId }, quadro: m.zeNome, autorNaConversa: true, limite: "total", ops: [{ tipo: "desfazer" }] });
      const h = (await historicoDaTarefa(m.deps, { agenteId: m.ze.agenteId, tarefaId: id })).data.historico;
      expect(h.map((x) => [x.campo, x.paraNome, x.autor, x.autorNome])).toEqual([["criada", "Backlog", "pessoa", null], ["restaurada", "Backlog", "agente", m.zeNome]]);
    });
  });

  it("revisão 5 do PR #623: numerar as faltantes lê só as tarefas sem número, não o quadro inteiro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "A" }] });
      const semNumero = vi.spyOn(m.repos.quadros, "tarefasSemNumero");
      const tarefas = vi.spyOn(m.repos.quadros, "tarefas");
      await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "B" }] });
      expect(semNumero).toHaveBeenCalledTimes(1);
      // O lote lê as tarefas antes do plano, no fecho da meta, nos avisos (NOD-420) e ao montar a resposta; o numerar não
      // soma uma (antes, 5).
      expect(tarefas).toHaveBeenCalledTimes(4);
      semNumero.mockRestore();
      tarefas.mockRestore();
    });
  });

  it("o quadro e a tarefa que o servidor de antes criou (sem prefixo nem número) são numerados no próximo lote", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Velha" }] });
      const qid = dz.quadro!.id;
      await trx`update quadro_tarefas set numero = null where quadro_id = ${qid}`;
      await m.repos.quadros.apagarCodigosEHistorico([dz.quadro!.tarefas[0]!.id]);
      await trx`update quadros set prefixo = null where id = ${qid}`;
      const r = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_tarefa", titulo: "Nova" }] });
      const p = r.quadro!.prefixo!;
      expect(r.quadro!.tarefas.map((t) => [t.titulo, t.codigo])).toEqual([["Velha", `${p}-2`], ["Nova", `${p}-3`]]);
      expect(((await verTarefaPorCodigo(m.deps, { codigo: `${p}-2` })).data as { tarefaId: string }).tarefaId).toBe(dz.quadro!.tarefas[0]!.id);
    });
  });

  it("revisão 4 do PR #623: mudouDeQuadroDepois (a consulta do repositório) lê cada ramo por um índice parcial de campo='quadro', sem Seq Scan", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dz = await m.ok({ anfitriaoId: m.ze.agenteId, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "T" }] });
      const qid = dz.quadro!.id;
      const [lote] = await trx<{ id: string }[]>`select id from quadro_lotes where quadro_id = ${qid} order by criado_em desc limit 1`;
      // O método responde pela mesma consulta que o EXPLAIN lê abaixo.
      expect(await m.repos.quadros.mudouDeQuadroDepois(lote!.id, qid)).toBe(false);
      // O banco de teste é pequeno: sem seq scan à mão, o planejador tem de achar um índice para cada ramo.
      await trx`set local enable_seqscan = off`;
      const plano = await trx.unsafe(`explain (format json) ${SQL_MUDOU_DE_QUADRO_DEPOIS}`, [MARLON.tenantId, MARLON.pessoaId, qid, lote!.id]);
      type No = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; "Index Cond"?: string; Plans?: No[] };
      const nos: No[] = [];
      const andar = (n: No) => { nos.push(n); for (const f of n.Plans ?? []) andar(f); };
      andar((plano[0]!["QUERY PLAN"] as { Plan: No }[])[0]!.Plan);
      // Revisão 6 do PR #623: não dá para exigir `_entrou` num ramo e `_saiu` no outro. Num banco novo (o postgres:16 do
      // CI) a tabela não tem estatísticas e o ANALYZE não ajuda: o teste roda como nod_app, que não é o dono, e o
      // Postgres 16 só avisa e pula (medido em 2026-11-02, também com 400 mudanças de quadro inseridas na transação).
      // Sem estatísticas os dois parciais estimam 1 linha, empatam, e o planejador usa `_saiu` nos dois ramos (no ramo
      // do quadro_id, com ele no Filter). O que fica garantido: um índice parcial de campo='quadro' por ramo, já com a
      // dona na Index Cond, e nada de Seq Scan nem do índice por tarefa. Com o volume de produção (ANALYZE do
      // autovacuum), quadro_id é seletivo e o ramo dele passa ao `_entrou`. Revisão 7: isso está provado em
      // tests/conformidade/mudou-de-quadro-indice.test.ts (banco novo, migrado e semeado pelo dono, que roda o ANALYZE).
      const parciais = ["quadro_tarefa_historico_entrou", "quadro_tarefa_historico_saiu"];
      const doHistorico = nos.filter((n) => n["Relation Name"] === "quadro_tarefa_historico");
      expect(doHistorico).toHaveLength(2);
      for (const n of doHistorico) {
        expect(parciais).toContain(n["Index Name"]);
        expect(n["Index Cond"] ?? "").toMatch(/tenant_id.*owner_id.*criado_em/s);
      }
      expect(nos.filter((n) => n["Node Type"] === "Seq Scan")).toEqual([]);
      expect(nos.some((n) => n["Index Name"] === "quadro_tarefa_historico_da_tarefa")).toBe(false);
    });
  });
});
