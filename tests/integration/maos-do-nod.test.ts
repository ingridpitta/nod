import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { AcaoLote } from "../../src/contracts/ferramentas-do-nod.ts";
import type { OrigemTurno } from "../../src/contracts/turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { decidirLoteDeBots, gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { registrarRelatoDoNod, verAppsConectados } from "../../src/use-cases/nod.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * As mãos do Nod (ADR-082) e a caixa do Nod (ADR-081, 0062), com banco real: gerir_bots pelo modo do Nod, o card do lote
 * decidido pela pessoa, as cercas, e registrar_relato.
 */

async function nodComTurno(d: Deps, opcoes: { modo?: ModoAprovacao; origem?: OrigemTurno } = {}) {
  const { nod } = (await executar(d, garantirNod, {})).data;
  // NOD-316: o Nod nasce em Automático; estes cenários partem do Manual, explícito, salvo o modo pedido.
  await d.repos.agentes.definirModoAprovacao(nod.id, opcoes.modo ?? "manual");
  const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: opcoes.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  if (!turno) throw new Error("turno");
  return { ctx: { turnoId: turno.id, agenteId: nod.id, conversaId: nod.conversaId }, nod };
}

async function bot(d: Deps, nome: string) {
  return (await executar(d, criarAgente, { dono: "pessoa", nome, descricao: `${nome} trabalha.` })).data.agente;
}

async function appConectado(d: Deps, slug: string) {
  const c = await d.repos.conectores.criar({ nome: slug, slug, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  await d.repos.conectores.registrarSonda(c?.id ?? "", { ok: true, catalogo: [{ nome: "listar", descricao: "lista", schema: { type: "object" }, readOnlyHint: true }, { nome: "comentar", descricao: "comenta", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
  return c;
}

const doMarlon = async (d: Deps) => (await d.repos.agentes.listar({ incluirOcultos: true })).filter((a) => a.ownerId === MARLON.pessoaId);

describeIntegracao("as mãos do Nod (ADR-082)", () => {
  it("NOD-316: o Nod da pessoa nasce em Aprovar automaticamente", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { nod } = (await executar(d, garantirNod, {})).data;
      expect((await d.repos.agentes.buscar(nod.id))?.modoAprovacao).toBe("automatico");
    });
  });

  it("manual: o pedido do Marlon vira UM card com as 5 ações e nenhum bot novo; aprovar só 2 cria 2 e marca 3 como não feitas", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d);
      await bot(d, "Dev 1");
      await bot(d, "Dev 2");
      await bot(d, "Otto");
      const antes = (await doMarlon(d)).length;
      const acoes: AcaoLote[] = [
        { tipo: "duplicar", bot: "Dev 1" },
        { tipo: "duplicar", bot: "Dev 2" },
        { tipo: "duplicar", bot: "Otto" },
        { tipo: "criar", nome: "Revisor de PR", descricao: "Revisa os PRs dos Devs.", secao: "Engenharia" },
        { tipo: "criar", nome: "Testador", descricao: "Roda os testes da branch.", secao: "Engenharia" },
      ];
      const r = await gerirBots(d, { ...ctx, resumo: "Duplicar três e criar dois em Engenharia", acoes });
      expect(r.data).toMatchObject({ ok: true, feitas: [], esperando: [0, 1, 2, 3, 4] });
      if (!r.data.ok || !r.data.decisao_id) throw new Error("sem card");
      expect((await doMarlon(d)).length).toBe(antes);
      const decisao = await d.repos.decisoes.buscar(r.data.decisao_id);
      expect(decisao).toMatchObject({ tipo: "lote_bots", estado: "pendente", agenteId: ctx.agenteId });

      const decidido = await executar(d, decidirLoteDeBots, { decisaoId: r.data.decisao_id, recusar: false, selecionados: [0, 3] });
      expect(decidido.data).toEqual({ feitas: 2, falhas: 0, recusadas: 3 });
      const depois = await doMarlon(d);
      expect(depois.map((a) => a.nome)).toEqual(expect.arrayContaining(["Dev 1 (cópia)", "Revisor de PR"]));
      expect(depois.find((a) => a.nome === "Revisor de PR")?.secao).toBe("Engenharia");
      expect(depois.some((a) => a.nome === "Testador")).toBe(false);
      const proposta = await d.repos.propostas.buscar(r.data.decisao_id);
      expect(proposta?.estado).toBe("confirmada");
      expect(proposta?.payload.kind === "lote_bots" && proposta.payload.acoes.map((a) => a.estado)).toEqual(["feita", "recusada", "recusada", "feita", "recusada"]);
      // Regression: QA de 2026-10-07 — o card e o desfecho falam do ORIGINAL ("Duplicar Dev 1"), não da cópia.
      expect(proposta?.payload.kind === "lote_bots" && proposta.payload.acoes[0]?.alvoNome).toBe("Dev 1");
      const ultima = await d.repos.mensagens.ultimaDaConversa(ctx.conversaId);
      expect(ultima?.texto).toContain("2 de 5 mudanças feitas.");
      expect(ultima?.texto).toContain("✓ Duplicar Dev 1\n");
      await expect(executar(d, decidirLoteDeBots, { decisaoId: r.data.decisao_id, recusar: false })).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("automático: o seguro roda na hora e só o excluir vira card; no total, tudo roda e nenhum card", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d, { modo: "automatico" });
      await bot(d, "Dev 1");
      const velho = await bot(d, "Dev antigo");
      const r = await gerirBots(d, { ...ctx, resumo: "Duplicar, criar e excluir", acoes: [{ tipo: "duplicar", bot: "Dev 1" }, { tipo: "criar", nome: "Novo", descricao: "x." }, { tipo: "excluir", bot: "Dev antigo" }] });
      expect(r.data).toMatchObject({ ok: true, esperando: [2] });
      if (!r.data.ok) return;
      expect(r.data.feitas.map((f) => f.i)).toEqual([0, 1]);
      const card = await d.repos.propostas.buscar(r.data.decisao_id ?? "");
      expect(card?.payload.kind === "lote_bots" && card.payload.acoes[2]).toMatchObject({ estado: "esperando", motivo: "arriscada" });
      expect((await d.repos.agentes.buscar(velho.id))?.excluidoEm).toBeNull();

      await d.repos.agentes.definirModoAprovacao(ctx.agenteId, "total");
      const total = await gerirBots(d, { ...ctx, resumo: "Excluir", acoes: [{ tipo: "excluir", bot: "Dev antigo" }, { tipo: "mudar_modo", bot: "Dev 1", modo: "automatico" }] });
      expect(total.data).toMatchObject({ ok: true, esperando: [], decisao_id: null });
      expect((await d.repos.agentes.buscar(velho.id, true))?.excluidoEm).not.toBeNull();
    });
  });

  it("NOD-443 (revisão 5 do PR #628, achado 3): a pedido de outra pessoa, o Nod em total decide pelo manual — o lote vira card", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { nod } = await nodComTurno(d, { modo: "total" });
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto", sobProcuracaoDe: randomUUID() });
      const ctx = { turnoId: turno?.id ?? "", agenteId: nod.id, conversaId: nod.conversaId };
      const antes = (await doMarlon(d)).length;
      const r = await gerirBots(d, { ...ctx, resumo: "Criar", acoes: [{ tipo: "criar", nome: "Novo", descricao: "x." }] });
      expect(r.data).toMatchObject({ ok: true, esperando: [0] });
      expect((await doMarlon(d)).length).toBe(antes);
    });
  });

  it("NOD-289 (M2): duplicar pelo Nod deixa as rotinas da cópia pausadas e avisa, no automático e pelo card", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d, { modo: "automatico" });
      const dev = await bot(d, "Dev 1");
      const conversaDev = await d.repos.conversas.buscarPropriaDoAgente(dev.id);
      await d.repos.rotinas.criar({ agenteId: dev.id, conversaId: conversaDev!.id, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "Revisar PRs", fonte: "teste", entregavel: "chat", limitesAprovacao: "sem externos", politicaSemDado: "avisar", proximaExecucao: Date.now() + 300000 });

      const r = await gerirBots(d, { ...ctx, resumo: "Duplicar o Dev 1", acoes: [{ tipo: "duplicar", bot: "Dev 1" }] });
      expect(r.data).toMatchObject({ ok: true, esperando: [], feitas: [{ i: 0, aviso: "rotinas da cópia vieram pausadas; ative em Rotinas" }] });
      if (!r.data.ok) return;
      expect(r.data.instrucao).toContain("Repita os avisos de feitas.");
      const copia = (await doMarlon(d)).find((a) => a.nome === "Dev 1 (cópia)");
      expect(await d.repos.rotinas.listarDoAgente(copia!.id)).toMatchObject([{ estado: "pausada" }]);
      const conversaCopia = await d.repos.conversas.buscarPropriaDoAgente(copia!.id);
      expect((await d.repos.mensagens.listarDaConversa(conversaCopia!.id)).some((m) => /^Rotina ativa/.test(m.texto))).toBe(false);

      // Pelo card (Nod no manual, a pessoa aprova): as rotinas também vêm pausadas, e o recibo diz isso.
      await d.repos.agentes.definirModoAprovacao(ctx.agenteId, "manual");
      const card = await gerirBots(d, { ...ctx, resumo: "Duplicar de novo", acoes: [{ tipo: "duplicar", bot: "Dev 1" }] });
      if (!card.data.ok || !card.data.decisao_id) throw new Error("sem card");
      await executar(d, decidirLoteDeBots, { decisaoId: card.data.decisao_id, recusar: false });
      const segunda = (await doMarlon(d)).find((a) => a.nome === "Dev 1 (cópia 2)");
      expect(await d.repos.rotinas.listarDoAgente(segunda!.id)).toMatchObject([{ estado: "pausada" }]);
      expect((await d.repos.mensagens.ultimaDaConversa(ctx.conversaId))?.texto).toContain("✓ Duplicar Dev 1 (rotinas da cópia vieram pausadas; ative em Rotinas)");
    });
  });

  it("emenda de 2026-10-18 da ADR-059: pôr um bot em total é sempre card, até com o Nod em total; aprovar o card liga", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d, { modo: "total" });
      const dev = await bot(d, "Dev 1");
      const r = await gerirBots(d, { ...ctx, resumo: "Dev 1 sem aprovações e no automático o Otto", acoes: [{ tipo: "mudar_modo", bot: "Dev 1", modo: "total" }, { tipo: "criar", nome: "Otto", descricao: "x." }] });
      expect(r.data).toMatchObject({ ok: true, esperando: [0] });
      if (!r.data.ok) return;
      expect(r.data.feitas.map((f) => f.i)).toEqual([1]);
      const card = await d.repos.propostas.buscar(r.data.decisao_id ?? "");
      expect(card?.payload.kind === "lote_bots" && card.payload.acoes[0]).toMatchObject({ estado: "esperando", motivo: "ligar_total" });
      // NOD-316: o Dev 1 nasceu em Automático e continua nele até o card ser aprovado.
      expect((await d.repos.agentes.buscar(dev.id))?.modoAprovacao).toBe("automatico");

      await executar(d, decidirLoteDeBots, { decisaoId: r.data.decisao_id ?? "", recusar: false });
      expect((await d.repos.agentes.buscar(dev.id))?.modoAprovacao).toBe("total");
    });
  });

  it("dar_acesso: com o app conectado roda no automático; depois de conteúdo de fora vira card (cerca 3); app não conectado recusa o lote", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d, { modo: "automatico" });
      const dev = await bot(d, "Dev 1");
      await appConectado(d, "github-nod");
      expect((await verAppsConectados(d, ctx)).data).toMatchObject({ ok: true, apps: [{ slug: "github-nod", niveis: ["leitura", "escrita"] }] });

      const semApp = await gerirBots(d, { ...ctx, resumo: "x", acoes: [{ tipo: "criar", nome: "A", descricao: "a." }, { tipo: "dar_acesso", bot: "Dev 1", app: "gmail-nao", nivel: "leitura" }] });
      expect(semApp.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await doMarlon(d)).some((a) => a.nome === "A")).toBe(false);

      const limpo = await gerirBots(d, { ...ctx, resumo: "Acesso", acoes: [{ tipo: "dar_acesso", bot: "Dev 1", app: "github-nod", nivel: "escrita" }] });
      expect(limpo.data).toMatchObject({ ok: true, esperando: [] });
      expect((await d.repos.concessoes.doAgente(dev.id)).map((c) => c.capacidade).sort()).toEqual(["comentar", "listar"]);

      await d.repos.turnos.contaminar(ctx.turnoId, Date.now());
      const outro = await bot(d, "Dev 2");
      const sujo = await gerirBots(d, { ...ctx, resumo: "Acesso depois de ler a web", acoes: [{ tipo: "dar_acesso", bot: "Dev 2", app: "github-nod", nivel: "leitura" }] });
      expect(sujo.data).toMatchObject({ ok: true, esperando: [0] });
      expect(await d.repos.concessoes.doAgente(outro.id)).toEqual([]);
      if (!sujo.data.ok) return;
      await executar(d, decidirLoteDeBots, { decisaoId: sujo.data.decisao_id ?? "", recusar: false });
      expect((await d.repos.concessoes.doAgente(outro.id)).map((c) => c.capacidade)).toEqual(["listar"]);
    });
  });

  it("\"@ref\": criar e dar acesso ao bot novo no manual; aprovar só o acesso falha por depender do criar recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d);
      await appConectado(d, "github-ref");
      const r = await gerirBots(d, { ...ctx, resumo: "Revisor com GitHub", acoes: [{ tipo: "criar", nome: "Revisor", descricao: "Revisa.", ref: "rev" }, { tipo: "dar_acesso", bot: "@rev", app: "github-ref", nivel: "leitura" }] });
      if (!r.data.ok) throw new Error("lote");
      const decidido = await executar(d, decidirLoteDeBots, { decisaoId: r.data.decisao_id ?? "", recusar: false, selecionados: [1] });
      expect(decidido.data).toEqual({ feitas: 0, falhas: 1, recusadas: 1 });
      const p = await d.repos.propostas.buscar(r.data.decisao_id ?? "");
      expect(p?.payload.kind === "lote_bots" && p.payload.acoes[1]).toMatchObject({ estado: "falhou", erro: "depende_de_acao_recusada" });
    });
  });

  it("cerca 2: fora do turno do Nod com a pessoa, as ferramentas recusam sem tocar em nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const daRotina = await nodComTurno(d, { origem: "rotina" });
      expect((await gerirBots(d, { ...daRotina.ctx, resumo: "x", acoes: [{ tipo: "criar", nome: "A", descricao: "a." }] })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      expect((await registrarRelatoDoNod(d, { ...daRotina.ctx, tipo: "bug", titulo: "x", texto: "y" })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      // Um bot comum, na conversa dele: também não.
      const vera = (await executar(d, criarAgente, { dono: "pessoa", nome: "Vera", descricao: "Agenda." })).data;
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: vera.conversa.id, agenteId: vera.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "auto" });
      expect((await gerirBots(d, { turnoId: turno?.id ?? "", agenteId: vera.agente.id, conversaId: vera.conversa.id, resumo: "x", acoes: [{ tipo: "criar", nome: "A", descricao: "a." }] })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      expect((await doMarlon(d)).some((a) => a.nome === "A")).toBe(false);
    });
  });
});

describeIntegracao("a caixa do Nod (ADR-081, 0062)", () => {
  it("bug e melhoria contados ao Nod viram relatos sem mensagem, com título privado e trecho; o do botão continua exigindo a mensagem", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d);
      const bug = await registrarRelatoDoNod(d, { ...ctx, tipo: "bug", titulo: "Anexar não abre no Safari do iPhone", texto: "Tocar no clipe não faz nada.", categoria: "interface" });
      expect(bug.data).toMatchObject({ ok: true });
      const ideia = await registrarRelatoDoNod(d, { ...ctx, tipo: "melhoria", titulo: "Arrastar bot entre seções", texto: "Hoje só pelo menu." });
      expect(ideia.data.ok).toBe(true);
      const lista = await d.repos.relatos.listar();
      const doBug = lista.find((r) => bug.data.ok && r.id === bug.data.relato_id);
      expect(doBug).toMatchObject({ tipo: "bug", origem: "nod", mensagemId: null, categoria: "interface", titulo: "Anexar não abre no Safari do iPhone", resumo: "Tocar no clipe não faz nada." });
      expect(lista.find((r) => ideia.data.ok && r.id === ideia.data.relato_id)).toMatchObject({ tipo: "melhoria", categoria: "outro" });
      const prosa = await d.repos.relatos.prosaDe(doBug?.id ?? "");
      expect(prosa?.trecho?.mensagens.length).toBeGreaterThan(0);
      await expect(trx.savepoint((sp) => sp`insert into relatos (tenant_id, owner_id, conversa_id, categoria, alcance, confianca_mensagem, origem) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${ctx.conversaId}, 'outro', 'mensagem', 'confiavel', 'botao')`)).rejects.toThrow(/relatos_botao_tem_mensagem/);
    });
  });

  it("o 21º relato do Nod em 24 h volta limite_do_dia", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await nodComTurno(d);
      for (let i = 0; i < 20; i++) expect((await registrarRelatoDoNod(d, { ...ctx, tipo: "duvida", titulo: `Dúvida ${i}`, texto: "?" })).data.ok).toBe(true);
      expect((await registrarRelatoDoNod(d, { ...ctx, tipo: "duvida", titulo: "Mais uma", texto: "?" })).data).toMatchObject({ ok: false, erro: "limite_do_dia" });
    });
  });
});
