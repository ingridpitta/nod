import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { VOLTAS_SEGUIDAS_MAX } from "../../src/contracts/ferramentas-trabalho.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../src/domain/cota-da-ia.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { enfileirarRetomada } from "../../src/use-cases/enfileirar-retomada.ts";
import { meChameAs, REGRA_VOLTAS_SEM_NOVIDADE } from "../../src/use-cases/me-chame-as.ts";
import { fecharComResposta, retomarComResposta } from "../../src/use-cases/responder-decisao.ts";
import { criarTrabalho, listarTrabalhos, pararTrabalho } from "../../src/use-cases/trabalhos.ts";
import { esperarErro } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-086 (definido em 2026-10-08; revisto na revisão do #212): "me chame às 16:00". A chamada só anota o pedido no turno;
 * a volta nasce quando ele termina bem, com `acordar_em`, e o `reivindicar` só a entrega a partir da hora. Até lá a task
 * fica `rodando` sem processo — "volta às 16:05".
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const SUCESSO = { desfecho: "sucesso" as const, texto: "vou esperar o CI", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };

async function montar(trx: Tx, o: { semTrabalho?: boolean } = {}) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const trabalho = o.semTrabalho ? null : (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo: "Acompanhar o CI do PR", origem: "pessoa" })).trabalho;
  const enfileirado = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: trabalho?.id ?? null });
  if (!enfileirado) throw new Error("turno");
  const machineId = randomUUID();
  const turno = await repos.turnos.reivindicar({ machineId, agora: Date.now() });
  if (turno?.id !== enfileirado.id) throw new Error("reivindicar");
  const assentar = (id = turno.id) => assentarTurno(deps, { turnoId: id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "vou esperar o CI" }, resultado: SUCESSO, executor: "catcher" });
  const voltas = async () => (await repos.turnos.listarDaConversa(base.conversaId, 50)).filter((t) => t.acordarEm != null);
  return { ...base, deps, repos, trabalho, turno, machineId, assentar, voltas, ctx: { turnoId: turno.id, agenteId: base.agenteId, conversaId: base.conversaId } };
}

describeIntegracao("me chame às (ADR-086)", () => {
  it("a chamada só anota; a volta nasce no assentamento, no mesmo trabalho e com o harness do turno; a fila só a entrega na hora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await meChameAs(m.deps, { ...m.ctx, em_minutos: 20, motivo: "ver se o CI do PR #212 passou" });
      if (!r.data.ok) throw new Error("recusou");
      expect(r.data.instrucao).toContain("encerre o turno");
      expect(await m.voltas()).toEqual([]);

      await m.assentar();
      const [volta] = await m.voltas();
      const acordar = Date.parse(r.data.acordar_em);
      expect(volta).toMatchObject({ origem: "retomada", retomaTurnoId: m.turno.id, trabalhoId: m.trabalho!.id, estado: "pendente", acordarEm: acordar, modelo: "sonnet", harness: "claude-cli" });
      expect(volta?.entradaTexto).toContain("ver se o CI do PR #212 passou");

      expect((await m.repos.trabalhos.buscar(m.trabalho!.id))?.estado).toBe("rodando");
      const dto = (await listarTrabalhos(m.deps, {})).data.trabalhos.find((t) => t.id === m.trabalho!.id);
      expect(dto).toMatchObject({ estado: "rodando", turnoVivoId: null, acordaEm: acordar });

      expect(await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })).toBeNull();
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: acordar + 1 }))?.id).toBe(volta?.id);
    });
  });

  it("a marca de conteúdo de fora lida DEPOIS da chamada vai junto para a volta (ADR-062)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await meChameAs(m.deps, { ...m.ctx, em_minutos: 10, motivo: "ver o deploy" });
      await m.repos.turnos.contaminar(m.turno.id, Date.now());
      await m.assentar();
      const [volta] = await m.voltas();
      expect(await m.repos.turnos.contaminado(volta!.id)).toBe(true);
    });
  });

  it("o Parar vence: parada antes da chamada, a chamada é recusada; parada depois, a volta não nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await meChameAs(m.deps, { ...m.ctx, em_minutos: 10, motivo: "ver o deploy" });
      await pararTrabalho(m.deps, { trabalhoId: m.trabalho!.id });
      // A task já está parada (task_fechada) e o turno tem o Parar pedido (turno_parado): recusado de um jeito ou de outro.
      expect((await meChameAs(m.deps, { ...m.ctx, em_minutos: 10, motivo: "de novo" })).data).toMatchObject({ ok: false });
      await m.assentar();
      expect(await m.voltas()).toEqual([]);
    });
  });

  it("uma aprovação durante a espera não gruda na volta: sai na hora, numa retomada própria", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await meChameAs(m.deps, { ...m.ctx, em_minutos: 60, motivo: "ver o CI" });
      await m.assentar();
      const assentado = await m.repos.turnos.buscar(m.turno.id);
      const { turno, nova } = await enfileirarRetomada(m.deps, { original: assentado!, entradaTexto: "aprovado", prazoEm: Date.now() + 600_000 });
      expect(nova).toBe(true);
      expect(turno?.acordarEm ?? null).toBeNull();
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(turno?.id);
    });
  });

  it("NOD-279 D8: a aprovação que chega durante a espera da cota se junta à volta da cota e a acorda (não abre uma 2ª retomada)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.assentar();
      const daCota = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: m.turno.id, trabalhoId: m.trabalho!.id, prazoEm: Date.now() + 4 * 86_400_000, profundidade: 0, entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}Claude Code chegou ao limite.`, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", acordarEm: Date.now() + 3 * 86_400_000 });
      const assentado = await m.repos.turnos.buscar(m.turno.id);
      const { turno, nova } = await enfileirarRetomada(m.deps, { original: assentado!, entradaTexto: "aprovado", prazoEm: Date.now() + 600_000 });
      expect(nova).toBe(false);
      expect(turno?.id).toBe(daCota!.id);
      const juntado = await m.repos.turnos.buscar(daCota!.id);
      expect(juntado?.acordarEm ?? null).toBeNull();
      expect(juntado?.entradaTexto).toContain("aprovado");
      expect((await m.repos.turnos.listarDaConversa(m.conversaId, 50)).filter((t) => t.estado === "pendente")).toHaveLength(1);
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(daCota!.id);
    });
  });

  it("NOD-279 D8: as voltas que a cota marcou não contam no teto de voltas seguidas do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.assentar();
      const volta = (entradaTexto: string) => m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: m.turno.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto, entradaConfianca: "confiavel", modelo: "sonnet", acordarEm: Date.now() + 86_400_000 });
      for (let i = 0; i < VOLTAS_SEGUIDAS_MAX + 2; i++) await volta(`${ENTRADA_DA_VOLTA_DA_COTA}Claude Code chegou ao limite.`);
      expect(await m.repos.turnos.voltasMarcadas(m.turno.id)).toBe(0);
      await volta("ver o CI");
      expect(await m.repos.turnos.voltasMarcadas(m.turno.id)).toBe(1);
    });
  });

  it("voltas seguidas não alongam a cadeia (a 2ª aponta para a mesma origem) e param no teto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await meChameAs(m.deps, { ...m.ctx, em_minutos: 5, motivo: "ver o CI" });
      await m.assentar();
      const [primeira] = await m.voltas();
      const segunda = await m.repos.turnos.reivindicar({ machineId: m.machineId, agora: primeira!.acordarEm! + 1 });
      await meChameAs(m.deps, { ...m.ctx, turnoId: segunda!.id, em_minutos: 5, motivo: "ainda não" });
      await assentarTurno(m.deps, { turnoId: segunda!.id, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "ainda rodando" }, resultado: SUCESSO, executor: "catcher" });
      const nova = (await m.voltas()).find((t) => t.estado === "pendente");
      expect(nova?.retomaTurnoId).toBe(m.turno.id);

      for (let i = (await m.repos.turnos.voltasMarcadas(m.turno.id)); i < VOLTAS_SEGUIDAS_MAX; i++) {
        await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: m.turno.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "sonnet", acordarEm: Date.now() + 86_400_000 });
      }
      const terceira = await m.repos.turnos.reivindicar({ machineId: m.machineId, agora: nova!.acordarEm! + 1 });
      expect((await meChameAs(m.deps, { ...m.ctx, turnoId: terceira!.id, em_minutos: 5, motivo: "mais uma" })).data).toMatchObject({ ok: false, erro: "voltas_demais" });
    });
  });

  // ADR-099 §5 (parte 1, definido em 2026-10-12): três voltas seguidas sem nada novo — a quarta vira pergunta à pessoa.
  async function volta(m: Awaited<ReturnType<typeof montar>>, turnoId: string, motivo: string) {
    if (!(await meChameAs(m.deps, { ...m.ctx, turnoId, em_minutos: 5, motivo })).data.ok) throw new Error("recusou");
    await m.assentar(turnoId);
    const proxima = (await m.voltas()).find((t) => t.estado === "pendente");
    if (!proxima) return null;
    const pega = await m.repos.turnos.reivindicar({ machineId: m.machineId, agora: proxima.acordarEm! + 1 });
    if (pega?.id !== proxima.id) throw new Error("reivindicar a volta");
    return pega;
  }

  it("três voltas seguidas sem novidade: a quarta não nasce; vira pergunta à pessoa e a task vai para Precisa de você", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const v1 = await volta(m, m.turno.id, "ver se a CI do #845 passou");
      const v2 = await volta(m, v1!.id, "ver se a CI do #845 passou");
      const v3 = await volta(m, v2!.id, "ver se a CI do #845 passou");
      expect([v1, v2, v3].map((v) => v?.retomaTurnoId)).toEqual([m.turno.id, m.turno.id, m.turno.id]);
      expect((await m.repos.trabalhos.buscar(m.trabalho!.id))?.estado).toBe("rodando");

      // A terceira volta também só confere e marca outra: no lugar da quarta, a pergunta.
      expect(await volta(m, v3!.id, "ver se a CI do #845 passou ainda")).toBeNull();
      expect(await m.voltas()).toHaveLength(3);
      const [pergunta] = await m.repos.decisoes.doTurno(v3!.id);
      expect(pergunta).toMatchObject({ tipo: "pergunta", estado: "pendente", decisorId: PESSOA_MARLON, frase: "Voltei 3 vezes para conferir e nada mudou: ver se a CI do #845 passou ainda. Sigo esperando ou paro por aqui?" });
      const balao = (await m.repos.mensagens.listarDaConversa(m.conversaId)).find((x) => x.payload?.kind === "pedido_a_pessoa");
      expect(balao).toMatchObject({ kind: "texto", turnoId: v3!.id, payload: { decisaoId: pergunta!.id, opcoes: ["Pode seguir esperando", "Pode parar de esperar"] } });
      expect(balao?.autoria).toMatchObject({ autor_tipo: "agente", autor_id: m.agenteId, decidido_por: REGRA_VOLTAS_SEM_NOVIDADE });
      expect((await m.repos.trabalhos.buscar(m.trabalho!.id))?.estado).toBe("precisa_de_voce");
      const dto = (await listarTrabalhos(m.deps, {})).data.trabalhos.find((t) => t.id === m.trabalho!.id);
      expect(dto).toMatchObject({ estado: "precisa_de_voce", acordaEm: null });

      // "Pode seguir esperando": a resposta retoma o turno, e a próxima volta começa outra cadeia (a conta zera).
      const { decisao } = (await fecharComResposta(m.deps, { decisaoId: pergunta!.id, texto: "Pode seguir esperando" })).data;
      const { turno: retomada } = (await retomarComResposta(m.deps, { decisao, texto: "Pode seguir esperando", respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" } })).data;
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: v3!.id, acordarEm: null, trabalhoId: m.trabalho!.id });
      const pega = await m.repos.turnos.reivindicar({ machineId: m.machineId, agora: Date.now() });
      expect(pega?.id).toBe(retomada!.id);
      const nova = await volta(m, pega!.id, "ver se a CI do #845 passou");
      expect(nova?.retomaTurnoId).toBe(retomada!.id);
    });
  });

  it("a volta que pediu algo à pessoa (ou a um colega) trouxe novidade: a conta não fecha e a volta seguinte nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const v1 = await volta(m, m.turno.id, "ver o deploy");
      // A primeira volta pediu uma aprovação, já decidida — não segura nada, mas foi novidade.
      const d = await m.repos.decisoes.criar({ tipo: "pergunta", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: v1!.id, prazoDecisaoEm: Date.now() + 600_000, frase: "posso reiniciar o deploy?" });
      await m.repos.decisoes.decidir(d!.id, { por: PESSOA_MARLON, agora: Date.now() });
      const v2 = await volta(m, v1!.id, "ver o deploy");
      const v3 = await volta(m, v2!.id, "ver o deploy");
      const v4 = await volta(m, v3!.id, "ver o deploy");
      expect(v4).toMatchObject({ retomaTurnoId: m.turno.id, estado: "despachando" });
      expect(await m.repos.decisoes.doTurno(v3!.id)).toEqual([]);
      // Agora as três mais novas (v2, v3, v4) só conferiram: a quinta vira pergunta.
      expect(await volta(m, v4!.id, "ver o deploy")).toBeNull();
      expect((await m.repos.decisoes.doTurno(v4!.id)).map((x) => x.tipo)).toEqual(["pergunta"]);
    });
  });

  it("na conversa (sem task): a volta não aparece em curso nem na fila até a hora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { semTrabalho: true });
      await meChameAs(m.deps, { ...m.ctx, em_minutos: 30, motivo: "ver a resposta do fornecedor" });
      await m.assentar();
      expect(await m.voltas()).toHaveLength(1);
      expect(await m.repos.turnos.vivosDaConversa(m.conversaId)).toEqual([]);
      expect(await m.repos.turnos.pendentesRenderizaveis(m.conversaId)).toEqual([]);
    });
  });

  it("fora de 5–1440 minutos ou sem motivo: recusado; turno de outro bot: não permitido", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      for (const em_minutos of [0, 4, 1441, -5]) await esperarErro(() => meChameAs(m.deps, { ...m.ctx, em_minutos, motivo: "x" }), "entrada_invalida");
      await esperarErro(() => meChameAs(m.deps, { ...m.ctx, em_minutos: 5, motivo: "   " }), "texto_vazio");
      await esperarErro(() => meChameAs(m.deps, { ...m.ctx, agenteId: randomUUID(), em_minutos: 5, motivo: "x" }), "nao_permitido");
    });
  });
});
