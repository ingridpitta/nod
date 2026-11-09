import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { PayloadTrocaDeIa } from "../../../src/contracts/troca-de-ia.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../../src/domain/cota-da-ia.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { seguirComConta } from "../../../src/use-cases/contas-ia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { decidirTrocaDeIa, varrerTrocasDeIa } from "../../../src/use-cases/trocas-de-ia.ts";
import { depsEmMemoria, esperarErro, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * ADR-108 (2026-10-16): a troca de IA das tasks no limite. O exemplo do canvas: o Eng 1 no Automático, com tasks em
 * sessão no Claude; o Claude · Pessoal (a única do Claude na fila) acaba e o ChatGPT · Pessoal está livre.
 */
const T0 = Date.now();
const MIN = 60_000;
const HORA = 60 * MIN;
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string, corporativa = false): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa, logadaEm: T0 - HORA, apelidoSugerido: apelido });
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
const limite = (voltaEm: number | null): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm ?? undefined, erroCru: "usage limit" });
const PESSOA = { autor_tipo: "pessoa" as const, autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "pessoa" as const, regra_versao: 1 };

async function cenario(o: { fixo?: boolean } = {}) {
  const relogio = { agora: T0 };
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => relogio.agora });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Eng 1" });
  if (o.fixo) await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "fixa", fixa: "claude-cli" } });
  const vm = (await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) }))!.id;
  await deps.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Lumen", true)], T0);
  const [cPessoal, gPessoal, cLumen] = (await deps.repos.contasIa.listar()).contas;
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  /** Uma task do bot com a sessão no Claude e o turno dela, já reivindicado. */
  const task = async (comSessao = true) => {
    const t = await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "A1", origem: "pessoa", rotinaId: null, forma: "frente" });
    if (comSessao) await deps.repos.trabalhos.atualizarSessao(t!.id, "sessao-claude", "claude-cli", "local");
    const turno = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "faz a A1", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: t!.id });
    return { trabalhoId: t!.id, turnoId: turno!.id };
  };
  const conversa = async () => {
    const m = await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, autoria: PESSOA, kind: "texto", texto: "ta sem cota?", confianca: "confiavel" });
    const t = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "ta sem cota?", mensagemOrigemId: m!.id, entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local" });
    return t!.id;
  };
  /** O turno roda na conta dada e volta no limite. */
  const bateNoLimite = async (turnoId: string, contaId: string, voltaEm: number | null, harness: IdHarness = "claude-cli") => {
    const t = banco.turnos.find((x) => x.id === turnoId)!;
    Object.assign(t, { estado: "despachando", machineId: vm, leaseAte: relogio.agora + HORA });
    await deps.repos.turnos.registrarConta(turnoId, contaId);
    return executar(deps, assentarTurno, { turnoId, machineId: vm, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: limite(voltaEm), executor: "local", harness, prontosDaPessoa: ["claude-cli", "codex-cli"] });
  };
  const trocas = () => banco.trocasDeIa;
  const avisos = () => banco.mensagens.filter((m) => m.payload?.kind === "troca_de_ia");
  const payload = () => avisos().at(-1)?.payload as PayloadTrocaDeIa | undefined;
  return { deps, banco, relogio, vm, bot: bot.agente, conversaId: bot.conversa.id, contas: { cPessoal: cPessoal!, gPessoal: gPessoal!, cLumen: cLumen! }, task, conversa, bateNoLimite, trocas, avisos, payload };
}

describe("R4: a task com sessão na IA que parou não troca de IA sozinha", () => {
  it("volta perto (≤ 30 min): espera a conta voltar e o bot ganha UM aviso recomendando esperar", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 11 * MIN);
    const volta = c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId);
    expect(volta).toMatchObject({ estado: "pendente", origem: "retomada", acordarEm: T0 + 11 * MIN, harness: "auto" });
    expect(c.trocas()).toMatchObject([{ agenteId: c.bot.id, iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "esperar", aplicarEm: null, decididoEm: null }]);
    expect(c.payload()).toMatchObject({ kind: "troca_de_ia", iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "esperar", voltaEm: T0 + 11 * MIN, tasks: 1, aplicarEm: null });
    // A linha mora na conversa do bot, fora da task (sem turno).
    expect(c.avisos()[0]).toMatchObject({ conversaId: c.conversaId, turnoId: null });
  });

  it("volta longe (> 30 min): recomenda levar, com prazo de 10 min; a segunda task atualiza o MESMO aviso", async () => {
    const c = await cenario();
    const a = await c.task();
    const b = await c.task();
    await c.bateNoLimite(a.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    await c.bateNoLimite(b.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    expect(c.trocas()).toHaveLength(1);
    expect(c.trocas()[0]).toMatchObject({ recomendacao: "levar", aplicarEm: T0 + 10 * MIN });
    expect(c.avisos()).toHaveLength(1);
    expect(c.payload()).toMatchObject({ recomendacao: "levar", tasks: 2, aplicarEm: T0 + 10 * MIN });
  });

  it("sem hora do fornecedor: recomenda levar", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, null);
    expect(c.trocas()[0]?.recomendacao).toBe("levar");
  });

  it("task SEM sessão na IA que parou: segue na outra na hora, sem aviso", async () => {
    const c = await cenario();
    const t = await c.task(false);
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    expect(c.trocas()).toEqual([]);
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)).toMatchObject({ acordarEm: T0 });
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)?.entradaTexto).toMatch(/passou este trabalho para o Codex/);
    expect(c.banco.mensagens.map((m) => m.texto).join("\n")).toMatch(/Esta task segue no Codex/);
  });

  it("a conversa no Automático continua trocando de IA na hora (R3), sem aviso de troca", async () => {
    const c = await cenario();
    const t = await c.conversa();
    await c.bateNoLimite(t, c.contas.cPessoal.id, T0 + 16 * HORA);
    expect(c.trocas()).toEqual([]);
    expect(c.banco.mensagens.at(-1)?.payload).toMatchObject({ kind: "conta_seguiu", para: { id: c.contas.gPessoal.id } });
  });
});

describe("R4: a decisão da pessoa e o varredor", () => {
  it("'levar': só as tasks pendentes do bot na IA que parou mudam; só a espera da cota acorda; o 'me chame às' e a conversa ficam", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    const meChame = await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.bot.id, origem: "retomada", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "[nod] Você pediu para ser chamado às 16:00.", entradaConfianca: "confiavel", modelo: "auto", harness: "claude-cli", executor: "local", trabalhoId: t.trabalhoId, acordarEm: T0 + 5 * HORA });
    const conversa = await c.conversa();
    const r = await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" });
    expect(r.data).toEqual({ decisao: "levar", aplicada: true, tasks: 2 });
    const volta = c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)!;
    expect(volta).toMatchObject({ harness: "codex-cli", modelo: "auto", acordarEm: null });
    expect(volta.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(true);
    expect(volta.entradaTexto).toMatch(/passou este trabalho para o ChatGPT/);
    expect(volta.entradaTexto).not.toMatch(/esperou/);
    expect(c.banco.turnos.find((x) => x.id === meChame!.id)).toMatchObject({ harness: "codex-cli", acordarEm: T0 + 5 * HORA });
    expect(c.banco.turnos.find((x) => x.id === conversa)).toMatchObject({ harness: "auto" });
    expect(c.payload()).toMatchObject({ decisao: "levar" });
    // O segundo clique (ou a outra aba) não aplica de novo.
    expect((await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar" })).data).toMatchObject({ aplicada: false });
  });

  it("'esperar': nada muda; sem aviso aberto, a decisão é um no-op", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar" });
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)).toMatchObject({ harness: "auto", acordarEm: T0 + 16 * HORA });
    expect(c.trocas()[0]).toMatchObject({ decisao: "esperar" });
    // O varredor não aplica o "levar" de um aviso fechado.
    c.relogio.agora = T0 + 11 * MIN;
    expect((await varrerTrocasDeIa(c.deps)).aplicadas).toBe(0);
  });

  it("valida a decisão: desconhecida, ou 'outra_ia' num bot que não é fixo, é entrada inválida; bot de outra pessoa não decide", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    await esperarErro(() => executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "talvez" }), "entrada_invalida");
    await esperarErro(() => executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "outra_ia" }), "entrada_invalida");
    expect(c.trocas()[0]?.decididoEm).toBeNull();
  });

  it("varredor: 'levar' recomendado vence em 10 min e é aplicado UMA vez ('expirou'); 'esperar' sem resposta não faz nada", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    c.relogio.agora = T0 + 9 * MIN;
    expect((await varrerTrocasDeIa(c.deps)).aplicadas).toBe(0);
    c.relogio.agora = T0 + 10 * MIN;
    expect((await varrerTrocasDeIa(c.deps)).aplicadas).toBe(1);
    expect(c.trocas()[0]).toMatchObject({ decisao: "expirou" });
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)).toMatchObject({ harness: "codex-cli", acordarEm: null });
    expect((await varrerTrocasDeIa(c.deps)).aplicadas).toBe(0);

    const d = await cenario();
    const u = await d.task();
    await d.bateNoLimite(u.turnoId, d.contas.cPessoal.id, T0 + 20 * MIN);
    d.relogio.agora = T0 + 15 * MIN;
    expect(await varrerTrocasDeIa(d.deps)).toMatchObject({ fechadas: 0, aplicadas: 0 });
  });

  it("varredor: a conta voltou — fecha o aviso ('voltou') e acorda as tasks que esperavam", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 20 * MIN);
    // Um turno que deu certo tirou a conta do limite antes do prazo.
    await c.deps.repos.contasIa.limparLimite(c.contas.cPessoal.id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 1, aplicadas: 0 });
    expect(c.trocas()[0]).toMatchObject({ decisao: "voltou" });
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)).toMatchObject({ harness: "auto", acordarEm: null });
  });
});

describe("E1: a guarda do despacho", () => {
  it("a task do Automático com sessão no Claude sem conta do Claude utilizável não sai no ChatGPT: volta a esperar e o aviso nasce", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    const r = await executar(c.deps, despacharTurno, { machineId: c.vm, executor: "local", inventario: { estado: "pronto", versao: "2.1.296", em: T0 }, harnessesProntos: ["claude-cli", "codex-cli"] });
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.find((x) => x.id === t.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "limite_do_plano" });
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)).toMatchObject({ estado: "pendente", acordarEm: T0 + 2 * HORA });
    expect(c.trocas()).toMatchObject([{ iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "levar" }]);
  });

  it("depois do 'levar' o turno vem fixo no ChatGPT e o despacho segue; a task sem sessão também segue", async () => {
    const c = await cenario();
    const t = await c.task(false);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    const r = await executar(c.deps, despacharTurno, { machineId: c.vm, executor: "local", inventario: { estado: "pronto", versao: "2.1.296", em: T0 }, harnessesProntos: ["claude-cli", "codex-cli"] });
    expect(r.data.plano).not.toBeNull();
    expect(r.data.turno?.id).toBe(t.turnoId);
    expect(c.trocas()).toEqual([]);
  });
});

describe("R6: o bot fixo sem conta da IA dele na fila", () => {
  it("na conversa: o aviso com o estado e os dois caminhos (a conta fora da fila, a outra IA) no lugar da nota", async () => {
    const c = await cenario({ fixo: true });
    const t = await c.conversa();
    await c.bateNoLimite(t, c.contas.cPessoal.id, T0 + 16 * HORA);
    expect(c.banco.mensagens.some((m) => m.payload?.kind === "limite_do_plano")).toBe(false);
    expect(c.payload()).toMatchObject({ kind: "troca_de_ia", fixo: true, iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "esperar", aplicarEm: null, conta: { id: c.contas.cLumen.id, apelido: "Lumen", corporativa: true } });
    expect(c.avisos()[0]?.turnoId).toBe(t);
    expect(c.avisos()[0]?.texto).toMatch(/^Eng 1 parou até .+ Volta sozinho/);
  });

  it("(b) 'Continuar no ChatGPT até a volta': o bot vai ao Automático, a fala é refeita, e o varredor devolve o fixo quando a conta volta", async () => {
    const c = await cenario({ fixo: true });
    const t = await c.conversa();
    const task = await c.task();
    await c.bateNoLimite(t, c.contas.cPessoal.id, T0 + 2 * HORA);
    const r = await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "outra_ia" });
    expect(r.data).toMatchObject({ decisao: "outra_ia", aplicada: true });
    expect((await c.deps.repos.agentes.buscar(c.bot.id))?.inteligencia).toMatchObject({ modo: "auto", fixa: null });
    expect(c.trocas()[0]?.voltaAoFixo).toMatchObject({ modo: "fixa", fixa: "claude-cli" });
    expect(c.banco.turnos.find((x) => x.id === task.turnoId)).toMatchObject({ harness: "codex-cli" });
    expect(c.banco.turnos.filter((x) => x.estado === "pendente" && !x.trabalhoId)).toMatchObject([{ harness: "auto", modelo: "auto", entradaTexto: "ta sem cota?" }]);
    c.relogio.agora = T0 + HORA;
    expect((await varrerTrocasDeIa(c.deps)).restaurados).toBe(0);
    c.relogio.agora = T0 + 2 * HORA;
    expect((await varrerTrocasDeIa(c.deps)).restaurados).toBe(1);
    expect((await c.deps.repos.agentes.buscar(c.bot.id))?.inteligencia).toMatchObject({ modo: "fixa", fixa: "claude-cli" });
    expect((await varrerTrocasDeIa(c.deps)).restaurados).toBe(0);
  });

  it("(a) 'Continuar na conta Lumen': grava a escolhida, acorda as tasks que esperavam o Claude, fecha o aviso e refaz a fala", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    const t = await c.conversa();
    await c.bateNoLimite(t, c.contas.cPessoal.id, T0 + 16 * HORA);
    expect(c.avisos()).toHaveLength(1);
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({ "claude-cli": c.contas.cLumen.id });
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === task.turnoId)).toMatchObject({ acordarEm: null, harness: "claude-cli" });
    expect(c.trocas()[0]).toMatchObject({ decisao: "conta" });
    expect(r.data.turnoId).not.toBeNull();
  });
});

describe("R5: trocar a IA do bot levando as tasks", () => {
  it("levarTasks: true leva as tasks pendentes e acorda as esperas da cota; ausente, só daqui em diante; não booleano é inválido", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.contas.cPessoal.id, T0 + 16 * HORA);
    await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "fixa", fixa: "codex-cli" } });
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)).toMatchObject({ harness: "auto", acordarEm: T0 + 16 * HORA });
    await esperarErro(() => executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "fixa", fixa: "codex-cli", levarTasks: "sim" } }), "entrada_invalida");
    const r = await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "fixa", fixa: "codex-cli", levarTasks: true } });
    expect(r.data.tasksLevadas).toBe(1);
    expect(c.banco.turnos.find((x) => x.retomaTurnoId === t.turnoId)).toMatchObject({ harness: "codex-cli", acordarEm: null });
    expect(c.trocas()[0]).toMatchObject({ decisao: "levar" });
    // A chave desconhecida continua recusada (aplicarPedidoInteligencia é estrito).
    await esperarErro(() => executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "auto", outra: 1 } }), "entrada_invalida");
  });
});
