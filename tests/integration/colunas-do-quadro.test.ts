import { expect, it } from "vitest";
import { progresso } from "../../src/domain/quadro.ts";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { decidirColunasDoQuadro } from "../../src/use-cases/colunas-do-quadro.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro, montarQuadro } from "../../src/use-cases/quadro.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";

/**
 * NOD-448 (ADR-140): as colunas do quadro com Postgres de verdade. Remover com tarefas não perde nenhuma; Iniciado com
 * responsável aciona e Não iniciado não; Desfazer volta colunas e tarefas; o card de trocar o conjunto só aplica ao
 * confirmar e não vale se as colunas mudaram depois; e o e2e do quadro dos doces.
 */

const DOCES = [
  { nome: "Pedido", grupo: "nao_iniciado" as const }, { nome: "Compras", grupo: "iniciado" as const }, { nome: "Produção", grupo: "iniciado" as const },
  { nome: "Finalização", grupo: "iniciado" as const }, { nome: "Embalagem", grupo: "iniciado" as const }, { nome: "Entrega", grupo: "iniciado" as const },
  { nome: "Pago", grupo: "feito" as const },
];

describeIntegracao("colunas do quadro (NOD-448, ADR-140)", () => {
  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const doces = await agenteComConversa(trx, MARLON, { nome: `Doces ${sufixo}` });
    const caio = await agenteComConversa(trx, MARLON, { nome: `Caio ${sufixo}` });
    const pessoa = (ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: doces.agenteId, executor: "catcher", ops });
    const tarefas = async () => d.repos.quadros.tarefas((await d.repos.quadros.doAgente(doces.agenteId))!.id);
    const quadro = async () => montarQuadro(d, (await d.repos.quadros.doAgente(doces.agenteId))!);
    const turno = async (origem: "conversa" | "rotina" = "conversa") => {
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: doces.conversaId, agenteId: doces.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
      return { turnoId: t!.id, agenteId: doces.agenteId, conversaId: doces.conversaId };
    };
    return { d, doces, caio, nomeCaio: `Caio ${sufixo}`, nomeDoces: `Doces ${sufixo}`, pessoa, tarefas, quadro, turno };
  }
  const ok = <T extends { data: { ok: boolean } }>(r: T): T => { expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true }); return r; };

  it("remover com tarefas sem destino recusa e não perde nada; com destino leva todas, sem acionar ninguém", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A", status: "revisao", agente: m.nomeCaio }, { tipo: "criar_tarefa", titulo: "B", status: "revisao" }]));
      const antes = await m.tarefas();
      const sem = await m.pessoa([{ tipo: "remover_coluna", coluna: "revisao" }]);
      expect(sem.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(sem.data)).toContain("2 tarefas");
      expect((await m.quadro()).colunas.map((c) => c.id)).toContain("revisao");
      expect((await m.tarefas()).map((t) => t.status)).toEqual(["revisao", "revisao"]);
      ok(await m.pessoa([{ tipo: "remover_coluna", coluna: "revisao", destino: "backlog" }]));
      const depois = await m.tarefas();
      expect(depois.map((t) => t.id).sort()).toEqual(antes.map((t) => t.id).sort());
      expect(depois.map((t) => t.status)).toEqual(["backlog", "backlog"]);
      expect((await m.quadro()).colunas.map((c) => c.id)).not.toContain("revisao");
    });
  });

  it("mover para uma coluna Iniciado com responsável aciona; para uma Não iniciado, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "Doces" }]));
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "Bolo", status: "Pedido", agente: m.nomeCaio }]));
      expect((await m.tarefas())[0]).toMatchObject({ status: "c-pedido", turnoId: null });
      const r = ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "Bolo", status: "Compras" }]));
      expect(r.data.ok && r.data.comecaram.map((c) => c.agenteNome)).toEqual([m.nomeCaio]);
      const [t] = await m.tarefas();
      expect(t).toMatchObject({ status: "c-compras" });
      expect(t!.turnoId).not.toBeNull();
      // De volta a Pedido, e de novo para outra de Não iniciado: nada começa.
      ok(await m.pessoa([{ tipo: "criar_coluna", nome: "Orçamento", grupo: "nao_iniciado" }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "Torta", status: "Pedido", agente: m.nomeCaio }]));
      const r2 = ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "Torta", status: "Orçamento" }]));
      expect(r2.data.ok && r2.data.comecaram).toEqual([]);
      expect((await m.tarefas()).find((x) => x.titulo === "Torta")).toMatchObject({ status: "c-orcamento", turnoId: null });
    });
  });

  it("Desfazer volta as colunas e as tarefas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // Em revisão (não Fazendo) e sem turno: o Desfazer devolve cada tarefa exatamente para onde estava.
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A", status: "revisao" }, { tipo: "criar_tarefa", titulo: "B", status: "feito" }]));
      const antes = await m.quadro();
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES }]));
      expect((await m.tarefas()).map((t) => t.status).sort()).toEqual(["c-compras", "c-pago"]);
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      const depois = await m.quadro();
      expect(depois.colunas).toEqual(antes.colunas);
      expect(depois.tarefas.map((t) => [t.titulo, t.status])).toEqual(antes.tarefas.map((t) => [t.titulo, t.status]));
    });
  });

  it("Desfazer não tira de Compras a tarefa que estava lá parada, sem turno (revisão do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "Doces" }]));
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "Bolo", status: "Compras" }]));
      ok(await m.pessoa([{ tipo: "criar_coluna", nome: "Orçamento", grupo: "nao_iniciado" }]));
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      expect((await m.tarefas()).map((t) => [t.titulo, t.status])).toEqual([["Bolo", "c-compras"]]);
      // O lote que TOCA a tarefa (só o título) também a devolve a Compras, não à espera (mutante do QA do PR #615).
      ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "Bolo", titulo: "Bolo grande" }]));
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      expect((await m.tarefas()).map((t) => [t.titulo, t.status])).toEqual([["Bolo", "c-compras"]]);
    });
  });

  it("passar a tarefa a outro bot numa coluna Iniciado da pessoa aciona o novo, mesmo com o turno do antigo vivo (revisão 2 do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "Doces" }]));
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "Bolo", status: "Compras", agente: m.nomeCaio }]));
      const [t0] = await m.tarefas();
      expect(t0!.turnoId).not.toBeNull();
      const r = ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "Bolo", agente: m.nomeDoces }]));
      expect(r.data.ok && r.data.comecaram.map((c) => c.agenteNome)).toEqual([m.nomeDoces]);
      const [t1] = await m.tarefas();
      expect(t1).toMatchObject({ status: "c-compras", agenteId: m.doces.agenteId });
      expect(t1!.turnoId).not.toBe(t0!.turnoId);
    });
  });

  it("Desfazer de remover devolve a tarefa de Compras com turno concluído para Compras, sem mandar à espera (revisão 2 do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "Doces" }]));
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "Bolo", status: "Compras", agente: m.nomeCaio }]));
      const [t0] = await m.tarefas();
      await trx`update turnos set estado = 'concluido' where id = ${t0!.turnoId}`;
      const r = ok(await m.pessoa([{ tipo: "remover_coluna", coluna: "Compras", destino: "Produção" }]));
      expect(r.data.ok && r.data.comecaram).toEqual([]);
      expect((await m.tarefas())[0]).toMatchObject({ status: "c-producao", turnoId: t0!.turnoId });
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      expect((await m.tarefas())[0]).toMatchObject({ status: "c-compras", turnoId: t0!.turnoId });
    });
  });

  it("remover ou substituir não aciona o responsável, nem com outra edição da tarefa no mesmo lote (decisão 4 do Gil, revisão 3 do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "Doces" }]));
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: [...DOCES, { nome: "Orçamento", grupo: "nao_iniciado" as const }] }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "Bolo", status: "Pedido", agente: m.nomeCaio }, { tipo: "criar_tarefa", titulo: "Torta", status: "Orçamento", agente: m.nomeCaio }]));
      const r1 = ok(await m.pessoa([{ tipo: "remover_coluna", coluna: "Pedido", destino: "Compras" }, { tipo: "mudar_tarefa", tarefa: "Bolo", titulo: "Bolo 2" }]));
      expect(r1.data.ok && r1.data.comecaram).toEqual([]);
      expect((await m.tarefas()).find((t) => t.titulo === "Bolo 2")).toMatchObject({ status: "c-compras", turnoId: null });
      const r2 = ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES.filter((c) => c.nome !== "Pedido"), destinos: [{ de: "Orçamento", para: "Produção" }] }]));
      expect(r2.data.ok && r2.data.comecaram).toEqual([]);
      expect((await m.tarefas()).find((t) => t.titulo === "Torta")).toMatchObject({ status: "c-producao", turnoId: null });
    });
  });

  it("Desfazer do lote que parou o turno (Cancelado, ou remover Compras para Backlog) devolve à espera, não a 'Falhou' no andamento (revisão 4 do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomeCaio }]));
      expect((await m.tarefas())[0]!.turnoId).not.toBeNull();
      ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "T", status: "cancelado" }]));
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      expect((await m.tarefas())[0]).toMatchObject({ status: "afazer", turnoId: null });
      // O mesmo com uma coluna da pessoa removida para o Backlog.
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "U", status: "Compras", agente: m.nomeCaio }]));
      expect((await m.tarefas()).find((t) => t.titulo === "U")!.turnoId).not.toBeNull();
      ok(await m.pessoa([{ tipo: "criar_coluna", nome: "Ideias", grupo: "nao_iniciado" }]));
      ok(await m.pessoa([{ tipo: "remover_coluna", coluna: "Compras", destino: "Ideias" }]));
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      expect((await m.tarefas()).find((t) => t.titulo === "U")).toMatchObject({ status: "c-pedido", turnoId: null });
    });
  });

  it("num quadro sem A fazer, 'status afazer' leva ao andamento e aciona; remover a coluna e mover no andamento no mesmo lote não aciona (revisão 4 do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "Doces" }]));
      ok(await m.pessoa([{ tipo: "substituir_colunas", colunas: DOCES }]));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "U", status: "Pedido", agente: m.nomeCaio }]));
      const r = ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "U", status: "afazer" }]));
      expect(r.data.ok && r.data.comecaram.map((c) => c.agenteNome)).toEqual([m.nomeCaio]);
      expect((await m.tarefas())[0]).toMatchObject({ status: "c-compras" });
      // Em Compras, a coluna sai para Pedido e a mesma tarefa vai a Produção no mesmo lote: andar no andamento, sem acionar.
      await trx`update turnos set estado = 'concluido' where id = ${(await m.tarefas())[0]!.turnoId}`;
      const r2 = ok(await m.pessoa([{ tipo: "remover_coluna", coluna: "Compras", destino: "Pedido" }, { tipo: "mudar_tarefa", tarefa: "U", status: "Produção" }]));
      expect(r2.data.ok && r2.data.comecaram).toEqual([]);
    });
  });

  it("tarefa já parada no andamento: o Desfazer de um lote que só a editou a deixa igual; sem A fazer, 'status afazer' a recomeça em Fazendo (revisão 5 do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomeCaio }]));
      const t0 = (await m.tarefas())[0]!;
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${t0.turnoId}`;
      ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "T", titulo: "T2" }]));
      ok(await m.pessoa([{ tipo: "desfazer" }]));
      expect((await m.tarefas())[0]).toMatchObject({ titulo: "T", status: "fazendo", turnoId: t0.turnoId });
      ok(await m.pessoa([{ tipo: "remover_coluna", coluna: "afazer", destino: "backlog" }]));
      // "status fazendo" para quem já está em Fazendo não recomeça, como no quadro padrão (revisão 6): só o apelido afazer.
      const r0 = ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "T", status: "fazendo" }]));
      expect(r0.data.ok && r0.data.comecaram).toEqual([]);
      const r = ok(await m.pessoa([{ tipo: "mudar_tarefa", tarefa: "T", status: "afazer" }]));
      expect(r.data.ok && r.data.comecaram.map((c) => c.agenteNome)).toEqual([m.nomeCaio]);
      expect((await m.tarefas())[0]!.turnoId).not.toBe(t0.turnoId);
    });
  });

  it("trocar o conjunto pela conversa abre card; recusar não muda nada; card obsoleto não aplica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A", status: "fazendo" }]));
      const antes = await m.quadro();
      const pede = async () => {
        const r = ok(await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "substituir_colunas", colunas: DOCES }] }));
        if (!r.data.ok || !r.data.proposta_id) throw new Error("sem proposta");
        expect(r.data.instrucao).toContain("espera a pessoa no card");
        return r.data.proposta_id;
      };
      const p1 = await pede();
      expect((await m.quadro()).colunas).toEqual(antes.colunas);
      const prop = await m.d.repos.propostas.buscar(p1);
      expect(prop?.payload).toMatchObject({ kind: "colunas_quadro", movidas: [{ de: "Fazendo", para: "Compras", tarefas: 1 }] });
      expect((await executar(m.d, decidirColunasDoQuadro, { decisaoId: p1, recusar: true, executor: "catcher" })).data).toMatchObject({ aplicado: false });
      expect((await m.quadro()).colunas).toEqual(antes.colunas);
      expect((await m.d.repos.propostas.buscar(p1))?.estado).toBe("recusada");
      // Obsoleto: a pessoa renomeou uma coluna depois do card.
      const p2 = await pede();
      ok(await m.pessoa([{ tipo: "renomear_coluna", coluna: "Backlog", nome: "Ideias" }]));
      const obs = await executar(m.d, decidirColunasDoQuadro, { decisaoId: p2, recusar: false, executor: "catcher" });
      expect(obs.data).toMatchObject({ aplicado: false, obsoleta: true });
      // As outras abas fecham o card: sai o mesmo evento de decisão (revisão 3 do PR #615).
      expect(obs.events.map((e) => e.kind)).toContain("decisao_decidida");
      expect((await m.quadro()).colunas.map((c) => c.nome)).toContain("Ideias");
      expect((await m.d.repos.propostas.buscar(p2))?.estado).toBe("recusada");
      // Turno contaminado não propõe.
      const sujo = await m.turno();
      await m.d.repos.turnos.contaminar(sujo.turnoId, Date.now());
      expect(JSON.stringify((await executar(m.d, gerirQuadro, { ...sujo, acoes: [{ tipo: "substituir_colunas", colunas: DOCES }] })).data)).toContain("as colunas só mudam num turno limpo");
    });
  });

  it("travar_coluna pelo bot fora da conversa (turno de rotina) é recusado no gerir_quadro e a coluna fica sem trava (revisão do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }]));
      const r = await executar(m.d, gerirQuadro, { ...(await m.turno("rotina")), acoes: [{ tipo: "travar_coluna", coluna: "Em revisão", so_pessoa: true }] });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r.data)).toContain("as colunas só mudam a pedido da pessoa");
      expect((await m.quadro()).colunas.find((c) => c.id === "revisao")?.trava ?? null).toBeNull();
      // Na conversa, passa.
      ok(await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "travar_coluna", coluna: "Em revisão", so_pessoa: true }] }));
      expect((await m.quadro()).colunas.find((c) => c.id === "revisao")?.trava).toEqual({ soPessoa: true });
    });
  });

  it("card de colunas depois de remover o quadro (NOD-415): confirmar fecha como obsoleto, sem preso na Sua vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }]));
      const r = ok(await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "substituir_colunas", colunas: DOCES }] }));
      if (!r.data.ok || !r.data.proposta_id) throw new Error("sem proposta");
      ok(await m.pessoa([{ tipo: "remover_quadro" }]));
      const obs = await executar(m.d, decidirColunasDoQuadro, { decisaoId: r.data.proposta_id, recusar: false, executor: "catcher" });
      expect(obs.data).toMatchObject({ aplicado: false, obsoleta: true });
      expect(obs.events.map((e) => e.kind)).toContain("decisao_decidida");
      expect((await m.d.repos.propostas.buscar(r.data.proposta_id))?.estado).toBe("recusada");
      expect(await m.d.repos.quadros.doAgente(m.doces.agenteId)).toBeNull();
    });
  });

  it("o recibo do card conta as tarefas que mudaram ao confirmar, mesmo as criadas depois do card (revisão do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A", status: "backlog" }]));
      const p = await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "substituir_colunas", colunas: DOCES }] });
      if (!p.data.ok || !p.data.proposta_id) throw new Error(JSON.stringify(p.data));
      ok(await m.pessoa([{ tipo: "criar_tarefa", titulo: "B", status: "backlog" }, { tipo: "criar_tarefa", titulo: "C", status: "backlog" }]));
      expect((await executar(m.d, decidirColunasDoQuadro, { decisaoId: p.data.proposta_id, recusar: false, executor: "catcher" })).data).toMatchObject({ aplicado: true });
      const recibo = (await m.d.repos.mensagens.listarDaConversa(m.doces.conversaId)).find((x) => x.texto.startsWith("Colunas trocadas"));
      expect(recibo?.texto).toContain("3 tarefas mudaram de coluna");
    });
  });

  it("fora da conversa com a pessoa (rotina, tarefa, colega) o bot não mexe nas colunas (revisão do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "M" }]));
      const antes = (await m.quadro()).colunas;
      const rotina = await m.turno("rotina");
      for (const acoes of [[{ tipo: "criar_coluna", nome: "Extra", grupo: "iniciado" }], [{ tipo: "remover_coluna", coluna: "revisao" }], [{ tipo: "substituir_colunas", colunas: DOCES }]] as const) {
        const r = await executar(m.d, gerirQuadro, { ...rotina, acoes: acoes as never });
        expect(JSON.stringify(r.data)).toContain("a pedido da pessoa");
      }
      expect((await m.quadro()).colunas).toEqual(antes);
      ok(await executar(m.d, gerirQuadro, { ...rotina, acoes: [{ tipo: "criar_tarefa", titulo: "T" }] }));
    });
  });

  it("e2e dos doces: Pedido → Compras → Produção → Finalização → Embalagem → Entrega → Pago, com progresso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: "Entregar 3 encomendas" }]));
      const ctx = await m.turno();
      const p = await executar(m.d, gerirQuadro, { ...ctx, acoes: [{ tipo: "substituir_colunas", colunas: DOCES }] });
      if (!p.data.ok || !p.data.proposta_id) throw new Error(JSON.stringify(p.data));
      expect((await executar(m.d, decidirColunasDoQuadro, { decisaoId: p.data.proposta_id, recusar: false, executor: "catcher" })).data).toMatchObject({ aplicado: true });
      expect((await m.quadro()).colunas.map((c) => c.nome)).toEqual(["Pedido", "Compras", "Produção", "Finalização", "Embalagem", "Entrega", "Pago", "Cancelado"]);
      ok(await executar(m.d, gerirQuadro, { ...ctx, acoes: [{ tipo: "criar_tarefa", titulo: "Brigadeiro", status: "Pedido" }, { tipo: "criar_tarefa", titulo: "Bolo", status: "Pedido" }, { tipo: "criar_tarefa", titulo: "Torta", status: "Pedido" }] }));
      for (const col of ["Compras", "Produção", "Finalização", "Embalagem", "Entrega", "Pago"]) ok(await executar(m.d, gerirQuadro, { ...ctx, acoes: [{ tipo: "mudar_tarefa", tarefa: "Brigadeiro", status: col }] }));
      ok(await executar(m.d, gerirQuadro, { ...ctx, acoes: [{ tipo: "mudar_tarefa", tarefa: "Torta", status: "Cancelado", motivo: "o cliente desistiu" }] }));
      const q = await m.quadro();
      expect(q.tarefas.map((t) => [t.titulo, t.status])).toEqual(expect.arrayContaining([["Brigadeiro", "c-pago"], ["Bolo", "c-pedido"], ["Torta", "cancelado"]]));
      // Feito ÷ (total − Fechado): 1 de 2, a Torta cancelada sai da conta.
      expect(progresso(q.tarefas, q.colunas)).toMatchObject({ feitas: 1, total: 2 });
    });
  });

  it("NOD-416 (revisão do PR #623): criar_tarefa com agente e sem status avisa que ficou no Backlog e como começar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: null }]));
      const r = ok(await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "criar_tarefa", titulo: "Login", agente: m.nomeCaio }] }));
      expect(r.data.ok && r.data.comecaram).toEqual([]);
      expect(r.data.instrucao).toContain("\"Login\" ficou no Backlog; para começar, status afazer");
      // Com status, ou sem agente, não há o aviso.
      const s = ok(await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "criar_tarefa", titulo: "Sem ninguém" }, { tipo: "criar_tarefa", titulo: "Já vai", agente: m.nomeCaio, status: "afazer" }] }));
      expect(s.data.instrucao).not.toContain("para começar, status afazer");
    });
  });

  it("revisão 3 do PR #623: o aviso de que ficou no Backlog acha a criada pelo id, não pelo título (dois com o mesmo título)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      ok(await m.pessoa([{ tipo: "criar_quadro", meta: null }]));
      const r = ok(await executar(m.d, gerirQuadro, { ...(await m.turno()), acoes: [{ tipo: "criar_tarefa", titulo: "Dup", agente: m.nomeCaio }, { tipo: "criar_tarefa", titulo: "Dup", agente: m.nomeCaio, status: "afazer" }] }));
      expect(r.data.ok && r.data.comecaram.length).toBe(1);
      expect(r.data.instrucao).toContain("\"Dup\" ficou no Backlog; para começar, status afazer");
    });
  });
});
