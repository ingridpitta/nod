import { expect, it } from "vitest";
import type { AutorLote, OpQuadro } from "../../src/contracts/quadro.ts";
import type { NovoMovimento } from "../../src/contracts/freios-quadro.ts";
import { JANELA_AGRUPAR_MS } from "../../src/domain/avisos-quadro.ts";
import { varrerAvisosDosQuadros } from "../../src/use-cases/avisos-quadro.ts";
import { comentarTarefa } from "../../src/use-cases/comentar-tarefa.ts";
import { aplicarLoteQuadro, historicoDoLote, resumoParaBot } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { ecoDoAgente, fraseDoMovimento, porqueNaoDesfaz } from "../../web/lib/freios.ts";

/** NOD-419 no banco: o histórico que o lote grava, o terminei e a passagem, o desfazer, as travas, a recusa e o laço. */
describeIntegracao("freios e travas do quadro (NOD-419)", () => {
  // NOD-430 (merge do #627): o limite "total" por padrão, para cada teste medir o freio sem o limite normal do bot sozinho na
  // frente (ele é provado em quadro-pedir-a-qualquer-agente.test.ts; os dois juntos, no fim deste arquivo).
  const lote = (d: Deps, anfitriaoId: string, ops: OpQuadro[], autor: AutorLote = { tipo: "pessoa" }) => executar(d, aplicarLoteQuadro, { autor, anfitriaoId, executor: "catcher", ops, limite: "total" });
  const ok = <T extends { data: { ok: boolean } }>(r: T) => {
    if (!r.data.ok) throw new Error(JSON.stringify(r.data));
    return r.data as Extract<T["data"], { ok: true }>;
  };

  // Merge do NOD-420 (#624): o "Precisa de você" e o Bloqueado avisam juntos depois da janela (avisos-quadro.ts), pela
  // conversa do responsável ou, sem ele, do anfitrião. Passada a janela, a volta do varredor manda o aviso.
  const avisosDepoisDaJanela = async (d: Deps, conversaId: string) => {
    const v = await varrerAvisosDosQuadros({ ...d, agora: () => Date.now() + JANELA_AGRUPAR_MS + 1000 });
    const lista = (await d.repos.mensagens.listarDaConversa(conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa");
    return { v, lista };
  };

  const montar = async (trx: Parameters<typeof depsSobreTrx>[0]) => {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const s = Math.random().toString(36).slice(2, 7);
    const host = await agenteComConversa(trx, MARLON, { nome: `Quadro ${s}` });
    const ada = await agenteComConversa(trx, MARLON, { nome: `Ada ${s}` });
    const xu = await agenteComConversa(trx, MARLON, { nome: `Xu ${s}` });
    return { d, s, host: host.agenteId, ada: ada.agenteId, xu: xu.agenteId };
  };

  it("terminei (Fazendo → Em revisão) aciona o responsável da coluna e grava o movimento; o histórico traz autor, de → para e hora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, s, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "definir_passagem", coluna: "revisao", agente: xu }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const r = ok(await lote(d, host, [{ tipo: "terminei", tarefa: "Login" }], { tipo: "agente", agenteId: ada }));
      expect(r.comecaram).toMatchObject([{ agenteId: xu }]);
      const t = r.quadro!.tarefas.find((x) => x.titulo === "Login")!;
      expect(t).toMatchObject({ status: "revisao", agenteId: xu });
      expect(t.movimentos).toMatchObject([{ tipo: "mover", de: "fazendo", para: "revisao", autor: { tipo: "agente", agenteId: ada }, autorNome: `Ada ${s}`, agenteAntesNome: `Ada ${s}`, agenteDepoisNome: `Xu ${s}`, acionou: true, loteId: r.lote!.id, criadoEm: expect.any(Number) }]);
    });
  });

  it("o agente move para coluna com responsável: passa direto (sem confirmar); desfazer_movimento volta coluna e responsável e marca", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "definir_passagem", coluna: "revisao", agente: xu }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }]));
      const passou = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tipo: "agente", agenteId: ada }));
      expect(passou.comecaram).toMatchObject([{ agenteId: xu }]);
      const m = passou.quadro!.tarefas[0]!.movimentos![0]!;
      expect(m).toMatchObject({ de: "backlog", para: "revisao", agenteDepois: xu, acionou: true });

      const desfeito = ok(await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }]));
      const t = desfeito.quadro!.tarefas[0]!;
      expect(t).toMatchObject({ status: "backlog", agenteId: ada });
      expect(desfeito.comecaram).toEqual([]);
      expect(t.movimentos).toMatchObject([{ tipo: "desfazer", de: "revisao", para: "backlog", desfeitoEm: null }, { id: m.id, desfeitoEm: expect.any(Number) }]);
      // O turno que o movimento abriu para o Xu não roda mais.
      const turno = await d.repos.turnos.buscar(passou.comecaram[0]!.turnoId);
      expect(["cancelado", "interrompido"].includes(turno!.estado) || turno!.pararSolicitadoEm != null).toBe(true);
      // Já desfeito: de novo, recusa.
      expect((await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }])).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("já foi desfeito") });
    });
  });

  it("o Desfazer do lote marca os movimentos dele; a trava 'só a pessoa' recusa o agente; a recusa deixa o motivo em comentário", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, s, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }]));
      ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }]));
      const desfeito = ok(await lote(d, host, [{ tipo: "desfazer" }]));
      expect(desfeito.quadro!.tarefas[0]).toMatchObject({ status: "backlog", movimentos: [{ desfeitoEm: expect.any(Number) }] });

      ok(await lote(d, host, [{ tipo: "travar_coluna", coluna: "revisao", so_pessoa: true }, { tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }]));
      expect((await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tipo: "agente", agenteId: ada })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa tira") });

      const recusou = await lote(d, host, [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" }], { tipo: "agente", agenteId: ada });
      const recusa = ok(recusou);
      const t = recusa.quadro!.tarefas[0]!;
      expect(t).toMatchObject({ status: "voce", agenteId: null, pergunta: expect.stringContaining("é de design") });
      expect(t.movimentos![0]).toMatchObject({ tipo: "nao_e_comigo", motivo: "é de design", autorNome: `Ada ${s}` });
      expect(await d.repos.quadroComentarios.daTarefa(t.id)).toMatchObject([{ texto: expect.stringContaining("é de design") }]);
      // Revisão 4 do PR #629 + NOD-420: sem responsável, o aviso de "Precisa de você" sai depois da janela, pela conversa do
      // anfitrião (avisos-quadro.ts), com o motivo da recusa.
      const conversaHost = (await d.repos.conversas.buscarPropriaDoAgente(host))!;
      const { v, lista } = await avisosDepoisDaJanela(d, conversaHost.id);
      expect(v.events.find((e) => e.kind === "mensagem_criada")?.dados).toMatchObject({ aviso: true });
      expect(lista).toMatchObject([{ texto: expect.stringContaining("é de design") }]);
    });
  });

  it("nao_e_comigo sem candidato num turno não confiável: a tarefa vai à pessoa só pelo card, sem aviso (revisão 4 do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const r = await executar(d, aplicarLoteQuadro, { autor: { tipo: "agente", agenteId: ada }, anfitriaoId: host, executor: "catcher", ops: [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" }], origemConfiavel: false });
      expect(ok(r).quadro!.tarefas[0]).toMatchObject({ status: "voce", agenteId: null });
      expect(r.events.some((e) => e.kind === "mensagem_criada")).toBe(false);
    });
  });

  // Revisão do PR #629: N acionamentos já gravados (como o lote e o comentário gravam) para a conta do freio.
  const acionamentos = (tarefaId: string, agenteId: string, n: number): NovoMovimento[] =>
    Array.from({ length: n }, () => ({ tarefaId, tipo: "acionou" as const, de: "fazendo", para: "fazendo", agenteAntes: agenteId, agenteDepois: agenteId, autor: { tipo: "pessoa" as const }, motivo: null, acionou: true }));

  it("o histórico sobrevive a excluir a tarefa e ao Desfazer que a traz de volta (sem cascata, revisão do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }]));
      const movido = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tipo: "agente", agenteId: ada }));
      const m = movido.quadro!.tarefas[0]!.movimentos![0]!;
      ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", excluir: true }]));
      const volta = ok(await lote(d, host, [{ tipo: "desfazer" }]));
      expect(volta.quadro!.tarefas[0]!.movimentos).toMatchObject([{ id: m.id, de: "backlog", para: "revisao", desfeitoEm: null }]);
      // E o laço continua contando o passe que já houve.
      expect((await d.repos.quadros.movimentos(volta.quadro!.id)).filter((x) => x.id === m.id)).toHaveLength(1);
    });
  });

  it("Desfazer do lote que fez desfazer_movimento devolve o movimento ao jogo; sem id, desfaz o último (revisão do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }]));
      const m = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tipo: "agente", agenteId: ada })).quadro!.tarefas[0]!.movimentos![0]!;
      const desfeito = ok(await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login" }]));
      expect(desfeito.quadro!.tarefas[0]).toMatchObject({ status: "backlog", movimentos: [{ tipo: "desfazer", desfaz: m.id }, { id: m.id, desfeitoEm: expect.any(Number) }] });
      const refeito = ok(await lote(d, host, [{ tipo: "desfazer" }]));
      expect(refeito.quadro!.tarefas[0]).toMatchObject({ status: "revisao", movimentos: [{ tipo: "desfazer", desfeitoEm: expect.any(Number) }, { id: m.id, desfeitoEm: null }] });
      // O movimento voltou a valer: desfazer_movimento de novo funciona.
      expect(ok(await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }])).quadro!.tarefas[0]!.status).toBe("backlog");
    });
  });

  it("o freio conta pelo relógio do banco: com o relógio do servidor adiantado 2 h, os 12 acionamentos da hora ainda freiam (revisão do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { host, ada, xu } = await montar(trx);
      const d = depsSobreTrx(trx, MARLON, { relogio: () => Date.now() + 2 * 60 * 60 * 1000 });
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "definir_passagem", coluna: "revisao", agente: xu }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const q = (await d.repos.quadros.doAgente(host))!;
      const t = (await d.repos.quadros.tarefas(q.id))[0]!;
      await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 12));
      const r = ok(await lote(d, host, [{ tipo: "terminei", tarefa: "Login" }], { tipo: "agente", agenteId: ada }));
      expect(r.comecaram).toEqual([]);
      expect(r.quadro!.tarefas[0]).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Freio") });
      // Revisão 4 do PR #629: o freio que levou a Bloqueado zera a conta; a pessoa responde e a esteira segue.
      expect((await d.repos.quadros.acionamentosNaHora(q.id)).get(t.id) ?? 0).toBe(0);
      expect(ok(await lote(d, host, [{ tipo: "responder", tarefa: "Login", resposta: "pode seguir" }])).comecaram).toMatchObject([{ agenteId: xu }]);
      const seguiu = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: ada }], { tipo: "agente", agenteId: xu }));
      expect(seguiu.comecaram).toMatchObject([{ agenteId: ada }]);
      expect(seguiu.quadro!.tarefas[0]).toMatchObject({ status: "fazendo", agenteId: ada });
    });
  });

  it("nao_e_comigo com sugestão: a tarefa fica na coluna com o responsável dela, que começa; o motivo vira comentário de fora (revisão do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }, { tipo: "definir_passagem", coluna: "fazendo", agente: xu }]));
      const r = ok(await lote(d, host, [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de backend" }], { tipo: "agente", agenteId: ada }));
      expect(r.quadro!.tarefas[0]).toMatchObject({ status: "fazendo", agenteId: xu });
      expect(r.comecaram).toMatchObject([{ agenteId: xu }]);
      expect(r.quadro!.tarefas[0]!.movimentos![0]).toMatchObject({ tipo: "nao_e_comigo", motivo: "é de backend", agenteAntes: ada, agenteDepois: xu, deFora: true });
      // Turno limpo, e mesmo assim o texto do bot é de fora (ADR-047/062).
      expect(await d.repos.quadroComentarios.daTarefa(r.quadro!.tarefas[0]!.id)).toMatchObject([{ texto: expect.stringContaining("é de backend"), deFora: true }]);
    });
  });

  it("o comentário que aciona grava o acionamento; passado o freio da hora, o de bot fica gravado sem acionar e o da pessoa aciona (revisão do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const comentar = (autor: AutorLote, texto: string) => comentarTarefa(d, { autor, anfitriaoId: host, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: "Login", texto });
      const q = (await d.repos.quadros.doAgente(host))!;
      const t = (await d.repos.quadros.tarefas(q.id))[0]!;
      const antes = (await d.repos.quadros.acionamentosNaHora(q.id)).get(t.id) ?? 0;
      ok(await comentar({ tipo: "pessoa" }, "olha o login"));
      expect((await d.repos.quadros.acionamentosNaHora(q.id)).get(t.id)).toBe(antes + 1);

      await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 12));
      const freado = ok(await comentar({ tipo: "agente", agenteId: xu }, "e aí?"));
      expect(freado).toMatchObject({ comecaram: [], freados: 1 });
      expect(freado.quadro!.tarefas[0]!.movimentos![0]).toMatchObject({ tipo: "freio", de: "fazendo", para: "fazendo", acionou: false, motivo: expect.stringContaining("Freio") });
      expect(freado.quadro!.tarefas[0]!.status).toBe("fazendo");
      expect(await d.repos.quadroComentarios.daTarefa(t.id)).toHaveLength(2);
      // A pessoa responde: aciona.
      expect(ok(await comentar({ tipo: "pessoa" }, "segue")).comecaram).toMatchObject([{ agenteId: ada }]);
    });
  });

  it("laço: no 7º movimento de agente entre as mesmas colunas a tarefa vai para Bloqueado sem acionar, e a pessoa recebe a linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: xu }]));
      for (let i = 0; i < 6; i++) {
        const para = i % 2 ? "fazendo" : "revisao";
        const r = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: para, agente: i % 2 ? xu : ada }], { tipo: "agente", agenteId: i % 2 ? ada : xu }));
        expect(r.quadro!.tarefas[0]!.status).toBe(para);
      }
      const r = await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu });
      const dados = ok(r);
      expect(dados.comecaram).toEqual([]);
      expect(dados.quadro!.tarefas[0]).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Laço") });
      expect(dados.quadro!.tarefas[0]!.movimentos![0]).toMatchObject({ tipo: "laco", para: "bloqueado", acionou: false });
      expect(r.events?.find((e) => e.kind === "mensagem_criada")?.dados).toMatchObject({ aviso: true });
    });
  });
  it("o Desfazer que a tela mostra num movimento de mais de 24 h o servidor aceita: busca o último sem a janela (revisão 2 do PR #629)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }]));
      const movido = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tipo: "agente", agenteId: ada }));
      const m = movido.quadro!.tarefas[0]!.movimentos![0]!;
      await trx`update quadro_movimentos set criado_em = criado_em - interval '30 hours' where id = ${m.id}`;
      const q = ok(await lote(d, host, [{ tipo: "editar_quadro", meta: null }])).quadro!;
      const t = q.tarefas[0]!;
      expect(porqueNaoDesfaz(t, t.movimentos![0]!, q.colunas)).toBeNull();
      expect(ok(await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }])).quadro!.tarefas[0]).toMatchObject({ status: "backlog", agenteId: ada });
      // O Desfazer do lote devolve o movimento ao jogo; sem id, o desfazer_movimento também o acha.
      ok(await lote(d, host, [{ tipo: "desfazer" }]));
      expect(ok(await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login" }])).quadro!.tarefas[0]).toMatchObject({ status: "backlog", agenteId: ada });
    });
  });

  it("revisão 3 do PR #629: 11 comentários de bot que acionam não empurram o último movimento para fora (o Desfazer e o eco continuam)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, s, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }]));
      const m = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tipo: "agente", agenteId: ada })).quadro!.tarefas[0]!.movimentos![0]!;
      let ultimo: Awaited<ReturnType<typeof comentarTarefa>> | null = null;
      for (let i = 0; i < 11; i++) {
        ultimo = await comentarTarefa(d, { autor: { tipo: "agente", agenteId: xu }, anfitriaoId: host, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: "Login", texto: `e aí ${i}?` });
        expect(ok(ultimo).comecaram).toMatchObject([{ agenteId: ada }]);
      }
      const q = ok(ultimo!).quadro!;
      const t = q.tarefas[0]!;
      expect(t.movimentos!.filter((x) => x.tipo === "acionou")).toHaveLength(10);
      const mover = t.movimentos!.find((x) => x.id === m.id)!;
      expect(mover).toBeDefined();
      expect(porqueNaoDesfaz(t, mover, q.colunas)).toBeNull();
      expect(ecoDoAgente(t, q.colunas, Date.now())).toMatchObject({ texto: `Ada ${s} terminou`, movimento: m.id });
      expect(resumoParaBot(q).tarefas[0]!.movimentos).toMatchObject([{ id: m.id }]);
      // O acionou do comentário diz quem foi acionado.
      const acionou = t.movimentos!.find((x) => x.tipo === "acionou")!;
      expect(acionou).toMatchObject({ agenteDepois: ada, loteId: null });
      expect(fraseDoMovimento(acionou, q.colunas)).toBe(`Xu ${s} · acionou Ada ${s} pelo comentário · Em revisão`);
    });
  });

  it("revisão 4 do PR #629: 10 comentários de bot freados depois de um movimento não o empurram para fora (o freio do comentário não mudou a tarefa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }]));
      const r = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tipo: "agente", agenteId: ada }));
      const m = r.quadro!.tarefas[0]!.movimentos![0]!;
      await d.repos.quadros.inserirMovimentos(r.quadro!.id, null, acionamentos(m.tarefaId, ada, 12));
      let ultimo: Awaited<ReturnType<typeof comentarTarefa>> | null = null;
      for (let i = 0; i < 10; i++) {
        ultimo = await comentarTarefa(d, { autor: { tipo: "agente", agenteId: xu }, anfitriaoId: host, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: "Login", texto: `e aí ${i}?` });
        expect(ok(ultimo)).toMatchObject({ comecaram: [], freados: 1 });
      }
      const movs = await d.repos.quadros.ultimosMovimentos(r.quadro!.id, 10);
      expect(movs.filter((x) => x.tipo === "freio")).toHaveLength(10);
      expect(movs.find((x) => x.id === m.id)).toBeDefined();
      const t = ok(ultimo!).quadro!.tarefas[0]!;
      expect(porqueNaoDesfaz(t, t.movimentos!.find((x) => x.id === m.id)!, ok(ultimo!).quadro!.colunas)).toBeNull();
    });
  });

  it("revisão 2 do PR #629: os últimos movimentos vêm por tarefa do quadro (até N cada), sem os da tarefa excluída", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      const r = ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }, { tipo: "criar_tarefa", titulo: "Sair", status: "backlog", agente: ada }]));
      const qid = r.quadro!.id;
      for (const st of ["afazer", "backlog", "afazer"]) ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: st, sem_iniciar: true }, { tipo: "mudar_tarefa", tarefa: "Sair", status: st, sem_iniciar: true }]));
      const [login, sair] = ["Login", "Sair"].map((n) => r.quadro!.tarefas.find((t) => t.titulo === n)!.id);
      const dois = await d.repos.quadros.ultimosMovimentos(qid, 2);
      expect(dois.filter((m) => m.tarefaId === login)).toHaveLength(2);
      expect(dois.filter((m) => m.tarefaId === sair)).toHaveLength(2);
      expect(dois.map((m) => m.criadoEm)).toEqual([...dois.map((m) => m.criadoEm)].sort((a, b) => b - a));
      ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Sair", excluir: true }]));
      const depois = await d.repos.quadros.ultimosMovimentos(qid, 10);
      expect(depois.length).toBeGreaterThan(0);
      expect(depois.every((m) => m.tarefaId === login)).toBe(true);
    });
  });

  // Revisão 5 do PR #629: os 6 movimentos de agente entre Fazendo e Em revisão (o 7º laça).
  const seisIdas = async (d: Deps, host: string, ada: string, xu: string) => {
    ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: xu }]));
    for (let i = 0; i < 6; i++) ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: i % 2 ? "fazendo" : "revisao", agente: i % 2 ? xu : ada }], { tipo: "agente", agenteId: i % 2 ? ada : xu }));
  };
  const loteComo = (d: Deps, host: string, ops: OpQuadro[], autor: AutorLote, extra: { autorNaConversa?: boolean; origemConfiavel?: boolean; limite?: "total" | "normal" }) =>
    executar(d, aplicarLoteQuadro, { autor, anfitriaoId: host, executor: "catcher", ops, limite: "total", ...extra });

  it("revisão 5 do PR #629: o agente não desfaz o lote do laço nem o do freio; a pessoa e o agente a pedido dela na conversa desfazem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      await seisIdas(d, host, ada, xu);
      expect(ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu })).quadro!.tarefas[0]!.status).toBe("bloqueado");
      expect((await lote(d, host, [{ tipo: "desfazer" }], { tipo: "agente", agenteId: xu })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa desfaz") });
      // O turno da foto já não vive: volta à espera (como todo Desfazer), fora de Bloqueado.
      expect(ok(await lote(d, host, [{ tipo: "desfazer" }])).quadro!.tarefas[0]!.status).not.toBe("bloqueado");
    });
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "definir_passagem", coluna: "revisao", agente: xu }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const q = (await d.repos.quadros.doAgente(host))!;
      const t = (await d.repos.quadros.tarefas(q.id))[0]!;
      await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 12));
      expect(ok(await lote(d, host, [{ tipo: "terminei", tarefa: "Login" }], { tipo: "agente", agenteId: ada })).quadro!.tarefas[0]!.status).toBe("bloqueado");
      expect((await lote(d, host, [{ tipo: "desfazer" }], { tipo: "agente", agenteId: ada })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa desfaz") });
      expect(ok(await loteComo(d, host, [{ tipo: "desfazer" }], { tipo: "agente", agenteId: ada }, { autorNaConversa: true })).quadro!.tarefas[0]!.status).not.toBe("bloqueado");
    });
  });

  it("revisão 5 do PR #629: o laço que deixa a tarefa sem responsável avisa pela conversa de quem moveu; de turno não confiável, só o card", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      await seisIdas(d, host, ada, xu);
      const r = await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: null }], { tipo: "agente", agenteId: xu });
      expect(ok(r).quadro!.tarefas[0]).toMatchObject({ status: "bloqueado", agenteId: null });
      const conversaXu = await d.repos.conversas.buscarPropriaDoAgente(xu);
      expect(r.events.filter((e) => e.kind === "mensagem_criada")).toMatchObject([{ dados: { aviso: true }, conversaId: conversaXu!.id }]);
    });
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      await seisIdas(d, host, ada, xu);
      const r = await loteComo(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu }, { origemConfiavel: false });
      expect(ok(r).quadro!.tarefas[0]!.status).toBe("bloqueado");
      // Revisão 7 do PR #629: o aviso é texto do sistema e sai sempre; de turno não confiável, sem o título da tarefa.
      expect(r.events.filter((e) => e.kind === "mensagem_criada")).toHaveLength(1);
      const conversaAda = (await d.repos.conversas.buscarPropriaDoAgente(ada))!;
      const avisos = (await d.repos.mensagens.listarDaConversa(conversaAda.id)).filter((x) => x.payload?.kind === "aviso_pessoa");
      expect(avisos).toMatchObject([{ texto: expect.stringMatching(/^Uma tarefa do quadro foi para Bloqueado: Laço/) }]);
      expect(avisos[0]!.texto).not.toContain("Login");
      // Revisão 8 do PR #629: os nomes das colunas também saem (um turno de fora pode tê-los escrito).
      expect(avisos[0]!.texto).not.toMatch(/Fazendo|revisão/);
      expect(avisos[0]!.texto).toContain("entre duas colunas");
    });
  });

  it("revisão 8 do PR #629: o laço de mais de 24 h segura a tarefa mesmo depois de outro movimento dentro da espera", async () => {
    // Depois do laço (envelhecido 30 h), um movimento na espera dentro das 24 h: Bloqueado → Precisa de você, troca de
    // responsável em Bloqueado, ou "não é comigo". O agente de fora continua sem tirar a tarefa de lá.
    const depois = (ada: string, xu: string): { ops: OpQuadro[]; autor: string }[] => [
      { ops: [{ tipo: "mudar_tarefa", tarefa: "Login", status: "voce", pergunta: "Qual dos dois segue?" }], autor: xu },
      { ops: [{ tipo: "mudar_tarefa", tarefa: "Login", agente: xu }], autor: xu },
      { ops: [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "não é meu" }], autor: ada },
    ];
    for (const i of [0, 1, 2]) {
      await withRollback(MARLON, async (trx) => {
        const { d, host, ada, xu } = await montar(trx);
        await seisIdas(d, host, ada, xu);
        const laco = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu })).quadro!.tarefas[0]!;
        expect(laco.status).toBe("bloqueado");
        await trx`update quadro_movimentos set criado_em = criado_em - interval '30 hours' where tarefa_id = ${laco.id}`;
        const passo = depois(ada, xu)[i]!;
        const meio = ok(await lote(d, host, passo.ops, { tipo: "agente", agenteId: passo.autor })).quadro!.tarefas[0]!;
        expect(["bloqueado", "voce"]).toContain(meio.status);
        for (const agenteId of [ada, xu]) {
          expect((await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: agenteId }], { tipo: "agente", agenteId })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa a tira de lá") });
        }
        expect(ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }])).quadro!.tarefas[0]!.status).toBe("revisao");
      });
    }
  });

  it("revisão 8 do PR #629: o agente fora da conversa não exclui a tarefa parada pelo laço ou pelo freio; a pessoa e o agente na conversa limpa excluem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      await seisIdas(d, host, ada, xu);
      expect(ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu })).quadro!.tarefas[0]!.status).toBe("bloqueado");
      const excluir: OpQuadro[] = [{ tipo: "mudar_tarefa", tarefa: "Login", excluir: true }];
      expect((await lote(d, host, excluir, { tipo: "agente", agenteId: xu })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa a exclui") });
      expect((await loteComo(d, host, excluir, { tipo: "agente", agenteId: xu }, { autorNaConversa: true, origemConfiavel: false })).data).toMatchObject({ ok: false });
      expect(ok(await loteComo(d, host, excluir, { tipo: "agente", agenteId: xu }, { autorNaConversa: true })).quadro!.tarefas).toEqual([]);
    });
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "definir_passagem", coluna: "revisao", agente: xu }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const q = (await d.repos.quadros.doAgente(host))!;
      const t = (await d.repos.quadros.tarefas(q.id))[0]!;
      await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 12));
      expect(ok(await lote(d, host, [{ tipo: "terminei", tarefa: "Login" }], { tipo: "agente", agenteId: ada })).quadro!.tarefas[0]!.status).toBe("bloqueado");
      expect((await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", excluir: true }], { tipo: "agente", agenteId: ada })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("o freio a parou") });
      expect(ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", excluir: true }])).quadro!.tarefas).toEqual([]);
    });
  });

  it("revisão 8 do PR #629: no 4º 'não é comigo' a tarefa vai para o dono em Bloqueado, e a pessoa recebe o aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      // Três passes antes (ada, xu, ada), cada um devolvido pela pessoa a outro agente.
      for (const [quem, proximo] of [[ada, xu], [xu, ada], [ada, xu]] as const) {
        ok(await lote(d, host, [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "não é meu" }], { tipo: "agente", agenteId: quem }));
        ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: proximo }]));
      }
      const r = await lote(d, host, [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "também não" }], { tipo: "agente", agenteId: xu });
      expect(ok(r).quadro!.tarefas[0]).toMatchObject({ status: "bloqueado", agenteId: null, pergunta: expect.stringMatching(/^4ª recusa/) });
      // NOD-420: o Bloqueado sem responsável avisa depois da janela, pela conversa do anfitrião.
      const conversaHost = (await d.repos.conversas.buscarPropriaDoAgente(host))!;
      const { lista } = await avisosDepoisDaJanela(d, conversaHost.id);
      expect(lista).toMatchObject([{ texto: expect.stringContaining("4ª recusa") }]);
    });
  });

  it("revisão 5 do PR #629: o comentário de bot com dois alvos a 1 do freio aciona só um; o outro fica sem acionar, com o freio registrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, s, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const q = (await d.repos.quadros.doAgente(host))!;
      const t = (await d.repos.quadros.tarefas(q.id))[0]!;
      await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 11));
      const r = ok(await comentarTarefa(d, { autor: { tipo: "agente", agenteId: xu }, anfitriaoId: host, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: "Login", texto: `@Quadro ${s} e @Ada ${s}, olhem` }));
      expect(r.comecaram).toHaveLength(1);
      expect(r).toMatchObject({ comecaram: [{ agenteId: ada }], freados: 1 });
      expect((await d.repos.quadros.acionamentosNaHora(q.id)).get(t.id)).toBe(12);
      expect(r.quadro!.tarefas[0]!.movimentos!.filter((m) => m.tipo === "freio")).toMatchObject([{ de: "fazendo", para: "fazendo", acionou: false }]);
    });
  });

  it("revisão 6 do PR #629: o laço desfeito pela pessoa continua cortando: o movimento seguinte do agente não laça de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      await seisIdas(d, host, ada, xu);
      expect(ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu })).quadro!.tarefas[0]!.status).toBe("bloqueado");
      // A pessoa desfaz o laço pelo movimento (volta a Fazendo, com o Xu) e o Xu manda para Em revisão uma vez.
      ok(await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login" }]));
      const r = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu }));
      expect(r.quadro!.tarefas[0]).toMatchObject({ status: "revisao", agenteId: ada });
      expect(r.comecaram).toMatchObject([{ agenteId: ada }]);
    });
  });

  it("revisão 6 do PR #629: o freio desfeito continua zerando a conta do banco", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "definir_passagem", coluna: "revisao", agente: xu }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const q = (await d.repos.quadros.doAgente(host))!;
      const t = (await d.repos.quadros.tarefas(q.id))[0]!;
      await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 12));
      expect(ok(await lote(d, host, [{ tipo: "terminei", tarefa: "Login" }], { tipo: "agente", agenteId: ada })).quadro!.tarefas[0]!.status).toBe("bloqueado");
      ok(await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login" }]));
      expect((await d.repos.quadros.acionamentosNaHora(q.id)).get(t.id) ?? 0).toBe(0);
    });
  });

  it("revisão 7 do PR #629: depois do laço o agente fora da conversa não tira a tarefa de Bloqueado (nem com o laço de mais de 24 h); a pessoa tira e a pergunta sai", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      await seisIdas(d, host, ada, xu);
      const laco = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }], { tipo: "agente", agenteId: xu })).quadro!.tarefas[0]!;
      expect(laco.status).toBe("bloqueado");
      const sair: OpQuadro[] = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }];
      for (const agenteId of [ada, xu]) expect((await lote(d, host, sair, { tipo: "agente", agenteId })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa a tira de lá") });
      // Fora da janela de 24 h do histórico, o último movimento desfazível ainda diz que foi o laço.
      await trx`update quadro_movimentos set criado_em = criado_em - interval '30 hours' where tarefa_id = ${laco.id}`;
      expect((await lote(d, host, sair, { tipo: "agente", agenteId: ada })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("só a pessoa a tira de lá") });
      expect(ok(await lote(d, host, sair)).quadro!.tarefas[0]).toMatchObject({ status: "revisao", pergunta: null });
    });
  });

  it("revisão 7 do PR #629: depois do freio o agente fora da conversa não tira a tarefa de Bloqueado; o agente na conversa limpa tira", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "definir_passagem", coluna: "revisao", agente: xu }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const q = (await d.repos.quadros.doAgente(host))!;
      const t = (await d.repos.quadros.tarefas(q.id))[0]!;
      await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 12));
      expect(ok(await lote(d, host, [{ tipo: "terminei", tarefa: "Login" }], { tipo: "agente", agenteId: ada })).quadro!.tarefas[0]!.status).toBe("bloqueado");
      const sair: OpQuadro[] = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }];
      expect((await lote(d, host, sair, { tipo: "agente", agenteId: xu })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("o freio a parou") });
      expect((await loteComo(d, host, sair, { tipo: "agente", agenteId: xu }, { autorNaConversa: true, origemConfiavel: false })).data).toMatchObject({ ok: false });
      expect(ok(await loteComo(d, host, sair, { tipo: "agente", agenteId: xu }, { autorNaConversa: true })).quadro!.tarefas[0]).toMatchObject({ status: "fazendo", pergunta: null });
    });
  });

  it("revisão 7 do PR #629: o freio do comentário avisa na conversa do responsável; de turno não confiável, sem o título", async () => {
    for (const origemConfiavel of [true, false]) {
      await withRollback(MARLON, async (trx) => {
        const { d, host, ada, xu } = await montar(trx);
        ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
        const q = (await d.repos.quadros.doAgente(host))!;
        const t = (await d.repos.quadros.tarefas(q.id))[0]!;
        await d.repos.quadros.inserirMovimentos(q.id, null, acionamentos(t.id, ada, 12));
        const comentar = () => comentarTarefa(d, { autor: { tipo: "agente", agenteId: xu }, anfitriaoId: host, executor: "catcher", ops: [], origemConfiavel }, { tipo: "comentar", tarefa: "Login", texto: "e aí?" });
        const r = await comentar();
        expect(ok(r)).toMatchObject({ comecaram: [], freados: 1 });
        const conversaAda = (await d.repos.conversas.buscarPropriaDoAgente(ada))!;
        expect(r.events!.filter((e) => e.kind === "mensagem_criada")).toMatchObject([{ dados: { aviso: true }, conversaId: conversaAda.id }]);
        const avisos = (await d.repos.mensagens.listarDaConversa(conversaAda.id)).filter((x) => x.payload?.kind === "aviso_pessoa");
        expect(avisos).toMatchObject([{ texto: origemConfiavel ? expect.stringMatching(/^Em "Login": Freio/) : expect.stringMatching(/^Numa tarefa do quadro: Freio/) }]);
        const telemetria = await trx<{ dados: Record<string, unknown> }[]>`select dados from events where kind = 'quadro_avisou'`;
        expect(telemetria.map((e) => e.dados)).toEqual([{ quadro_id: q.id, tipo: "freio", tarefas: 1, mensagem_id: avisos[0]!.id }]);
        // O segundo comentário freado na mesma hora não repete o aviso.
        ok(await comentar());
        expect((await d.repos.mensagens.listarDaConversa(conversaAda.id)).filter((x) => x.payload?.kind === "aviso_pessoa")).toHaveLength(1);
      });
    }
  });

  it("revisão 6 do PR #629: o nao_e_comigo no fim de um lote que já moveu a tarefa é recusado; reatribuída depois dele, não deixa comentário de recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "travar_coluna", coluna: "fazendo", so_pessoa: true }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const r = await loteComo(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: ada }, { tipo: "nao_e_comigo", tarefa: "Login", motivo: "não é meu" }], { tipo: "agente", agenteId: ada }, { origemConfiavel: false });
      expect(r.data).toMatchObject({ ok: false, detalhe: expect.stringContaining("já mudou de coluna ou de mão neste lote") });
      const q = (await d.repos.quadros.doAgente(host))!;
      expect((await d.repos.quadros.tarefas(q.id))[0]).toMatchObject({ status: "fazendo", agenteId: ada });

      const reatribuida = ok(await loteComo(d, host, [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "não é meu" }, { tipo: "mudar_tarefa", tarefa: "Login", agente: xu }], { tipo: "agente", agenteId: ada }, { autorNaConversa: true }));
      const t = reatribuida.quadro!.tarefas[0]!;
      expect(t).toMatchObject({ agenteId: xu });
      expect(await d.repos.quadroComentarios.daTarefa(t.id)).toEqual([]);
    });
  });

  it("revisão 9 do PR #629: nao_e_comigo numa tarefa criada no mesmo lote grava o comentário na tarefa de verdade (não o id do plano)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }]));
      const r = ok(await lote(d, host, [{ tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }, { tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" }], { tipo: "agente", agenteId: ada }));
      const t = r.quadro!.tarefas[0]!;
      expect(t).toMatchObject({ status: "voce", agenteId: null });
      expect(await d.repos.quadroComentarios.daTarefa(t.id)).toMatchObject([{ tarefaId: t.id, texto: expect.stringContaining("é de design") }]);
    });
  });

  it("revisão 9 do PR #629: o histórico do lote só traz o desfazível antigo da tarefa que espera ou que o lote desfaz, não o de todas", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "backlog", agente: ada }, { tipo: "criar_tarefa", titulo: "Outra", status: "fazendo", agente: ada }]));
      const login = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tipo: "agente", agenteId: ada })).quadro!.tarefas.find((x) => x.titulo === "Login")!;
      const velho = login.movimentos![0]!;
      await trx`update quadro_movimentos set criado_em = criado_em - interval '30 hours' where id = ${velho.id}`;
      ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Outra", status: "bloqueado" }]));
      const q = (await d.repos.quadros.doAgente(host))!;
      const tarefas = await d.repos.quadros.tarefas(q.id);
      const ids = async (ops: OpQuadro[]) => (await historicoDoLote(d, q.id, ops, tarefas)).map((m) => m.id);
      // Uma tarefa em espera (Outra) não traz o passe velho de Login, que não espera.
      expect(await ids([{ tipo: "mudar_tarefa", tarefa: "Outra", status: "fazendo" }])).not.toContain(velho.id);
      expect(await ids([{ tipo: "desfazer_movimento", tarefa: "Outra" }])).not.toContain(velho.id);
      // O lote que desfaz em Login o lê (a tela oferece o Desfazer nele).
      expect(await ids([{ tipo: "desfazer_movimento", tarefa: "Login" }])).toContain(velho.id);
    });
  });

  it("revisão 9 do PR #629: o resumo do bot traz a pergunta (o motivo) também da tarefa em Bloqueado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      const q = ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado", pergunta: "Falta o acesso ao banco" }], { tipo: "agente", agenteId: ada })).quadro!;
      expect(resumoParaBot(q).tarefas[0]).toMatchObject({ status: "bloqueado", pergunta: "Falta o acesso ao banco" });
    });
  });

  it("revisão 10 do PR #629: a tarefa que o 4º passe pôs em Bloqueado só a pessoa tira e desfaz (também vinda de Precisa de você e com mais de 24 h)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: ada }]));
      for (const [quem, proximo] of [[ada, xu], [xu, ada], [ada, xu]] as const) {
        ok(await lote(d, host, [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "não é meu" }], { tipo: "agente", agenteId: quem }));
        // A pessoa dá a tarefa ao próximo sem tirá-la de Precisa de você: o 4º passe vai de lá a Bloqueado.
        ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", agente: proximo }]));
      }
      const quarto = ok(await lote(d, host, [{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "também não" }], { tipo: "agente", agenteId: xu })).quadro!;
      const t = quarto.tarefas[0]!;
      expect(t).toMatchObject({ status: "bloqueado", agenteId: null });
      expect(t.movimentos![0]).toMatchObject({ tipo: "nao_e_comigo", de: "voce", para: "bloqueado" });
      expect(resumoParaBot(quarto).tarefas[0]!.movimentos![0]).toMatchObject({ para: "bloqueado", so_a_pessoa_desfaz: true });
      const SO_A_PESSOA = { ok: false, detalhe: expect.stringContaining("só a pessoa") };
      expect((await lote(d, host, [{ tipo: "desfazer" }], { tipo: "agente", agenteId: xu })).data).toMatchObject(SO_A_PESSOA);
      expect((await lote(d, host, [{ tipo: "desfazer_movimento", tarefa: "Login" }], { tipo: "agente", agenteId: xu })).data).toMatchObject(SO_A_PESSOA);
      // Mais de 24 h depois, e com a troca de responsável dentro da espera, a entrada ainda vale.
      await trx`update quadro_movimentos set criado_em = criado_em - interval '30 hours' where tarefa_id = ${t.id}`;
      ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", agente: ada }]));
      const sair: OpQuadro[] = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }];
      expect((await lote(d, host, sair, { tipo: "agente", agenteId: ada })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("o limite de recusas") });
      expect(ok(await lote(d, host, sair)).quadro!.tarefas[0]).toMatchObject({ status: "fazendo", agenteId: ada, pergunta: null });
    });
  });

  it("freios × NOD-430: o laço vale para o bot sozinho (limite normal, na tarefa dele) e para o bot a pedido da pessoa (total, na tarefa de outro)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, host, ada, xu } = await montar(trx);
      ok(await lote(d, host, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Login", status: "fazendo", agente: xu }]));
      const ir = (i: number, autor: string, extra: { autorNaConversa?: boolean; limite: "total" | "normal" }) => loteComo(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: i % 2 ? "fazendo" : "revisao" }], { tipo: "agente", agenteId: autor }, extra);
      // O Xu sozinho, seis idas e voltas na própria tarefa: passam; a 7ª laça, sem acionar ninguém.
      for (let i = 0; i < 6; i++) ok(await ir(i, xu, { limite: "normal" }));
      const laco = ok(await ir(6, xu, { limite: "normal" }));
      expect(laco.quadro!.tarefas[0]).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Laço") });
      expect(laco.comecaram).toEqual([]);
      // A pessoa tira de lá; a Ada, a pedido dela na conversa (total), leva a tarefa do Xu: a conta recomeçou, e a 7ª laça.
      ok(await lote(d, host, [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }]));
      for (let i = 0; i < 6; i++) ok(await ir(i, ada, { autorNaConversa: true, limite: "total" }));
      expect(ok(await ir(6, ada, { autorNaConversa: true, limite: "total" })).quadro!.tarefas[0]).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Laço") });
    });
  });
});
