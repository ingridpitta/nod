import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { PreferenciaHarness } from "../../src/contracts/harness.ts";
import type { OrigemTrabalho } from "../../src/contracts/trabalho.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { cotaDasIas, cotaSegura, ENTRADA_DA_NOVA_TENTATIVA, entradaDaVoltaDaCota, portaoDaCota, situacaoDoTurno, tipoParaCota } from "../../src/domain/cota-da-ia.ts";
import type { Tx } from "../../src/shared/types.ts";
import { lerCustoDoDia } from "../../src/use-cases/custo-do-dia.ts";
import { criarTrabalho, listarTrabalhos } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-099 §7 (definido em 2026-10-12): a cota da IA no `reivindicar`. Com a IA em 99% (reserva), trabalho NOVO de fundo
 * espera; com ela no limite, todo o fundo espera; a conversa com a pessoa sempre passa. O SQL e a regra pura
 * (domain/cota-da-ia.ts) têm de dar o mesmo resultado para cada turno.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ze 1" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const turno = async (o: { trabalhoId?: string | null; origem?: Turno["origem"]; harness?: PreferenciaHarness; modelo?: string; acordarEm?: number; pessoaEsperando?: boolean }) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: o.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: o.modelo ?? "sonnet", harness: o.harness ?? "claude-cli", trabalhoId: o.trabalhoId ?? null, ...(o.acordarEm ? { acordarEm: o.acordarEm } : {}), ...(o.pessoaEsperando ? { pessoaEsperando: true } : {}) });
    if (!t) throw new Error("turno");
    return t;
  };
  const task = async (origem: OrigemTrabalho, titulo: string, comecada = false) => {
    const w = (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo, origem })).trabalho;
    if (comecada) await repos.trabalhos.mudarEstado(w.id, "rodando", Date.now());
    return w;
  };
  /** A cota lida do banco, como a ponte lê (preferências + uso do plano). */
  const cota = async () => cotaDasIas({ usos: await repos.usoDoPlano.listar(), limites: (await repos.preferencias.buscar()).iasNoLimite, agora: Date.now() });
  /** Todos os turnos que o reivindicar entrega com o portão da cota, até a fila não ter mais o que dar. */
  const reivindicarTudo = async (meus: ReadonlySet<string>, iasDoAuto: string[] = ["claude-cli"]) => {
    const portao = portaoDaCota(await cota(), iasDoAuto);
    const pegos: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), cota: portao });
      if (!r) break;
      if (meus.has(r.id)) pegos.push(r.id);
      // Conclui na hora: a faixa da conversa (um turno por vez) não esconde o próximo turno dela.
      await repos.turnos.assentar(r.id, { estado: "concluido" });
    }
    return new Set(pegos);
  };
  /** O que a regra pura diz que passa (o mesmo cálculo do despacho e da tela). */
  const passaPelaRegra = async (turnos: readonly Turno[], iasDoAuto: string[] = ["claude-cli"]) => {
    const c = await cota();
    const passa: string[] = [];
    for (const t of turnos) {
      const w = t.trabalhoId ? await repos.trabalhos.buscar(t.trabalhoId) : null;
      if (!cotaSegura(tipoParaCota(t, w), situacaoDoTurno({ harness: t.harness ?? "auto", modelo: t.modelo }, c, iasDoAuto))) passa.push(t.id);
    }
    return new Set(passa);
  };
  return { ...base, deps, repos, turno, task, reivindicarTudo, passaPelaRegra };
}

const usoDoClaude = (utilizacao: number, medidoEm = Date.now()) => ({ harness: "claude-cli" as const, situacao: "normal" as const, cincoHoras: { utilizacao, renovaEm: medidoEm + 2 * HORA }, semana: { utilizacao: 0.4, renovaEm: medidoEm + 72 * HORA }, medidoEm });

describeIntegracao("cota da IA no reivindicar (ADR-099 §7)", () => {
  it("reserva de 1%: o fundo novo espera; a conversa, a task já começada, a volta marcada e outra IA seguem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.usoDoPlano.gravar(usoDoClaude(0.995), null);
      const conversa = await m.turno({});
      const rotinaSemTask = await m.turno({ origem: "rotina" });
      const taskNova = await m.turno({ trabalhoId: (await m.task("pessoa", "Revisar o PR")).id });
      const colegaNovo = await m.turno({ origem: "delegacao", trabalhoId: (await m.task("colega", "Pedido do Leonardo")).id });
      const comecada = await m.turno({ origem: "retomada", trabalhoId: (await m.task("rotina", "Rotina das 9h", true)).id });
      const volta = await m.turno({ origem: "retomada", acordarEm: Date.now() - 1_000 });
      const noCodex = await m.turno({ harness: "codex-cli", modelo: "auto", trabalhoId: (await m.task("pessoa", "Pesquisar")).id });
      const todos = [conversa, rotinaSemTask, taskNova, colegaNovo, comecada, volta, noCodex];
      const meus = new Set(todos.map((t) => t.id));

      const esperado = await m.passaPelaRegra(todos);
      expect(esperado).toEqual(new Set([conversa.id, comecada.id, volta.id, noCodex.id]));
      expect(await m.reivindicarTudo(meus)).toEqual(esperado);
      for (const t of [rotinaSemTask, taskNova, colegaNovo]) expect((await m.repos.turnos.buscar(t.id))?.estado).toBe("pendente");

      // A janela renovou (leitura nova abaixo de 99%): o fundo que esperava sai sozinho.
      await m.repos.usoDoPlano.gravar(usoDoClaude(0.05, Date.now() + 1), null);
      expect(await m.reivindicarTudo(meus)).toEqual(new Set([rotinaSemTask.id, taskNova.id, colegaNovo.id]));
    });
  });

  it("limite: todo o fundo espera (também o já começado e a volta marcada); a conversa com a pessoa passa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.registrarLimite("claude-cli", { renovaEm: Date.now() + HORA, desde: Date.now() });
      const conversa = await m.turno({});
      const retomadaDaPessoa = await m.turno({ origem: "retomada" });
      const comecada = await m.turno({ origem: "retomada", trabalhoId: (await m.task("pessoa", "Acompanhar a CI", true)).id });
      const volta = await m.turno({ origem: "retomada", acordarEm: Date.now() - 1_000 });
      const taskNova = await m.turno({ trabalhoId: (await m.task("pessoa", "Revisar")).id });
      const todos = [conversa, retomadaDaPessoa, comecada, volta, taskNova];

      const esperado = await m.passaPelaRegra(todos);
      expect(esperado).toEqual(new Set([conversa.id, retomadaDaPessoa.id]));
      expect(await m.reivindicarTudo(new Set(todos.map((t) => t.id)))).toEqual(esperado);
    });
  });

  it("NOD-272: o \"Testar agora\" (pessoa_esperando) passa até no limite, como a conversa; a mesma rotina sem ela espera", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.registrarLimite("claude-cli", { renovaEm: Date.now() + HORA, desde: Date.now() });
      const testarAgora = await m.turno({ origem: "rotina", pessoaEsperando: true });
      const daAgenda = await m.turno({ origem: "rotina" });
      expect(testarAgora.pessoaEsperando).toBe(true);
      expect(daAgenda.pessoaEsperando).toBe(false);
      const todos = [testarAgora, daAgenda];
      const esperado = await m.passaPelaRegra(todos);
      expect(esperado).toEqual(new Set([testarAgora.id]));
      expect(await m.reivindicarTudo(new Set(todos.map((t) => t.id)))).toEqual(esperado);
    });
  });

  // definido em 2026-10-20 (NOD-309, PR 4): o fundo no Automático (auto/auto) acorda com "Seguir com"/conta nova de
  // qualquer IA; a volta da nova tentativa (backoff do erro transitório) não é cota e não acorda.
  it("NOD-309 (PR 4): anteciparEsperasDaCota acorda a volta auto/auto; a da nova tentativa fica com o backoff", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = await m.task("rotina", "Rotina das 9h", true);
      const base = { executor: "catcher" as const, conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada" as const, prazoEm: Date.now() + 600_000, profundidade: 0 as const, entradaConfianca: "confiavel" as const, trabalhoId: w.id, acordarEm: Date.now() + HORA };
      const auto = await m.repos.turnos.enfileirar({ ...base, entradaTexto: entradaDaVoltaDaCota("Claude"), modelo: "auto", harness: "auto" });
      const fixa = await m.repos.turnos.enfileirar({ ...base, entradaTexto: entradaDaVoltaDaCota("Codex"), modelo: "gpt-5", harness: "codex-cli" });
      const tentativa = await m.repos.turnos.enfileirar({ ...base, entradaTexto: `${ENTRADA_DA_NOVA_TENTATIVA}a IA ficou fora do ar.`, modelo: "auto", harness: "auto" });
      if (!auto || !fixa || !tentativa) throw new Error("turno");
      const acordados = await m.repos.turnos.anteciparEsperasDaCota("claude-cli");
      expect(acordados).toContain(auto.id);
      expect(acordados).not.toContain(fixa.id);
      expect(acordados).not.toContain(tentativa.id);
      expect((await m.repos.turnos.buscar(tentativa.id))?.acordarEm).not.toBeNull();
    });
  });

  it("QA do PR 341 (NOD-277 CA9): a espera da cota acordada antes da hora, com a IA ainda no limite, o portão segura", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.registrarLimite("claude-cli", { renovaEm: Date.now() + HORA, desde: Date.now() });
      const w = await m.task("rotina", "Rotina das 9h", true);
      const t = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: entradaDaVoltaDaCota("Claude"), entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: w.id, acordarEm: Date.now() + HORA });
      if (!t) throw new Error("turno");
      // Uma conta nova ou "Seguir com" acorda a espera (acordar_em vai a null)...
      expect(await m.repos.turnos.anteciparEsperasDaCota("claude-cli")).toContain(t.id);
      expect((await m.repos.turnos.buscar(t.id))?.acordarEm ?? null).toBeNull();
      // ...mas a cota segue no limite: o reivindicar não a entrega; ela sai quando o limite passa.
      expect(await m.reivindicarTudo(new Set([t.id]))).toEqual(new Set());
      expect((await m.repos.turnos.buscar(t.id))?.estado).toBe("pendente");
      await m.repos.preferencias.limparLimite("claude-cli");
      expect(await m.reivindicarTudo(new Set([t.id]))).toEqual(new Set([t.id]));
    });
  });

  it("Automático: segura só se todas as IAs que podem pegá-lo seguram", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.usoDoPlano.gravar(usoDoClaude(0.999), null);
      const auto = await m.turno({ harness: "auto", modelo: "auto", trabalhoId: (await m.task("rotina", "Rotina")).id });
      const meus = new Set([auto.id]);
      expect(await m.passaPelaRegra([auto], ["claude-cli"])).toEqual(new Set());
      expect(await m.reivindicarTudo(meus, ["claude-cli"])).toEqual(new Set());
      expect(await m.reivindicarTudo(meus, ["claude-cli", "codex-cli"])).toEqual(new Set([auto.id]));
    });
  });

  it("NOD-302: seguradosPelaCota lista o que o reivindicar segura (a mesma regra), e pedidosNaFila os pedidos sem task", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.usoDoPlano.gravar(usoDoClaude(0.995), null);
      const conversa = await m.turno({});
      const rotinaSemTask = await m.turno({ origem: "rotina" });
      const pedido = await m.turno({ origem: "delegacao" });
      const taskNova = await m.turno({ trabalhoId: (await m.task("pessoa", "Revisar o PR")).id });
      const comecada = await m.turno({ origem: "retomada", trabalhoId: (await m.task("rotina", "Rotina das 9h", true)).id });
      // NOD-272 no predicado único (merge da main no #369): o "Testar agora" passa no reivindicar e não entra na lista.
      const testarAgora = await m.turno({ origem: "rotina", pessoaEsperando: true });
      const todos = [conversa, rotinaSemTask, pedido, taskNova, comecada, testarAgora];
      const passa = await m.passaPelaRegra(todos);
      const portao = portaoDaCota(cotaDasIas({ usos: await m.repos.usoDoPlano.listar(), limites: (await m.repos.preferencias.buscar()).iasNoLimite, agora: Date.now() }), ["claude-cli"]);
      expect(portao).not.toBeNull();
      const segurados = await m.repos.turnos.seguradosPelaCota({ machineId: randomUUID(), agora: Date.now(), cota: portao! });
      const meus = new Set(todos.map((t) => t.id));
      const esperado = new Set(todos.filter((t) => !passa.has(t.id)).map((t) => t.id));
      expect(esperado).toEqual(new Set([rotinaSemTask.id, pedido.id, taskNova.id]));
      expect(new Set(segurados.map((t) => t.id).filter((id) => meus.has(id)))).toEqual(esperado);
      const fila = await m.repos.turnos.pedidosNaFila({ agenteId: m.agenteId });
      expect(fila.map((t) => t.id)).toEqual([pedido.id]);
    });
  });

  it("GET trabalhos: a pílula diz quando o fundo volta e a task nova diz que espera a cota", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const medido = Date.now();
      await m.repos.usoDoPlano.gravar(usoDoClaude(0.995, medido), null);
      const nova = await m.task("rotina", "Rotina das 9h");
      const comecada = await m.task("pessoa", "Acompanhar", true);
      await m.turno({ trabalhoId: nova.id, origem: "rotina" });
      await m.turno({ trabalhoId: comecada.id, origem: "retomada" });
      const { data } = await listarTrabalhos(m.deps, {});
      expect(data.cota).toEqual({ situacao: "reserva", ias: ["claude-cli"], voltaEm: medido + 2 * HORA });
      expect(data.trabalhos.find((t) => t.id === nova.id)?.esperaDaCota).toBe(true);
      expect(data.trabalhos.find((t) => t.id === comecada.id)?.esperaDaCota).toBeUndefined();

      await m.repos.usoDoPlano.gravar(usoDoClaude(0.2, medido + 1), null);
      const depois = (await listarTrabalhos(m.deps, {})).data;
      expect(depois.cota).toBeNull();
      expect(depois.trabalhos.some((t) => t.esperaDaCota)).toBe(false);
    });
  });
});

describeIntegracao("custo de cada bot hoje (ADR-099 §7)", () => {
  it("soma por bot no fuso da pessoa e avisa quem passou de 2× a média do mesmo horário", async () => {
    await withRollback(MARLON, async (trx) => {
      const ze = await agenteComConversa(trx, MARLON, { nome: "Ze 1" });
      const ana = await agenteComConversa(trx, MARLON, { nome: "Ana" });
      // O relógio parado: a soma de hoje vai até este instante, e os dias anteriores até o mesmo horário.
      const agora = Date.now();
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const gasto = async (b: { agenteId: string; conversaId: string }, usd: number, em: number) => {
        const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: b.conversaId, agenteId: b.agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
        // NOD-273: o custo do dia soma `gastos` pelo instante do gasto (`em`), não o turno pela criação.
        await repos.gastos.registrar({ turnoId: t!.id, executor: "local", tokensEntrada: 10, tokensSaida: 5, custoUsd: usd, modelo: "sonnet", em });
      };
      // UTC deixa a conta legível: hoje desde 00:00 UTC até agora; os dias anteriores até o mesmo horário.
      const meiaNoite = Math.floor(agora / 86_400_000) * 86_400_000;
      const decorrido = agora - meiaNoite;
      await gasto(ze, 9, meiaNoite + Math.floor(decorrido / 2));
      await gasto(ana, 1.5, meiaNoite + Math.floor(decorrido / 2));
      for (let d = 1; d <= 7; d++) {
        await gasto(ze, 1, meiaNoite - d * 86_400_000 + Math.floor(decorrido / 2));
        await gasto(ana, 1, meiaNoite - d * 86_400_000 + Math.floor(decorrido / 2));
        // Depois do mesmo horário não conta na média.
        await gasto(ze, 50, meiaNoite - d * 86_400_000 + decorrido + 1);
      }
      // Antes da janela (8 dias atrás) também não.
      await gasto(ana, 100, meiaNoite - 8 * 86_400_000 + 1);
      const { data } = await lerCustoDoDia(deps, { fuso: "UTC" });
      const dos = (id: string) => data.bots.find((b) => b.agenteId === id);
      expect(dos(ze.agenteId)).toMatchObject({ hojeUsd: 9, mediaUsd: 1, vezes: 9, foraDoRitmo: true });
      expect(dos(ana.agenteId)).toMatchObject({ hojeUsd: 1.5, mediaUsd: 1, foraDoRitmo: false });
      expect(data.foraDoRitmo).toBe(true);
      expect(data.desde).toBe(meiaNoite);
      expect(data.totalUsd).toBeGreaterThanOrEqual(10.5);
    });
  });

  it("a volta que a cota no limite marcou não conta como volta sem novidade (alarme da parte 1)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const voltaCom = async (entradaTexto: string) => {
        const origem = await m.turno({ origem: "retomada", trabalhoId: (await m.task("pessoa", "Acompanhar a CI", true)).id });
        const v = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: origem.id, trabalhoId: origem.trabalhoId, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", acordarEm: Date.now() - 1_000 });
        if (!v) throw new Error("volta");
        return (await m.repos.turnos.ultimasVoltas(origem.id, 3))[0];
      };
      expect(await voltaCom(entradaDaVoltaDaCota("Claude Code"))).toMatchObject({ porCota: true });
      expect(await voltaCom("[nod] Você marcou para voltar às 16:00 para conferir: a CI")).toMatchObject({ porCota: false });
    });
  });
});
