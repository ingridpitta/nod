import { describe, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { moverBot } from "../../src/use-cases/acoes/bots.ts";
import { EXECUTORES_TIMES, listarTimes, moverBotsParaTime, timesDaBarra } from "../../src/use-cases/acoes/times.ts";
import { decidirLoteDeBots } from "../../src/use-cases/gerir-bots.ts";
import { gerirTimes } from "../../src/use-cases/gerir-times.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-437: os times de bots como entidade. As seções de antes viram times sem perder ninguém; o nome é único sem
 * maiúsculas nem acento; o Sem time não se renomeia nem se exclui; excluir manda os bots ao Sem time na mesma ordem; e o
 * gerir_times faz o lote, pergunta no nome ambíguo, recusa pessoa e turno contaminado e espera o card só no excluir com bots.
 */

async function montar(trx: Tx, modo: "manual" | "automatico" | "total" = "manual") {
  const d = depsSobreTrx(trx, MARLON);
  const bot = await agenteComConversa(trx, MARLON, { nome: "Faustino", modo });
  const ids: Record<string, string> = {};
  for (const nome of ["Nara", "Otto", "Bia", "Vivi"]) ids[nome] = (await agenteComConversa(trx, MARLON, { nome })).agenteId;
  // A ordem de dentro do time: Otto antes da Nara.
  await trx`update agentes set posicao = case id when ${ids.Otto ?? ""}::uuid then 1 when ${ids.Nara ?? ""}::uuid then 2 else posicao end where id = any(${[ids.Otto, ids.Nara] as string[]}::uuid[])`;
  await d.repos.agentes.mudarSecao([ids.Nara ?? "", ids.Otto ?? ""], "Produção");
  await d.repos.agentes.mudarSecao([ids.Bia ?? ""], "Produto");
  const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  if (!turno) throw new Error("turno");
  return { d, ids, ctx: { turnoId: turno.id, agenteId: bot.agenteId, conversaId: bot.conversaId } };
}

const times = async (d: Deps) => (await executar(d, listarTimes, {})).data.times;
const nomes = async (d: Deps) => (await times(d)).map((t) => t.nome);
const idDe = async (d: Deps, nome: string) => (await times(d)).find((t) => t.nome === nome)?.id ?? "";
const secaoDe = async (d: Deps, id: string) => (await d.repos.agentes.buscar(id))?.secao ?? "";

describeIntegracao("times de bots (NOD-437)", () => {
  describe("modelo e migração", () => {
    it("as seções de antes viram times sem perder ninguém, com o Sem time no topo e uma grafia por nome", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids } = await montar(trx);
        await d.repos.agentes.mudarSecao([ids.Vivi ?? ""], "produto");
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
        const ts = await times(d);
        expect(ts.map((t) => [t.posicao, t.semTime])).toEqual([[0, true], [1, false], [2, false]]);
        // A segunda leitura não duplica nada.
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
        expect(await secaoDe(d, ids.Nara ?? "")).toBe("Produção");
      });
    });

    it("a RLS: a Ana não vê nem mexe nos times do Marlon", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d } = await montar(trx);
        const id = await idDe(d, "Produto");
        await trx.savepoint(async (sp) => {
          await vincularEscopo(sp, ANA);
          const dAna = depsSobreTrx(sp, ANA);
          expect((await times(dAna)).map((t) => t.nome)).not.toContain("Produto");
          await expect(executar(dAna, EXECUTORES_TIMES["times.renomear"], { timeId: id, nome: "Roubado" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
          // Nem pelo SQL cru: a política esconde a linha do Marlon.
          expect(await sp`select id from times where id = ${id}`).toHaveLength(0);
        });
        await vincularEscopo(trx, MARLON);
        expect(await nomes(d)).toContain("Produto");
      });
    });
  });

  describe("criar, editar e organizar", () => {
    it("nome repetido (sem maiúsculas e acento) não cria um segundo time; Sem time é reservado", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d } = await montar(trx);
        await expect(executar(d, EXECUTORES_TIMES["times.criar"], { nome: " PRODUCAO " })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "nome_repetido" });
        await expect(executar(d, EXECUTORES_TIMES["times.criar"], { nome: "sem time" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
        await expect(executar(d, EXECUTORES_TIMES["times.criar"], { nome: "   " })).rejects.toMatchObject({ codigo: "entrada_invalida" });
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
        const r = await executar(d, EXECUTORES_TIMES["times.criar"], { nome: "  Marketing   Digital " });
        expect(r.data.time).toMatchObject({ nome: "Marketing Digital", posicao: 3 });
      });
    });

    it("o Sem time não se renomeia nem se exclui, mas muda de lugar", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d } = await montar(trx);
        const sem = await idDe(d, "");
        await expect(executar(d, EXECUTORES_TIMES["times.renomear"], { timeId: sem, nome: "Outros" })).rejects.toMatchObject({ codigo: "nao_permitido" });
        await expect(executar(d, EXECUTORES_TIMES["times.excluir"], { timeId: sem })).rejects.toMatchObject({ codigo: "nao_permitido" });
        await executar(d, EXECUTORES_TIMES["times.ordenar"], { timeId: sem, posicao: 9 });
        expect(await nomes(d)).toEqual(["Produção", "Produto", ""]);
      });
    });

    it("renomear leva os bots junto; excluir manda os bots ao Sem time na mesma ordem e o Desfazer recria igual", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids } = await montar(trx);
        await executar(d, EXECUTORES_TIMES["times.renomear"], { timeId: await idDe(d, "Produção"), nome: "Fábrica" });
        expect(await secaoDe(d, ids.Nara ?? "")).toBe("Fábrica");
        await executar(d, EXECUTORES_TIMES["times.recolher"], { timeId: await idDe(d, "Fábrica"), recolhido: true });
        const r = await executar(d, EXECUTORES_TIMES["times.excluir"], { timeId: await idDe(d, "Fábrica") });
        expect(r.data.bots.map((b) => b.nome)).toEqual(["Otto", "Nara"]);
        // QA do PR #632 (mutante da ordem): no Sem time, pela agentes.posicao, quem chegou vem no fim, na ordem de antes.
        const noSemTime = (await d.repos.agentes.listar({ incluirOcultos: true })).filter((b) => b.ownerId === MARLON.pessoaId && b.dono === "pessoa" && !b.fixado && b.excluidoEm === null && (b.secao ?? "") === "" && ["Otto", "Nara"].includes(b.nome)).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0));
        expect(noSemTime.map((b) => b.nome)).toEqual(["Otto", "Nara"]);
        expect(await nomes(d)).toEqual(["", "Produto"]);
        expect([await secaoDe(d, ids.Nara ?? ""), await secaoDe(d, ids.Otto ?? "")]).toEqual(["", ""]);
        expect((await d.repos.agentes.buscar(ids.Nara ?? ""))?.excluidoEm ?? null).toBeNull();
        // Desfazer: o mesmo nome, lugar, recolhido e bots.
        await executar(d, EXECUTORES_TIMES["times.criar"], { nome: r.data.time.nome, posicao: r.data.time.posicao, recolhido: r.data.time.recolhido, bots: r.data.bots.map((b) => b.id) });
        const ts = await times(d);
        expect(ts.map((t) => [t.nome, t.recolhido])).toEqual([["", false], ["Fábrica", true], ["Produto", false]]);
        expect(await secaoDe(d, ids.Otto ?? "")).toBe("Fábrica");
      });
    });

    it("mover vários bots de uma vez cria o time que falta e usa a grafia do time que existe", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids } = await montar(trx);
        await executar(d, moverBotsParaTime, { bots: [ids.Bia ?? "", ids.Vivi ?? ""], time: "PRODUCAO" });
        expect([await secaoDe(d, ids.Bia ?? ""), await secaoDe(d, ids.Vivi ?? "")]).toEqual(["Produção", "Produção"]);
        await executar(d, moverBotsParaTime, { bots: [ids.Vivi ?? ""], time: "Vendas" });
        expect(await nomes(d)).toEqual(["", "Produção", "Produto", "Vendas"]);
        await executar(d, moverBotsParaTime, { bots: [ids.Vivi ?? ""], time: "Sem time" });
        expect(await secaoDe(d, ids.Vivi ?? "")).toBe("");
      });
    });
  });

  describe("pelo chat (gerir_times)", () => {
    it("um lote cria no topo com bots, roda na hora e registra quem pediu e por qual bot", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids, ctx } = await montar(trx);
        const r = await gerirTimes(d, { ...ctx, resumo: "Marketing no topo", acoes: [{ tipo: "criar", time: "Marketing", posicao: 1, bots: ["Bia", "Vivi"] }, { tipo: "recolher", time: "Produção", recolhido: true }] });
        expect(r.data).toMatchObject({ ok: true, esperando: [], decisao_id: null });
        expect(r.data.ok && r.data.feitas.map((f) => f.linha)).toEqual(["Time Marketing criado no topo, com Bia e Vivi", "Time Produção recolhido"]);
        expect(await nomes(d)).toEqual(["Marketing", "", "Produção", "Produto"]);
        expect(await secaoDe(d, ids.Bia ?? "")).toBe("Marketing");
        const [m] = await trx<{ texto: string }[]>`select texto from mensagens where conversa_id = ${ctx.conversaId} and assunto = 'times.organizados'`;
        expect(m?.texto).toMatch(/Pedido por .+ via bot Faustino\.$/);
      });
    });

    it("excluir um time com bots espera o card; confirmado, os bots vão ao Sem time; o resto do lote já rodou", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids, ctx } = await montar(trx);
        const r = await gerirTimes(d, { ...ctx, resumo: "limpar", acoes: [{ tipo: "renomear", time: "Produto", nome: "Produtos" }, { tipo: "excluir", time: "Produção" }] });
        expect(r.data).toMatchObject({ ok: true, esperando: [0] });
        if (!r.data.ok || !r.data.decisao_id) throw new Error("sem card");
        expect(await nomes(d)).toEqual(["", "Produção", "Produtos"]);
        const proposta = await d.repos.propostas.buscar(r.data.decisao_id);
        expect(proposta?.payload).toMatchObject({ kind: "lote_bots", acoes: [{ tipo: "excluir_time", membros: ["Otto", "Nara"], alvoNome: "Produção" }] });
        await executar(d, decidirLoteDeBots, { decisaoId: r.data.decisao_id, recusar: false });
        expect(await nomes(d)).toEqual(["", "Produtos"]);
        expect(await secaoDe(d, ids.Otto ?? "")).toBe("");
      });
    });

    it("excluir um time vazio, ou com o bot em Ignorar todas, não pede card", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx, "total");
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "excluir", time: "Produção" }] });
        expect(r.data).toMatchObject({ ok: true, esperando: [], decisao_id: null });
        expect(await nomes(d)).toEqual(["", "Produto"]);
      });
    });

    it("nome ambíguo devolve as opções para o bot perguntar; pessoa num time é explicada; nada muda", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx);
        const amb = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "recolher", time: "Prod", recolhido: true }] });
        expect(amb.data).toMatchObject({ ok: false, erro: "nome_ambiguo", problemas: [{ i: 0, opcoes: expect.arrayContaining(["Produção", "Produto"]) }] });
        const pessoa = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "mover", time: "Produto", bots: ["Marlon"] }] });
        expect(pessoa.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
        expect(!pessoa.data.ok && pessoa.data.problemas[0]?.motivo).toMatch(/times são só de bots/);
        expect((await times(d)).every((t) => !t.recolhido)).toBe(true);
      });
    });

    it("um erro no meio desfaz o lote inteiro", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx);
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "criar", time: "Vendas" }, { tipo: "renomear", time: "Produto", nome: "Produção" }] });
        expect(r.data).toMatchObject({ ok: false });
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
      });
    });

    it("turno contaminado (leu conteúdo de fora no meio) não mexe nos times (QA do PR #632, mutante)", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx);
        await d.repos.turnos.contaminar(ctx.turnoId, Date.now());
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "criar", time: "Vendas" }] });
        expect(r.data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
      });
    });

    it("QA bugs 4 e 5: a seção antiga \"Sem time\" é do Sem time; quem é movido vai para o fim do time", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids } = await montar(trx);
        const ordem = async (secao: string) => (await d.repos.agentes.listar({ incluirOcultos: true })).filter((b) => b.ownerId === MARLON.pessoaId && b.dono === "pessoa" && !b.fixado && b.excluidoEm === null && (b.secao ?? "") === secao).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0)).map((b) => b.nome);
        const antes = await ordem("Produção");
        const [quem] = (await d.repos.agentes.listar({ incluirOcultos: true })).filter((b) => b.ownerId === MARLON.pessoaId && b.dono === "pessoa" && (b.secao ?? "") === "Produto" && !b.fixado);
        if (!quem) throw new Error("sem bot no Produto");
        await executar(d, moverBotsParaTime, { bots: [quem.id], time: "Produção" });
        expect(await ordem("Produção")).toEqual([...antes, quem.nome]);
        // Bot com a seção escrita "Sem time" entra na conta do Sem time (o excluir põe quem chega depois dele).
        await d.repos.agentes.mudarSecao([ids.Otto ?? ""], "Sem time");
        await trx`update agentes set posicao = 99 where id = ${ids.Otto ?? ""}::uuid`;
        const r = await executar(d, EXECUTORES_TIMES["times.excluir"], { timeId: await idDe(d, "Produção") });
        const sem = (await d.repos.agentes.listar({ incluirOcultos: true })).filter((b) => b.ownerId === MARLON.pessoaId && b.dono === "pessoa" && !b.fixado && b.excluidoEm === null && ["", "Sem time"].includes(b.secao ?? "")).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0)).map((b) => b.nome);
        expect(sem.indexOf("Otto")).toBeLessThan(sem.indexOf(r.data.bots[0]?.nome ?? "?"));
      });
    });

    it("turno com conteúdo de fora não mexe nos times", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx);
        const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ctx.conversaId, agenteId: ctx.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "email", entradaConfianca: "nao_confiavel", modelo: "auto" });
        if (!turno) throw new Error("turno");
        const r = await gerirTimes(d, { ...ctx, turnoId: turno.id, resumo: "x", acoes: [{ tipo: "criar", time: "Vendas" }] });
        expect(r.data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
      });
    });
  });
  describe("revisão 1 (NOD-437)", () => {
    it("B2: a frota (timesDaBarra) só lê: a seção sem time não ganha linha até o sincronizar", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids } = await montar(trx);
        await executar(d, listarTimes, {});
        await d.repos.agentes.mudarSecao([ids.Vivi ?? ""], "Avulso");
        const antes = (await d.repos.times.listar()).length;
        const barra = await timesDaBarra(d);
        expect((await d.repos.times.listar()).length).toBe(antes);
        expect(barra.map((t) => t.nome)).not.toContain("Avulso");
        expect(await nomes(d)).toContain("Avulso");
        expect((await d.repos.times.listar()).length).toBe(antes + 1);
      });
    });

    it("M3: mover um bot da pessoa sempre cria a linha do time (até com espaços em volta do nome)", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids } = await montar(trx);
        await executar(d, listarTimes, {});
        const nome = `${"L".repeat(58)}`;
        await executar(d, moverBot, { agenteId: ids.Vivi ?? "", secao: `  ${nome}   ` });
        expect((await d.repos.times.listar()).map((t) => t.nome)).toContain(nome);
        expect(await secaoDe(d, ids.Vivi ?? "")).toBe(nome);
        await expect(executar(d, moverBot, { agenteId: ids.Vivi ?? "", secao: "x".repeat(61) })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      });
    });

    it("M1: excluir que espera o card mantém o time no lote; criar outro com o mesmo nome é erro de validação", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx);
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "excluir", time: "Produção" }, { tipo: "criar", time: "producao" }] });
        expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida", problemas: [{ i: 1, motivo: "já existe o time Produção" }] });
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
      });
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx, "total");
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "excluir", time: "Produção" }, { tipo: "criar", time: "producao" }] });
        expect(r.data).toMatchObject({ ok: true, esperando: [] });
        expect(await nomes(d)).toEqual(["", "Produto", "producao"]);
      });
    });

    it("M1: excluir um time que só ganhou bots no próprio lote também espera o card", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx);
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "criar", time: "Vendas", bots: ["Vivi"] }, { tipo: "excluir", time: "Vendas" }, { tipo: "criar", time: "Vendas" }] });
        expect(r.data).toMatchObject({ ok: false, problemas: [{ i: 2, motivo: "já existe o time Vendas" }] });
      });
    });

    it("A2: no automático o excluir com bots também pede o card (arriscada)", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx, "automatico");
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "excluir", time: "Produção" }] });
        expect(r.data).toMatchObject({ ok: true, esperando: [0] });
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
      });
    });

    it("M6: aprovado o card, o recibo diz quem foi de verdade para Sem time e que foi pedido via o bot", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids, ctx } = await montar(trx);
        const r = await gerirTimes(d, { ...ctx, resumo: "x", acoes: [{ tipo: "excluir", time: "Produção" }] });
        if (!r.data.ok || !r.data.decisao_id) throw new Error("sem card");
        // Antes de aprovar, a Nara sai do time pela tela.
        await executar(d, moverBotsParaTime, { bots: [ids.Nara ?? ""], time: "Produto" });
        await executar(d, decidirLoteDeBots, { decisaoId: r.data.decisao_id, recusar: false });
        const [m] = await trx<{ texto: string }[]>`select texto from mensagens where conversa_id = ${ctx.conversaId} and assunto = 'aprovacao.recibo' order by criado_em desc limit 1`;
        expect(m?.texto).toContain("Excluir o time Produção (Otto foi para Sem time)");
        expect(m?.texto).toMatch(/Pedido por .+ via bot Faustino\.$/);
        expect(await secaoDe(d, ids.Nara ?? "")).toBe("Produto");
      });
    });

    it("M8: a Ana não renomeia nem exclui o time do Marlon (RLS no UPDATE e no DELETE)", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d } = await montar(trx);
        const id = await idDe(d, "Produto");
        await trx.savepoint(async (sp) => {
          await vincularEscopo(sp, ANA);
          const dAna = depsSobreTrx(sp, ANA);
          await expect(executar(dAna, EXECUTORES_TIMES["times.renomear"], { timeId: id, nome: "Hack" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
          await expect(executar(dAna, EXECUTORES_TIMES["times.excluir"], { timeId: id })).rejects.toMatchObject({ codigo: "nao_encontrado" });
          expect(await dAna.repos.times.renomear(id, { nome: "Hack", chave: "hack" })).toBeNull();
          expect(await dAna.repos.times.excluir(id)).toBeFalsy();
        });
        await vincularEscopo(trx, MARLON);
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
      });
    });

    it("M8: as cercas do turno — procuração, parado, profundidade > 0 — não mexem nos times", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ctx } = await montar(trx);
        const novo = async (extra: Record<string, unknown>) => {
          const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ctx.conversaId, agenteId: ctx.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "auto", ...extra } as never);
          if (!t) throw new Error("turno");
          return t.id;
        };
        const procuracao = await novo({ sobProcuracaoDe: ANA.pessoaId });
        const fundo = await novo({ profundidade: 1 });
        const parado = await novo({});
        await trx`update turnos set parar_solicitado_em = now() where id = ${parado}`;
        for (const turnoId of [procuracao, fundo, parado]) {
          const r = await gerirTimes(d, { ...ctx, turnoId, resumo: "x", acoes: [{ tipo: "criar", time: "Vendas" }] });
          expect(r.data, turnoId).toMatchObject({ ok: false, erro: "fora_da_conversa" });
        }
        expect(await nomes(d)).toEqual(["", "Produção", "Produto"]);
      });
    });

    it("M8: o bot na lixeira acompanha o renomear e vai ao Sem time no excluir (restaurado, não ressuscita o time)", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d, ids } = await montar(trx);
        await trx`update agentes set excluido_em = now() where id = ${ids.Nara ?? ""}`;
        await executar(d, EXECUTORES_TIMES["times.renomear"], { timeId: await idDe(d, "Produção"), nome: "Fábrica" });
        const naLixeira = async () => (await d.repos.agentes.buscar(ids.Nara ?? "", true))?.secao ?? "";
        expect(await naLixeira()).toBe("Fábrica");
        const r = await executar(d, EXECUTORES_TIMES["times.excluir"], { timeId: await idDe(d, "Fábrica") });
        expect(r.data.bots.map((b) => b.nome)).toEqual(["Otto"]);
        expect(await naLixeira()).toBe("");
        expect(await nomes(d)).toEqual(["", "Produto"]);
      });
    });

    it("M8: o banco não deixa dois times com a mesma chave (a corrida de criar em paralelo cai no nome_repetido)", async () => {
      await withRollback(MARLON, async (trx) => {
        const { d } = await montar(trx);
        await executar(d, listarTimes, {});
        expect(await d.repos.times.criar({ nome: "Producao", chave: "producao", posicao: 9 })).toBeNull();
      });
    });
  });
});
