import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { dispararRotina, registrarDesfechoDaEntrega } from "../../../src/use-cases/disparar-rotina.ts";
import { rotuloExecucao } from "../../../web/lib/execucao.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * NOD-251 e NOD-275 (definido em 2026-10-15): a janela de uma rotina cujo turno a máquina recusou no despacho (IA
 * ausente, sem login, conta no limite) ou que a pessoa parou ficava SEM linha em rotina_execucoes — o histórico
 * mostrava um buraco, e o "Parar" de um turno de rotina já entregue virava "falhou por erro técnico". Agora as duas
 * viram 'interrompida' com o motivo, em silêncio na conversa (só o evento rotina_executou).
 */
const T0 = Date.parse("2026-10-15T08:00:30-03:00");
const JANELA = Date.parse("2026-10-15T08:00:00-03:00");
const HORA = 3_600_000;
const PRONTO: Inventario = { estado: "pronto", versao: "2.1.296", em: T0 };

async function cenario(o: { origem?: "rotina" | "conversa" } = {}) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Ze 1" });
  const chave = await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) });
  const vm = chave!.id;
  const rotina = (await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resuma o Slack", fonte: "slack", entregavel: "resumo", limitesAprovacao: "nada sai", politicaSemDado: "diga que não houve", proximaExecucao: JANELA }))!;
  let turnoId: string;
  if ((o.origem ?? "rotina") === "rotina") {
    const r = await dispararRotina(deps, { rotina, instanteAgendado: JANELA, machineId: vm, executor: "local" });
    if (!("turno" in r.data)) throw new Error("deveria disparar");
    turnoId = r.data.turno.id;
  } else {
    const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
    turnoId = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: T0 + HORA, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local" }))!.id;
  }
  const antes = banco.mensagens.length;
  const despachar = (inventario: Inventario = PRONTO) =>
    executar(deps, despacharTurno, { machineId: vm, executor: "local", inventario, harnessesProntos: inventario.estado === "pronto" ? ["claude-cli", "codex-cli"] : [] });
  const execucoes = () => deps.repos.rotinaExecucoes.listar(rotina.id);
  const novas = () => banco.mensagens.slice(antes);
  return { deps, banco, vm, rotina, turnoId, conversaId: bot.conversa.id, despachar, execucoes, novas };
}

const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

describe("NOD-275: o despacho recusado registra a janela da rotina como 'interrompida'", () => {
  it("IA ausente na máquina: interrompida · motor_ausente, um rotina_executou, a conversa só com a negação original", async () => {
    const c = await cenario();
    const r = await c.despachar({ estado: "ausente", motivo: "claude não encontrado", em: T0 });
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect((await c.execucoes()).map((e) => [e.desfecho, e.motivo, e.turnoId, e.instanteAgendado])).toEqual([["interrompida", "motor_ausente", c.turnoId, JANELA]]);
    expect(kinds(r.events).filter((k) => k === "rotina_executou")).toHaveLength(1);
    // Silenciosa: nenhuma mensagem "Rotina interrompida" nem marcador além do que o despacho já escrevia.
    expect(c.novas().filter((m) => m.kind === "rotina_execucao")).toEqual([]);
  });

  it("IA sem login: interrompida · nao_autenticado", async () => {
    const c = await cenario();
    await c.despachar({ estado: "nao_autenticado", motivo: "sem login", em: T0 });
    expect((await c.execucoes()).map((e) => [e.desfecho, e.motivo])).toEqual([["interrompida", "nao_autenticado"]]);
  });

  // revisto em 2026-10-16 (NOD-274 C3, decisão NOD-222): a rotina sem task barrada no despacho por falta de conta não é mais
  // 'interrompida' — ela espera a conta voltar (antes da próxima janela) ou a janela fica 'nao_rodou' (depois dela).
  async function semContaLivre(c: Awaited<ReturnType<typeof cenario>>, voltaEm: number) {
    const imp = (n: number) => n.toString(16).padStart(64, "0");
    const anuncio = (n: number, ia: ContaAnunciada["ia"]): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: T0 - HORA, apelidoSugerido: "Pessoal" });
    await c.deps.repos.contasIa.doAnuncio(c.vm, [anuncio(1, "claude-cli"), anuncio(2, "codex-cli")], T0);
    for (const conta of (await c.deps.repos.contasIa.listar()).contas) await c.deps.repos.contasIa.marcarLimite(conta.id, voltaEm);
  }

  it("toda conta no limite, volta antes da próxima janela (rotina sem task): espera com acordar_em, sem desfecho nem nota", async () => {
    const c = await cenario();
    await semContaLivre(c, T0 + 2 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(await c.execucoes()).toEqual([]);
    const volta = c.banco.turnos.find((t) => t.retomaTurnoId === c.turnoId);
    expect(volta).toMatchObject({ origem: "retomada", acordarEm: T0 + 2 * HORA });
    expect(c.novas().map((m) => m.payload?.kind)).not.toContain("limite_do_plano");
  });

  it("toda conta no limite, volta depois da próxima janela: a janela fica 'nao_rodou' · cota_da_ia, sem volta", async () => {
    const c = await cenario();
    await semContaLivre(c, T0 + 30 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect((await c.execucoes()).map((e) => [e.desfecho, e.motivo])).toEqual([["nao_rodou", "cota_da_ia"]]);
    expect(c.banco.turnos.find((t) => t.retomaTurnoId === c.turnoId)).toBeUndefined();
    expect(kinds(r.events).filter((k) => k === "rotina_executou")).toHaveLength(1);
  });

  it("turno de conversa recusado: nada em rotina_execucoes e os mesmos eventos de antes", async () => {
    const c = await cenario({ origem: "conversa" });
    const r = await c.despachar({ estado: "nao_autenticado", motivo: "sem login", em: T0 });
    expect(await c.execucoes()).toEqual([]);
    expect(kinds(r.events)).not.toContain("rotina_executou");
  });
});

describe("NOD-251: Parar no turno de rotina registra a janela como 'interrompida' (não 'falhou')", () => {
  // revisto no merge do #334 (NOD-256 CA5, decisão NOD-225): a parada ABERTA que barra a rotina no despacho não cala —
  // a janela fica 'interrompida' (NOD-251) com o motivo `parada_aberta` e UMA linha na conversa da rotina.
  it("parada ativa no despacho: o pendente vira interrompida · parada_aberta, com uma linha na conversa", async () => {
    const c = await cenario();
    await c.deps.repos.paradas.ativar({ conversaId: c.conversaId, agora: T0 });
    const r = await c.despachar();
    expect(r.data.plano).toBeNull();
    expect((await c.execucoes()).map((e) => [e.desfecho, e.motivo])).toEqual([["interrompida", "parada_aberta"]]);
    expect(kinds(r.events).filter((k) => k === "rotina_executou")).toHaveLength(1);
    expect(c.novas().filter((m) => m.kind === "rotina_execucao")).toHaveLength(1);
  });

  it("parada ativa no despacho, mas o interromper não mudou o turno: nada vai ao histórico e nenhuma linha sai", async () => {
    // Re-QA do #334 pós-merge da main (bde9a03d, decisão da PM de 17/10/2026): a linha `parada_aberta` sai só se o
    // interromper do despacho mudou o estado. Se outro caminho já levou o turno (interromper devolve null), o despacho
    // não registra a janela nem fala na conversa — quem mudou o turno cuida do desfecho.
    const c = await cenario();
    await c.deps.repos.paradas.ativar({ conversaId: c.conversaId, agora: T0 });
    c.deps.repos.turnos.interromper = async () => null;
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "parada_ativa" });
    expect(await c.execucoes()).toEqual([]);
    expect(kinds(r.events).filter((k) => k === "rotina_executou")).toHaveLength(0);
    expect(c.novas().filter((m) => m.kind === "rotina_execucao")).toHaveLength(0);
  });

  it("turno já entregue e parado pela pessoa: interrompida · parado_pela_pessoa, sem a mensagem de erro técnico", async () => {
    const c = await cenario();
    await c.deps.repos.turnos.assentar(c.turnoId, { estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    const turno = (await c.deps.repos.turnos.buscar(c.turnoId))!;
    const events = await registrarDesfechoDaEntrega(c.deps, turno);
    expect((await c.execucoes()).map((e) => [e.desfecho, e.motivo])).toEqual([["interrompida", "parado_pela_pessoa"]]);
    expect(kinds(events)).toEqual(["rotina_executou"]);
    expect(c.novas().map((m) => m.texto).join("\n")).not.toMatch(/falhou|erro técnico/i);
  });

  it("o resto da entrega segue igual: concluído → executou; máquina sem contato → nada (o varredor cuida)", async () => {
    const semContato = await cenario();
    await semContato.deps.repos.turnos.assentar(semContato.turnoId, { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    expect(await registrarDesfechoDaEntrega(semContato.deps, (await semContato.deps.repos.turnos.buscar(semContato.turnoId))!)).toEqual([]);
    expect(await semContato.execucoes()).toEqual([]);

    const concluido = await cenario();
    await concluido.deps.repos.turnos.assentar(concluido.turnoId, { estado: "concluido" });
    await registrarDesfechoDaEntrega(concluido.deps, (await concluido.deps.repos.turnos.buscar(concluido.turnoId))!);
    expect((await concluido.execucoes()).map((e) => e.desfecho)).toEqual(["executou"]);
  });
});

describe("o rótulo do histórico diz o motivo em palavras", () => {
  it.each([
    ["motor_ausente", "interrompida · a IA não estava pronta na máquina"],
    ["nao_autenticado", "interrompida · a IA da máquina estava sem login"],
    ["limite_do_plano", "interrompida · a conta da IA estava no limite"],
    ["parado_pela_pessoa", "interrompida · você parou"],
    // QA do #334 (NOD-256 CA5): a janela barrada pela parada aberta não mostra o identificador cru no histórico.
    ["parada_aberta", "interrompida · o bot estava parado por você"],
  ])("%s", (motivo, rotulo) => {
    expect(rotuloExecucao({ desfecho: "interrompida", motivo })).toBe(rotulo);
  });
});
