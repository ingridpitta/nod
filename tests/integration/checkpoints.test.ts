import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { RETEM_CHECKPOINTS } from "../../src/domain/checkpoints.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { desfazeresDaMaquina, pedirDesfazerTurno, relatarDesfazer } from "../../src/use-cases/desfazer-turno.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-54 (ADR-134): o turno que mudou arquivos deixa o checkpoint na fala final; o pedido de desfazer fica para a máquina
 * do turno puxar; o relato de progresso e o fim (uma vez) mudam o estado; o fim com resultado deixa a linha para o bot.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const ARQUIVOS = [{ caminho: "~/nod/Ada/a.md", acao: "mudado" as const }, { caminho: "~/nod/Ada/b.md", acao: "criado" as const }];

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const machineId = randomUUID();
  async function turno(o: { checkpoint?: boolean; origem?: "conversa" | "sala"; texto?: string; trabalhoId?: string; noMeio?: (turnoId: string) => Promise<void> } = {}) {
    const e = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: o.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: o.trabalhoId ?? null });
    if (!e) throw new Error("turno");
    const t = await repos.turnos.reivindicar({ machineId, agora: Date.now() });
    if (t?.id !== e.id) throw new Error("reivindicar");
    const resultado = { desfecho: "sucesso" as const, texto: "pronto", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [], ...(o.checkpoint === false ? {} : { checkpoint: { arquivos: ARQUIVOS, total: 2 } }) };
    await o.noMeio?.(t.id);
    await assentarTurno(deps, { turnoId: t.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: o.texto ?? "pronto" }, resultado: { ...resultado, texto: o.texto ?? "pronto" }, executor: "catcher" });
    return t.id;
  }
  const fala = async (turnoId: string) => (await repos.mensagens.listarComTurno(base.conversaId, 200)).find((m) => m.turnoId === turnoId && m.kind !== "sistema");
  const pedir = (turnoId: string, forcar = false, conversaId = base.conversaId) => pedirDesfazerTurno(deps, { conversaId, turnoId, forcar });
  const relatar = (relato: Parameters<typeof relatarDesfazer>[1]["relato"], maquinaId = machineId) => relatarDesfazer(deps, { maquinaId, relato });
  return { ...base, deps, repos, machineId, turno, fala, pedir, relatar };
}

describeIntegracao("checkpoints de arquivos por turno (NOD-54, ADR-134)", () => {
  it("assentar cria o checkpoint e a fala o traz; sem mudança ou na sala, nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      const c = await m.repos.checkpoints.doTurno(t);
      expect(c).toMatchObject({ estado: "disponivel", maquinaId: m.machineId, pastaDoBot: "Ada", total: 2, arquivos: ARQUIVOS });
      expect((await m.fala(t))?.checkpoint).toEqual({ estado: "disponivel", arquivos: ARQUIVOS, total: 2 });
      expect(c?.mensagemId).toBe((await m.fala(t))?.id);
      const sem = await m.turno({ checkpoint: false });
      expect(await m.repos.checkpoints.doTurno(sem)).toBeNull();
      expect((await m.fala(sem))?.checkpoint).toBeUndefined();
    });
  });

  it("turno de frente não ganha checkpoint: a sessão da frente não leria a linha do desfeito (revisão 6, M3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = (await m.repos.trabalhos.criar({ agenteId: m.agenteId, conversaId: m.conversaId, titulo: "frente", origem: "pessoa" }))!;
      const t = await m.turno({ trabalhoId: w.id });
      expect(await m.repos.checkpoints.doTurno(t)).toBeNull();
    });
  });

  it("pedir → máquina puxa → progresso → fim com resultado: desfeito, linha para o bot, relato repetido ignorado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      const r = await m.pedir(t);
      expect(r.data).toMatchObject({ ok: true, checkpoint: { estado: "desfazendo", feitos: 0 } });
      expect(r.events.map((e) => e.kind)).toEqual(["checkpoint_mudou"]);
      expect(await desfazeresDaMaquina(m.deps, randomUUID())).toEqual([]);
      expect(await desfazeresDaMaquina(m.deps, m.machineId)).toEqual([{ turnoId: t, pastaDoBot: "Ada", forcar: [], tentativa: 1 }]);

      expect((await m.relatar({ turnoId: t, tentativa: 1, feitos: 1, total: 2 }, randomUUID())).data.ok).toBe(false);
      expect((await m.relatar({ turnoId: t, tentativa: 1, feitos: 1, total: 2 })).data.ok).toBe(true);
      expect((await m.fala(t))?.checkpoint).toMatchObject({ estado: "desfazendo", feitos: 1 });

      const fim = await m.relatar({ turnoId: t, tentativa: 1, feitos: 2, total: 2, resultado: { arquivos: [{ caminho: "~/nod/Ada/a.md", desfecho: "voltou" }, { caminho: "~/nod/Ada/b.md", desfecho: "conflito" }] } });
      expect(fim.events.map((e) => e.kind)).toEqual(["checkpoint_mudou", "mensagem_criada"]);
      const ck = (await m.fala(t))?.checkpoint;
      expect(ck).toMatchObject({ estado: "desfeito", resultado: { contagem: { voltou: 1, conflito: 1, mesclado: 0, erro: 0 } } });
      expect(ck?.desfeitoEm).toBeTypeOf("number");
      const [linha] = await trx<{ texto: string; kind: string }[]>`select texto, kind from mensagens where conversa_id = ${m.conversaId} and assunto = 'arquivos.desfeitos'`;
      expect(linha?.kind).toBe("sistema");
      expect(linha?.texto).toContain("1 arquivo voltou");
      expect(linha?.texto).toContain("~/nod/Ada/b.md");

      const repetido = await m.relatar({ turnoId: t, tentativa: 1, feitos: 2, total: 2, resultado: { arquivos: [{ caminho: "~/nod/Ada/a.md", desfecho: "voltou" }] } });
      expect(repetido.data.ok).toBe(false);
      expect(await desfazeresDaMaquina(m.deps, m.machineId)).toEqual([]);

      // "Voltar mesmo assim": só os conflitos; depois disso, nada mais a forçar.
      expect((await m.pedir(t)).data).toEqual({ ok: false, recusa: "nada_a_forcar" });
      const forcado = await m.pedir(t, true);
      expect(forcado.data.ok).toBe(true);
      expect(await desfazeresDaMaquina(m.deps, m.machineId)).toEqual([{ turnoId: t, pastaDoBot: "Ada", forcar: ["~/nod/Ada/b.md"], tentativa: 2 }]);
      // A máquina passa só no forçado; o resultado dele entra no anterior (revisão 11, M2).
      await m.relatar({ turnoId: t, tentativa: 2, feitos: 1, total: 1, resultado: { arquivos: [{ caminho: "~/nod/Ada/b.md", desfecho: "voltou" }] } });
      expect((await m.repos.checkpoints.doTurno(t))?.resultado).toMatchObject({ contagem: { voltou: 2, conflito: 0, mesclado: 0, erro: 0 }, arquivos: [{ caminho: "~/nod/Ada/b.md", desfecho: "voltou" }, { caminho: "~/nod/Ada/a.md", desfecho: "voltou" }] });
      expect((await m.pedir(t, true)).data).toEqual({ ok: false, recusa: "nada_a_forcar" });
    });
  });

  it("recusas: já desfazendo, outro do mesmo bot desfazendo, conversa errada, forçar sem conflito", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t1 = await m.turno();
      const t2 = await m.turno();
      expect((await m.pedir(t1, true)).data).toEqual({ ok: false, recusa: "nada_a_forcar" });
      await expect(m.pedir(t1, false, randomUUID())).rejects.toBeInstanceOf(ErroDeDominio);
      await expect(m.pedir(randomUUID())).rejects.toBeInstanceOf(ErroDeDominio);
      expect((await m.pedir(t1)).data.ok).toBe(true);
      expect((await m.pedir(t1)).data).toEqual({ ok: false, recusa: "ja_desfazendo" });
      expect((await m.pedir(t2)).data).toEqual({ ok: false, recusa: "outro_desfazendo" });
      expect((await m.repos.checkpoints.desfazendoDoAgente(m.agenteId))?.turnoId).toBe(t1);
    });
  });

  it("falhas: erro vira falhou (tenta de novo); sem a foto vira vencido, e a fala diz (revisão 2, M3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      await m.pedir(t);
      const f = await m.relatar({ turnoId: t, tentativa: 1, feitos: 0, total: 2, falha: "erro" });
      expect(f.events.map((e) => e.kind)).toEqual(["checkpoint_mudou"]);
      expect((await m.fala(t))?.checkpoint).toMatchObject({ estado: "falhou", falha: "erro" });
      expect((await m.pedir(t)).data.ok).toBe(true);
      await m.relatar({ turnoId: t, tentativa: 2, feitos: 0, total: 0, falha: "sem_checkpoint" });
      expect((await m.repos.checkpoints.doTurno(t))?.estado).toBe("vencido");
      expect((await m.fala(t))?.checkpoint).toMatchObject({ estado: "vencido", falha: "sem_checkpoint" });
      expect((await m.pedir(t)).data).toEqual({ ok: false, recusa: "vencido" });
    });
  });

  it("retenção: o mais velho que os 20 mais novos do bot na máquina vence, também o já desfeito (revisão P2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const primeiro = await m.turno();
      await m.pedir(primeiro);
      await m.relatar({ turnoId: primeiro, tentativa: 1, feitos: 2, total: 2, resultado: { arquivos: [{ caminho: "~/nod/Ada/a.md", desfecho: "voltou" }] } });
      expect((await m.repos.checkpoints.doTurno(primeiro))?.estado).toBe("desfeito");
      for (let i = 0; i < RETEM_CHECKPOINTS; i++) await m.turno();
      const c = await m.repos.checkpoints.doTurno(primeiro);
      expect(c?.estado).toBe("vencido");
      expect(c?.desfeitoEm).toBeTypeOf("number");
    });
  });

  it("o fim atrasado de uma tentativa velha não fecha a tentativa nova (revisão A3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      await m.pedir(t);
      await m.relatar({ turnoId: t, tentativa: 1, feitos: 0, total: 2, falha: "erro" });
      expect((await m.pedir(t)).data.ok).toBe(true);
      const velho = await m.relatar({ turnoId: t, tentativa: 1, feitos: 0, total: 2, falha: "erro" });
      expect(velho.data.ok).toBe(false);
      expect((await m.relatar({ turnoId: t, tentativa: 1, feitos: 1, total: 2 })).data.ok).toBe(false);
      expect((await m.repos.checkpoints.doTurno(t))?.estado).toBe("desfazendo");
      expect((await m.relatar({ turnoId: t, tentativa: 2, feitos: 2, total: 2, resultado: { arquivos: [{ caminho: "~/nod/Ada/a.md", desfecho: "voltou" }] } })).data.ok).toBe(true);
      expect((await m.repos.checkpoints.doTurno(t))?.estado).toBe("desfeito");
    });
  });

  it("o desfazer preso há mais de 15 min vira falhou no próximo pedido do bot (revisão M1)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t1 = await m.turno();
      const t2 = await m.turno();
      await m.pedir(t1);
      expect((await m.pedir(t2)).data).toEqual({ ok: false, recusa: "outro_desfazendo" });
      await trx`update checkpoints set pedido_em = now() - interval '16 minutes' where turno_id = ${t1}`;
      expect((await m.pedir(t2)).data.ok).toBe(true);
      expect(await m.repos.checkpoints.doTurno(t1)).toMatchObject({ estado: "falhou", falha: "erro" });
    });
  });

  it("o desfazer preso há mais de 15 min não vai mais para a máquina: a tela já diz que falhou (revisão 11, M4)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      await m.pedir(t);
      expect(await desfazeresDaMaquina(m.deps, m.machineId)).toHaveLength(1);
      await trx`update checkpoints set pedido_em = now() - interval '16 minutes' where turno_id = ${t}`;
      expect(await desfazeresDaMaquina(m.deps, m.machineId)).toEqual([]);
    });
  });

  it("o desfazer preso há mais de 15 min aparece na fala como falhou, com Tentar de novo (revisão 2, A1)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t1 = await m.turno();
      const t2 = await m.turno();
      await m.pedir(t1);
      expect((await m.fala(t1))?.checkpoint?.estado).toBe("desfazendo");
      await trx`update checkpoints set pedido_em = now() - interval '16 minutes' where turno_id = ${t1}`;
      expect((await m.fala(t1))?.checkpoint).toMatchObject({ estado: "falhou", falha: "erro" });
      expect((await m.pedir(t1)).data.ok).toBe(true);
      expect(await m.repos.checkpoints.doTurno(t1)).toMatchObject({ estado: "desfazendo", tentativa: 2 });
      expect((await m.fala(t2))?.checkpoint?.estado).toBe("disponivel");
    });
  });

  it("sem fala final (a última saiu no meio, ou o Parar): o checkpoint mora na última fala do bot no turno (revisão 2, M2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t0 = await m.turno({ checkpoint: false });
      const autoria = (await m.fala(t0))!.autoria;
      let doMeio = "";
      const t = await m.turno({
        texto: "",
        noMeio: async (turnoId) => {
          doMeio = (await m.repos.mensagens.criar({ conversaId: m.conversaId, turnoId, autoria, kind: "texto", texto: "vou ajustar os arquivos", confianca: "confiavel" }))!.id;
        },
      });
      const c = await m.repos.checkpoints.doTurno(t);
      expect(c?.mensagemId).toBe(doMeio);
      expect((await m.fala(t))?.checkpoint?.estado).toBe("disponivel");
      const nada = await m.turno({ texto: "" });
      expect(await m.repos.checkpoints.doTurno(nada)).toBeNull();
    });
  });

  it("o sinal de vida da máquina (total 0) renova o prazo de 15 min sem mudar a tela (revisão 3, M2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t1 = await m.turno();
      const t2 = await m.turno();
      await m.pedir(t1);
      await trx`update checkpoints set pedido_em = now() - interval '14 minutes', feitos = 0 where turno_id = ${t1}`;
      const sinal = await m.relatar({ turnoId: t1, tentativa: 1, feitos: 0, total: 0 });
      expect(sinal).toEqual({ data: { ok: true }, events: [] });
      await trx`update checkpoints set pedido_em = pedido_em - interval '2 minutes' where turno_id = ${t1}`;
      expect((await m.fala(t1))?.checkpoint?.estado).toBe("desfazendo");
      expect((await m.pedir(t2)).data).toEqual({ ok: false, recusa: "outro_desfazendo" });
      expect(await m.repos.checkpoints.doTurno(t1)).toMatchObject({ estado: "desfazendo", feitos: 0 });
      expect((await m.relatar({ turnoId: t1, tentativa: 1, feitos: 1, total: 2 })).events.map((e) => e.kind)).toEqual(["checkpoint_mudou"]);
    });
  });

  it("o checkpoint com mais de 7 dias some da fala mesmo sem pedido (QA, bug 4)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      expect((await m.fala(t))?.checkpoint?.estado).toBe("disponivel");
      await trx`update checkpoints set criado_em = now() - interval '8 days' where turno_id = ${t}`;
      expect((await m.fala(t))?.checkpoint).toBeUndefined();
    });
  });

  it("o checkpoint com mais de 7 dias vence no pedido, sem esperar um turno novo do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      await trx`update checkpoints set criado_em = now() - interval '8 days' where turno_id = ${t}`;
      expect((await m.pedir(t)).data).toEqual({ ok: false, recusa: "vencido" });
      expect((await m.repos.checkpoints.doTurno(t))?.estado).toBe("vencido");
    });
  });
});
