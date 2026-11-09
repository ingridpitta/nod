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
import { emitirPlanoTurno } from "../../../src/use-cases/emitir-plano-turno.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { interromperPorMaquina } from "../../../src/use-cases/interromper-por-maquina.ts";
import { avisarTrocaDeIa, decidirTrocaDeIa, varrerTrocasDeIa } from "../../../src/use-cases/trocas-de-ia.ts";
import { depsEmMemoria, esperarErro, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * ADR-108, revisão do PR 2 (16/10/2026): os achados C1–C6 e I1–I6 da troca de IA no limite. O cenário: o Eng 1 no
 * Automático, preso à vm-bots (a máquina dele), com o Claude · Pessoal e o ChatGPT · Pessoal na fila e o Claude · Lumen
 * (corporativa) fora; o Mac da pessoa tem outras contas.
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
const pronto = { estado: "pronto" as const, versao: "2.1.296", em: T0 };
const PESSOA = { autor_tipo: "pessoa" as const, autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "pessoa" as const, regra_versao: 1 };

async function cenario(o: { fixo?: boolean; codexNaVm?: boolean; segundaCodex?: boolean; segundaClaude?: boolean } = {}) {
  const relogio = { agora: T0 };
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => relogio.agora });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Eng 1" });
  if (o.fixo) await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "fixa", fixa: "claude-cli" } });
  const vm = (await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) }))!.id;
  const mac = (await deps.repos.maquinaTokens.criar({ nome: "mac", prefixo: "9a1b", hash: randomBytes(32) }))!.id;
  await deps.repos.agentes.definirMaquina([bot.agente.id], vm);
  await deps.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Lumen", true), ...(o.segundaCodex ? [anuncio(5, "codex-cli", "Reserva")] : []), ...(o.segundaClaude ? [anuncio(6, "claude-cli", "Marlon 20x")] : [])], T0);
  // O Mac tem uma 2ª conta do Claude, NA FILA (a pessoa ligou), que a vm-bots não tem.
  await deps.repos.contasIa.doAnuncio(mac, [anuncio(4, "claude-cli", "Mac")], T0);
  const lista = (await deps.repos.contasIa.listar()).contas;
  const conta = (apelido: string, ia: IdHarness = "claude-cli") => lista.find((c) => c.apelido === apelido && c.ia === ia)!;
  await deps.repos.contasIa.definirTrocaAutomatica(conta("Mac").id, true);
  if (o.segundaCodex) await deps.repos.contasIa.definirTrocaAutomatica(conta("Reserva", "codex-cli").id, true);
  if (o.segundaClaude) await deps.repos.contasIa.definirTrocaAutomatica(conta("Marlon 20x").id, true);
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const task = async (o2: { sessao?: IdHarness | null; origem?: "conversa" | "delegacao" } = {}) => {
    const t = await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "A1", origem: "pessoa", rotinaId: null, forma: "frente", ...(o2.sessao !== null ? { iniciadoEm: T0 - HORA } : {}) });
    if (o2.sessao !== null) await deps.repos.trabalhos.atualizarSessao(t!.id, `sessao-${o2.sessao ?? "claude-cli"}`, o2.sessao ?? "claude-cli", "local");
    const turno = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o2.origem ?? "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "faz a A1", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: t!.id });
    return { trabalhoId: t!.id, turnoId: turno!.id };
  };
  const prontosPorMaquina = { [vm]: (o.codexNaVm === false ? ["claude-cli"] : ["claude-cli", "codex-cli"]) as IdHarness[], [mac]: ["claude-cli", "codex-cli"] as IdHarness[] };
  const bateNoLimite = async (turnoId: string, contaId: string, voltaEm: number | null, harness: IdHarness = "claude-cli") => {
    const t = banco.turnos.find((x) => x.id === turnoId)!;
    Object.assign(t, { estado: "despachando", machineId: vm, leaseAte: relogio.agora + HORA });
    await deps.repos.turnos.registrarConta(turnoId, contaId);
    return executar(deps, assentarTurno, { turnoId, machineId: vm, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: limite(voltaEm), executor: "local", harness, prontosDaPessoa: ["claude-cli", "codex-cli"], prontosPorMaquina });
  };
  const despachar = () => executar(deps, despacharTurno, { machineId: vm, executor: "local", inventario: pronto, harnessesProntos: prontosPorMaquina[vm], harnessesDaPessoa: { "claude-cli": pronto, "codex-cli": pronto }, prontosPorMaquina });
  const trocas = () => banco.trocasDeIa;
  const avisos = () => banco.mensagens.filter((m) => m.payload?.kind === "troca_de_ia");
  const payload = () => avisos().at(-1)?.payload as PayloadTrocaDeIa | undefined;
  const voltaDe = (turnoId: string) => banco.turnos.find((x) => x.retomaTurnoId === turnoId);
  return { deps, banco, relogio, vm, mac, bot: bot.agente, conversaId: bot.conversa.id, conta, task, bateNoLimite, despachar, trocas, avisos, payload, voltaDe, prontosPorMaquina };
}

describe("C1: a cota medida não leva a task com sessão para outra IA", () => {
  it("Claude em 100% medido e o ChatGPT livre: a task com sessão no Claude espera a janela renovar e o aviso nasce", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "esgotado", cincoHoras: { utilizacao: 1, renovaEm: T0 + 3 * HORA }, semana: null, medidoEm: T0 }, c.vm, c.conta("Pessoal").id);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.voltaDe(t.turnoId)).toMatchObject({ estado: "pendente", acordarEm: T0 + 3 * HORA, harness: "auto" });
    expect(c.trocas()).toMatchObject([{ iaDe: "claude-cli", iaPara: "codex-cli", voltaEm: T0 + 3 * HORA, machineId: c.vm }]);
  });

  it("NOD-390: o aviso leva a conta da fila do ChatGPT na máquina do bot (o cartão diz 'segue no ChatGPT · conta Pessoal')", async () => {
    const c = await cenario();
    await c.task();
    await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "esgotado", cincoHoras: { utilizacao: 1, renovaEm: T0 + 3 * HORA }, semana: null, medidoEm: T0 }, c.vm, c.conta("Pessoal").id);
    await c.despachar();
    expect(c.payload()).toMatchObject({ iaPara: "codex-cli", contaPara: { id: c.conta("Pessoal", "codex-cli").id, apelido: "Pessoal" } });
  });

  it("NOD-390: sem conta do ChatGPT na máquina do bot, o aviso não inventa conta", async () => {
    const c = await cenario();
    const r = await avisarTrocaDeIa(c.deps, { agenteId: c.bot.id, conversaId: c.conversaId, turnoId: null, iaDe: "claude-cli", iaPara: "codex-cli", voltaEm: T0 + HORA, fixo: false, machineId: c.mac, autoria: { ...PESSOA }, agora: T0 });
    expect(r.length).toBeGreaterThan(0);
    expect(c.payload()?.iaPara).toBe("codex-cli");
    expect(c.payload()).not.toHaveProperty("contaPara");
  });

  it("NOD-390 (QA): bot com IA fixa ou troca para a mesma IA: o aviso não leva conta de outra IA", async () => {
    for (const [iaPara, fixo] of [["codex-cli", true], ["claude-cli", false]] as const) {
      const c = await cenario();
      await avisarTrocaDeIa(c.deps, { agenteId: c.bot.id, conversaId: c.conversaId, turnoId: null, iaDe: "claude-cli", iaPara, voltaEm: T0 + HORA, fixo, machineId: c.vm, autoria: { ...PESSOA }, agora: T0 });
      expect(c.payload(), `${iaPara} fixo=${fixo}`).not.toHaveProperty("contaPara");
    }
  });

  it("na reserva (99,5%), a task que já começou segue no Claude: a sessão não sai para o ChatGPT", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "perto", cincoHoras: { utilizacao: 0.995, renovaEm: T0 + 3 * HORA }, semana: null, medidoEm: T0 }, c.vm, c.conta("Pessoal").id);
    // O plano (emitir) não põe o Claude no "no limite" desta task: a sessão é dele.
    const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: t.turnoId, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(plano.data.harness).toBe("claude-cli");
    // E a guarda do despacho deixa passar (a reserva não segura o fundo que já começou).
    const r = await c.despachar();
    expect(r.data.plano?.turnoId).toBe(t.turnoId);
    expect(c.trocas()).toEqual([]);
  });
});

describe("NOD-401: o limite de UMA conta não para a IA com outra conta dela livre na fila da máquina", () => {
  // A leitura da conta que rodou vai para a linha por IA E para a da conta (assentar-turno.ts); a semana em 100%.
  const esgotada = (renovaEm: number, medidoEm = T0) => ({ harness: "claude-cli" as const, situacao: "esgotado" as const, cincoHoras: { utilizacao: 0.4, renovaEm: T0 + 2 * HORA }, semana: { utilizacao: 1, renovaEm }, medidoEm });

  for (const origem of ["conversa", "delegacao"] as const) {
    it(`a conta 1 com a semana em 100% (linha por IA e da conta) e a conta 2 livre na fila: a task (${origem}) segue, sem aviso`, async () => {
      const c = await cenario({ segundaClaude: true });
      const t = await c.task({ origem });
      await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 66 * HORA), c.vm, c.conta("Pessoal").id);
      // O plano fica no Claude (a sessão é dele) na conta livre da fila — o ChatGPT · Pessoal vem antes na lista, mas a
      // posição das contas não leva a task em silêncio para outra IA (ADR-108 R4).
      const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: t.turnoId, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
      expect(plano.data.harness).toBe("claude-cli");
      expect(plano.data.conta?.apelido).toBe("Marlon 20x");
      const r = await c.despachar();
      expect(r.data.plano?.turnoId).toBe(t.turnoId);
      expect(c.trocas()).toEqual([]);
      expect(c.avisos()).toEqual([]);
      expect(c.voltaDe(t.turnoId)).toBeUndefined();
    });
  }

  it("só a linha por IA em 100% (sem leitura por conta): a IA com conta logada na máquina não para", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 66 * HORA), c.vm);
    const r = await c.despachar();
    expect(r.data.plano?.turnoId).toBe(t.turnoId);
    expect(c.trocas()).toEqual([]);
  });

  it("as duas contas da fila na máquina no limite: o aviso diz a conta cuja volta ele mostra (a primeira que renova)", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 66 * HORA), c.vm, c.conta("Pessoal").id);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA, T0 + 1), c.vm, c.conta("Marlon 20x").id);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + 5 * HORA });
    expect(c.trocas()).toMatchObject([{ iaDe: "claude-cli", iaPara: "codex-cli", voltaEm: T0 + 5 * HORA }]);
    expect(c.payload()).toMatchObject({ contaQueParou: { id: c.conta("Marlon 20x").id, apelido: "Marlon 20x" } });
    expect(c.avisos().at(-1)?.texto).toMatch(/^A conta Marlon 20x do Claude chegou ao limite/);
  });

  it("o aviso que nasce no assentamento (limite durante a rodada) também diz a conta, e o despacho não o regrava sem ela", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    expect(c.trocas()).toMatchObject([{ iaDe: "claude-cli", iaPara: "codex-cli" }]);
    expect(c.payload()).toMatchObject({ contaQueParou: { id: c.conta("Pessoal").id, apelido: "Pessoal" } });
    expect(c.avisos().at(-1)?.texto).toMatch(/^A conta Pessoal do Claude chegou ao limite/);
  });

  for (const origem of ["conversa", "delegacao"] as const) {
    it(`a conta 1 bate o limite semanal NA RODADA e a conta 2 está livre na fila (${origem}): segue na hora, com a linha leve e sem espera`, async () => {
      const c = await cenario({ segundaClaude: true });
      const t = await c.task({ origem });
      await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 66 * HORA);
      expect(c.trocas()).toEqual([]);
      const volta = c.voltaDe(t.turnoId)!;
      expect(volta).toMatchObject({ estado: "pendente", acordarEm: T0 });
      expect(volta.entradaTexto).toContain("seguiu com a conta Marlon 20x");
      const linhas = c.banco.mensagens.filter((m) => m.kind === "sistema").map((m) => m.texto);
      expect(linhas.some((x) => /espera e volta sozinha|esperando/.test(x))).toBe(false);
      expect(linhas.some((x) => /Pessoal acabou .*→ seguindo no .*Marlon 20x/.test(x))).toBe(true);
      const r = await c.despachar();
      expect(r.data.plano?.turnoId).toBe(volta.id);
      expect(c.trocas()).toEqual([]);
    });
  }

  it("task do Automático troca de conta sem virar bot fixo quando a segunda conta também para", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 66 * HORA);
    const seguiu = c.voltaDe(t.turnoId)!;
    expect(seguiu.harness).toBe("auto");
    await c.bateNoLimite(seguiu.id, c.conta("Marlon 20x").id, T0 + 5 * HORA);
    expect(c.trocas().at(-1)).toMatchObject({ fixo: false, recomendacao: "levar", aplicarEm: T0 + 10 * MIN });
    expect(c.payload()).toMatchObject({ contaQueParou: { id: c.conta("Marlon 20x").id, apelido: "Marlon 20x" } });
  });

  it("pedido de colega sem task: segue na conta 2 e a conta 2 também bate o limite — a volta espera E a linha de espera sai (a troca de conta não conta como espera)", async () => {
    const c = await cenario({ segundaClaude: true });
    const agente = (await c.deps.repos.agentes.buscar(c.bot.id))!;
    const t = await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.bot.id, origem: "delegacao", prazoEm: T0 + 86_400_000, profundidade: 1, entradaTexto: "revisa o PR", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: null });
    await c.bateNoLimite(t!.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    const seguiu = c.banco.turnos.find((x) => x.estado === "pendente")!;
    expect(seguiu.entradaTexto).toContain("seguiu com a conta Marlon 20x");
    const planoDaVolta = await executar(c.deps, emitirPlanoTurno, { turnoId: seguiu.id, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(planoDaVolta.data).toMatchObject({ harness: "claude-cli", conta: { id: c.conta("Marlon 20x").id } });
    await c.bateNoLimite(seguiu.id, c.conta("Marlon 20x").id, T0 + 5 * HORA);
    // A volta retoma o turno de origem (retomaTurnoId é a raiz da cadeia), não o turno que seguiu.
    const espera = c.banco.turnos.filter((x) => x.estado === "pendente");
    expect(espera).toMatchObject([{ origem: "retomada", acordarEm: T0 + 5 * HORA }]);
    expect(espera[0]!.entradaTexto).not.toContain("seguiu com a conta");
    const linhas = c.banco.mensagens.filter((m) => m.kind === "sistema").map((m) => m.texto);
    expect(linhas.filter((x) => /espera|volta sozinh/.test(x) && !/seguindo/.test(x))).toHaveLength(1);
  });

  it("pedido sem task: troca de conta e a máquina cai — a primeira espera real ainda ganha a linha da máquina", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await pedidoSemTask(c);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    const seguiu = pendentes(c)[0]!;
    expect(seguiu.entradaTexto).toContain("seguiu com a conta Marlon 20x");
    expect(await c.deps.repos.turnos.reivindicar({ machineId: c.vm, agora: T0 })).toMatchObject({ id: seguiu.id });
    c.relogio.agora = T0 + HORA;
    const vencido = (await c.deps.repos.turnos.vencidos(c.relogio.agora)).find((x) => x.id === seguiu.id);
    expect(vencido).toBeDefined();
    await interromperPorMaquina(c.deps, { turnos: [vencido!] });
    expect(c.banco.mensagens.filter((m) => m.kind === "sistema" && m.texto.includes("fica na fila"))).toHaveLength(1);
    const depoisDaQueda = pendentes(c)[0]!;
    const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: depoisDaQueda.id, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(plano.data).toMatchObject({ harness: "claude-cli", conta: { id: c.conta("Marlon 20x").id } });
  });

  const pedidoSemTask = async (c: Awaited<ReturnType<typeof cenario>>) => {
    const agente = (await c.deps.repos.agentes.buscar(c.bot.id))!;
    return (await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.bot.id, origem: "delegacao", prazoEm: T0 + 86_400_000, profundidade: 1, entradaTexto: "revisa o PR", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: null }))!;
  };
  const pendentes = (c: Awaited<ReturnType<typeof cenario>>) => c.banco.turnos.filter((x) => x.estado === "pendente");
  const linhasDeEspera = (c: Awaited<ReturnType<typeof cenario>>) => c.banco.mensagens.filter((m) => m.kind === "sistema" && /espera e volta sozinh/.test(m.texto));

  it("pedido de colega sem task: a conta 1 bate o limite e a 2 está segurada pela leitura até +5 h — espera até +5 h, não até a volta da 1", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await pedidoSemTask(c);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA), c.vm, c.conta("Marlon 20x").id);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    const espera = pendentes(c)[0]!;
    expect(espera).toMatchObject({ origem: "retomada", acordarEm: T0 + 5 * HORA, harness: "claude-cli" });
    c.relogio.agora = T0 + 5 * HORA;
    const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: espera.id, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(plano.data).toMatchObject({ harness: "claude-cli", conta: { id: c.conta("Marlon 20x").id } });
  });

  it("pedido sem task: a escolhida fora da fila bate o limite — a escolha é limpa e a volta espera a conta da fila", async () => {
    const c = await cenario();
    const t = await pedidoSemTask(c);
    await c.deps.repos.contasIa.definirEscolhida("claude-cli", c.conta("Lumen").id);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA), c.vm, c.conta("Pessoal").id);
    await c.bateNoLimite(t.id, c.conta("Lumen").id, T0 + HORA);
    expect(pendentes(c)).toMatchObject([{ origem: "retomada", acordarEm: T0 + 5 * HORA }]);
  });

  it("pedido sem task: a conta da fila bate o limite — a escolhida fora da fila continua candidata à primeira volta", async () => {
    const c = await cenario();
    const t = await pedidoSemTask(c);
    await c.deps.repos.contasIa.definirEscolhida("claude-cli", c.conta("Lumen").id);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA), c.vm, c.conta("Lumen").id);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    expect(pendentes(c)).toMatchObject([{ origem: "retomada", acordarEm: T0 + 5 * HORA }]);
  });

  it("pedido sem task: a escolhida fora da fila está livre — segue nela agora e o plano não muda para o ChatGPT", async () => {
    const c = await cenario();
    const t = await pedidoSemTask(c);
    await c.deps.repos.contasIa.definirEscolhida("claude-cli", c.conta("Lumen").id);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    const seguiu = pendentes(c)[0]!;
    expect(seguiu).toMatchObject({ origem: "retomada", acordarEm: T0 });
    expect(seguiu.entradaTexto).toContain("seguiu com a conta Lumen");
    const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: seguiu.id, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(plano.data).toMatchObject({ harness: "claude-cli", conta: { id: c.conta("Lumen").id } });
  });

  it("pedido sem task: a conta seguinte esgota antes do despacho — espera o Claude, sem cair no ChatGPT", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await pedidoSemTask(c);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA), c.vm, c.conta("Marlon 20x").id);
    const r = await c.despachar();
    expect(r.data.plano).toBeNull();
    expect(pendentes(c)).toMatchObject([{ origem: "retomada", acordarEm: T0 + 5 * HORA, harness: "claude-cli" }]);
  });

  it("pedido sem task: a conta seguinte esgota entre a guarda e o plano — revalida e espera sem executar sem conta", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await pedidoSemTask(c);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    const emitido = pendentes(c)[0]!;
    c.deps.services.planos.emitir = async (_trx, turnoId, machineId) => {
      await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA), c.vm, c.conta("Marlon 20x").id);
      return (await executar(c.deps, emitirPlanoTurno, { turnoId, machineId, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).data;
    };
    const r = await c.despachar();
    expect(r.data.plano).toBeNull();
    expect(pendentes(c)).toMatchObject([{ origem: "retomada", acordarEm: T0 + 5 * HORA, harness: "claude-cli" }]);
    expect(c.deps.services.revogados).toContain(emitido.id);
  });

  it("task com sessão: a conta seguinte esgota entre a guarda e o plano — não troca silenciosamente para o ChatGPT", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 66 * HORA);
    c.deps.services.planos.emitir = async (_trx, turnoId, machineId) => {
      await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA), c.vm, c.conta("Marlon 20x").id);
      return (await executar(c.deps, emitirPlanoTurno, { turnoId, machineId, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).data;
    };
    const r = await c.despachar();
    expect(r.data.plano).toBeNull();
    expect(c.trocas().at(-1)).toMatchObject({ iaDe: "claude-cli", iaPara: "codex-cli", fixo: false, recomendacao: "levar" });
    expect(pendentes(c)).toMatchObject([{ origem: "retomada", acordarEm: T0 + 5 * HORA, harness: "auto" }]);
  });

  it("pedido sem task: a conta volta depois de um plano obsoleto sem conta — recompõe o plano com a conta", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await pedidoSemTask(c);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    let chamadas = 0;
    c.deps.services.planos.emitir = async (_trx, turnoId, machineId) => {
      chamadas += 1;
      if (chamadas === 1) await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA, T0 + 1), c.vm, c.conta("Marlon 20x").id);
      const plano = (await executar(c.deps, emitirPlanoTurno, { turnoId, machineId, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).data;
      if (chamadas === 1) await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.1, renovaEm: T0 + 4 * HORA }, semana: { utilizacao: 0.2, renovaEm: T0 + 90 * HORA }, medidoEm: T0 + 2 }, c.vm, c.conta("Marlon 20x").id);
      return plano;
    };
    const r = await c.despachar();
    expect(chamadas).toBe(2);
    expect(r.data.plano).toMatchObject({ harness: "claude-cli", conta: { id: c.conta("Marlon 20x").id } });
    expect(pendentes(c)).toEqual([]);
  });

  it("task com sessão: a conta volta depois do plano Codex obsoleto — recompõe no Claude com a sessão", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 66 * HORA);
    let chamadas = 0;
    c.deps.services.planos.emitir = async (_trx, turnoId, machineId) => {
      chamadas += 1;
      if (chamadas === 1) await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA, T0 + 1), c.vm, c.conta("Marlon 20x").id);
      const plano = (await executar(c.deps, emitirPlanoTurno, { turnoId, machineId, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).data;
      if (chamadas === 1) await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.1, renovaEm: T0 + 4 * HORA }, semana: { utilizacao: 0.2, renovaEm: T0 + 90 * HORA }, medidoEm: T0 + 2 }, c.vm, c.conta("Marlon 20x").id);
      return plano;
    };
    const r = await c.despachar();
    expect(chamadas).toBe(2);
    expect(r.data.plano).toMatchObject({ harness: "claude-cli", conta: { id: c.conta("Marlon 20x").id }, entrada: { sessaoCli: "sessao-claude-cli" } });
    expect(c.trocas()).toEqual([]);
  });

  it("pedido sem task: a conta do plano esgota antes do retorno — invalida o plano e espera", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await pedidoSemTask(c);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    c.deps.services.planos.emitir = async (_trx, turnoId, machineId) => {
      const plano = (await executar(c.deps, emitirPlanoTurno, { turnoId, machineId, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).data;
      await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA, T0 + 1), c.vm, c.conta("Marlon 20x").id);
      return plano;
    };
    const r = await c.despachar();
    expect(r.data.plano).toBeNull();
    expect(pendentes(c)).toMatchObject([{ origem: "retomada", acordarEm: T0 + 5 * HORA, harness: "claude-cli" }]);
  });

  it("bot fixo: conta sai da fila depois da emissão — recompõe na conta ainda elegível", async () => {
    const c = await cenario({ fixo: true, segundaClaude: true });
    const t = await pedidoSemTask(c);
    let chamadas = 0;
    c.deps.services.planos.emitir = async (_trx, turnoId, machineId) => {
      chamadas += 1;
      const plano = (await executar(c.deps, emitirPlanoTurno, { turnoId, machineId, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).data;
      if (chamadas === 1) await c.deps.repos.contasIa.definirTrocaAutomatica(c.conta("Pessoal").id, false);
      return plano;
    };
    const r = await c.despachar();
    expect(chamadas).toBe(2);
    expect(r.data.plano).toMatchObject({ harness: "claude-cli", conta: { id: c.conta("Marlon 20x").id } });
    expect(c.deps.services.revogados).toContain(t.id);
  });

  it("pedido original que cita uma marca do nod não escolhe IA pelo texto", async () => {
    const c = await cenario();
    const agente = (await c.deps.repos.agentes.buscar(c.bot.id))!;
    const t = (await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.bot.id, origem: "delegacao", prazoEm: T0 + 86_400_000, profundidade: 1, entradaTexto: "[nod] A cota do Codex chegou ao limite: citação do pedido", entradaConfianca: "nao_confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: null }))!;
    const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: t.id, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(plano.data.harness).toBe("claude-cli");
  });

  it("pedido de colega sem task: espera, volta, troca de conta e bate de novo — UMA linha de espera por cadeia", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await pedidoSemTask(c);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 30 * MIN), c.vm, c.conta("Marlon 20x").id);
    await c.bateNoLimite(t.id, c.conta("Pessoal").id, T0 + HORA);
    const esperou = pendentes(c)[0]!;
    expect(esperou.acordarEm).toBe(T0 + 30 * MIN);
    expect(linhasDeEspera(c)).toHaveLength(1);
    c.relogio.agora = T0 + 31 * MIN;
    // A Marlon 20x renovou (leitura nova dela, livre).
    await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.1, renovaEm: T0 + 4 * HORA }, semana: { utilizacao: 0.2, renovaEm: T0 + 90 * HORA }, medidoEm: T0 + 31 * MIN }, c.vm, c.conta("Marlon 20x").id);
    await c.bateNoLimite(esperou.id, c.conta("Pessoal").id, T0 + 66 * HORA);
    const seguiu = pendentes(c)[0]!;
    expect(seguiu.entradaTexto).toContain("seguiu com a conta Marlon 20x");
    await c.bateNoLimite(seguiu.id, c.conta("Marlon 20x").id, T0 + 5 * HORA);
    expect(pendentes(c)).toMatchObject([{ acordarEm: T0 + 5 * HORA }]);
    expect(linhasDeEspera(c)).toHaveLength(1);
  });

  it("a conta 2 segurada só pela leitura por conta: o limite da conta 1 na rodada não diz 'seguindo no Marlon 20x'", async () => {
    const c = await cenario({ segundaClaude: true });
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA), c.vm, c.conta("Marlon 20x").id);
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 66 * HORA);
    const linhas = c.banco.mensagens.filter((m) => m.kind === "sistema").map((m) => m.texto);
    expect(linhas.some((x) => /seguindo no .*Marlon 20x/.test(x))).toBe(false);
    expect(c.voltaDe(t.turnoId)?.entradaTexto ?? "").not.toContain("seguiu com a conta Marlon 20x");
  });

  it("o bot com o ChatGPT primeiro na ordem dele: a task com sessão no Claude segue na conta livre do Claude (R4 antes da ordem)", async () => {
    const c = await cenario({ segundaClaude: true });
    await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { ordem: ["codex-cli", "claude-cli"] } });
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 66 * HORA), c.vm, c.conta("Pessoal").id);
    const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: t.turnoId, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(plano.data.harness).toBe("claude-cli");
    expect(plano.data.conta?.apelido).toBe("Marlon 20x");
  });

  it("a outra IA cuja única conta na máquina a leitura dela segura não é oferecida para levar", async () => {
    const c = await cenario({ segundaClaude: true });
    await c.task();
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 66 * HORA), c.vm, c.conta("Pessoal").id);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA, T0 + 1), c.vm, c.conta("Marlon 20x").id);
    await c.deps.repos.usoDoPlano.gravar({ ...esgotada(T0 + 66 * HORA, T0 + 2), harness: "codex-cli" }, c.vm, c.conta("Pessoal", "codex-cli").id);
    await c.despachar();
    expect(c.trocas().filter((x) => x.iaPara === "codex-cli")).toEqual([]);
    expect(c.trocas().filter((x) => x.recomendacao === "levar")).toEqual([]);
  });

  it("o varredor não fecha o aviso por leitura de outra conta; fecha quando uma conta da fila na máquina volta", async () => {
    const c = await cenario({ segundaClaude: true });
    await c.task();
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 66 * HORA), c.vm, c.conta("Pessoal").id);
    await c.deps.repos.usoDoPlano.gravar(esgotada(T0 + 5 * HORA, T0 + 1), c.vm, c.conta("Marlon 20x").id);
    await c.despachar();
    expect(c.trocas()).toMatchObject([{ decididoEm: null }]);
    // Um turno do Claude no Mac (conta "Mac", fora da vm-bots) grava uma leitura livre por cima da linha por IA.
    c.relogio.agora = T0 + MIN;
    const livre = { harness: "claude-cli" as const, situacao: "normal" as const, cincoHoras: { utilizacao: 0.1, renovaEm: T0 + 4 * HORA }, semana: { utilizacao: 0.2, renovaEm: T0 + 90 * HORA }, medidoEm: T0 + MIN };
    await c.deps.repos.usoDoPlano.gravar(livre, c.mac, c.conta("Mac").id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 0 });
    // E uma leitura nova "esgotado" de uma conta de outra máquina não muda nada (sem oscilação).
    await c.deps.repos.usoDoPlano.gravar({ ...esgotada(T0 + 66 * HORA, T0 + 2 * MIN) }, c.mac, c.conta("Mac").id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 0 });
    // A Marlon 20x renova (leitura nova da conta dela): o Claude voltou para o bot.
    c.relogio.agora = T0 + 3 * MIN;
    await c.deps.repos.usoDoPlano.gravar({ ...livre, medidoEm: T0 + 3 * MIN }, c.vm, c.conta("Marlon 20x").id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 1 });
    expect(c.trocas()).toMatchObject([{ decisao: "voltou" }]);
  });
});

describe("C2: 'parou' e 'voltou' pela mesma regra, na máquina do bot", () => {
  it("uma conta do Claude livre só no Mac não fecha o aviso da vm-bots; e reabrir na janela não cria linha nova", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    expect(c.trocas()).toMatchObject([{ machineId: c.vm, decididoEm: null }]);
    // A "Mac" está na fila e livre, mas não está na vm-bots: o Claude NÃO voltou para o Eng 1.
    c.relogio.agora = T0 + MIN;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 0 });
    // A conta da vm-bots volta: fecha "voltou".
    await c.deps.repos.contasIa.limparLimite(c.conta("Pessoal").id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 1 });
    expect(c.avisos()).toHaveLength(1);
    // Acaba de novo logo depois: o aviso reabre (prazo novo), mas na MESMA linha da conversa.
    const b = await c.task();
    c.relogio.agora = T0 + 5 * MIN;
    await c.bateNoLimite(b.turnoId, c.conta("Pessoal").id, T0 + 3 * HORA);
    expect(c.trocas()).toHaveLength(2);
    expect(c.trocas()[1]).toMatchObject({ decididoEm: null, mensagemId: c.trocas()[0]!.mensagemId });
    expect(c.avisos()).toHaveLength(1);
    expect(c.payload()?.decisao).toBeUndefined();
    // A guarda do despacho, com a fila da vm-bots ainda no limite, só atualiza o mesmo aviso.
    const d = await c.task();
    void d;
    await c.despachar();
    expect(c.trocas().filter((t) => t.decididoEm === null)).toHaveLength(1);
    expect(c.avisos()).toHaveLength(1);
  });
});

describe("C3: a decisão 'esperar' vale para as tasks seguintes", () => {
  it("outra task que para não abre aviso nem prazo novo; quando o Claude volta, o varredor acorda as esperas", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar" });
    const b = await c.task();
    c.relogio.agora = T0 + MIN;
    await c.bateNoLimite(b.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.trocas()).toHaveLength(1);
    expect(c.trocas()[0]).toMatchObject({ decisao: "esperar", voltouEm: null });
    expect(c.avisos()).toHaveLength(1);
    expect(c.payload()).toMatchObject({ decisao: "esperar", tasks: 2 });
    // O varredor não leva nada: a pessoa escolheu esperar.
    c.relogio.agora = T0 + 20 * MIN;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ aplicadas: 0, voltaram: 0 });
    expect(c.voltaDe(b.turnoId)).toMatchObject({ harness: "auto", acordarEm: T0 + 16 * HORA });
    // O Claude volta antes do prazo: as esperas acordam já.
    await c.deps.repos.contasIa.limparLimite(c.conta("Pessoal").id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ voltaram: 1 });
    expect(c.voltaDe(a.turnoId)).toMatchObject({ acordarEm: null, harness: "auto" });
    expect(c.voltaDe(b.turnoId)).toMatchObject({ acordarEm: null, harness: "auto" });
    expect(c.trocas()[0]?.voltouEm).toBe(c.relogio.agora);
    // Depois da volta, o próximo limite abre aviso de novo.
    const d = await c.task();
    await c.bateNoLimite(d.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.trocas().filter((t) => t.decididoEm === null)).toHaveLength(1);
  });
});

describe("C5: 'levar' só para uma IA pronta na máquina do bot", () => {
  it("o ChatGPT só no Mac: a recomendação vira esperar, sem prazo, o cartão diz por quê, e 'levar' é recusado", async () => {
    const c = await cenario({ codexNaVm: false });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.trocas()).toMatchObject([{ iaPara: null, recomendacao: "esperar", aplicarEm: null }]);
    expect(c.payload()).toMatchObject({ iaPara: null, foraDaMaquina: { ia: "codex-cli", maquina: "vm-bots" } });
    expect(c.avisos()[0]?.texto).toMatch(/O ChatGPT não está em vm-bots, a máquina do Eng 1\./);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + 16 * HORA });
    await esperarErro(() => executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" }), "entrada_invalida");
    // O varredor nunca aplica sozinho.
    c.relogio.agora = T0 + HORA;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ aplicadas: 0 });
  });

  it("a task SEM sessão também espera (não 'segue no ChatGPT' que a máquina do bot não tem)", async () => {
    const c = await cenario({ codexNaVm: false });
    const t = await c.task({ sessao: null });
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + 16 * HORA });
    expect(c.voltaDe(t.turnoId)?.entradaTexto).not.toMatch(/passou este trabalho/);
    expect(c.trocas()).toEqual([]);
  });
});

describe("C6: levar as tasks para o Automático", () => {
  it("fixa cada turno na IA que o Automático escolheria agora na máquina do bot (fora a que parou)", async () => {
    const c = await cenario({ fixo: true });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    const r = await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "auto", levarTasks: true }, prontosPorMaquina: c.prontosPorMaquina });
    expect(r.data.tasksLevadas).toBe(1);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ harness: "codex-cli", modelo: "auto", acordarEm: null });
  });

  it("sem IA pronta na máquina do bot fora a que parou: não leva e avisa na conversa dele", async () => {
    const c = await cenario({ fixo: true, codexNaVm: false });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    const r = await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "auto", levarTasks: true }, prontosPorMaquina: c.prontosPorMaquina });
    expect(r.data).toMatchObject({ tasksLevadas: 0, semIaParaLevar: true });
    expect(c.voltaDe(t.turnoId)).toMatchObject({ harness: "claude-cli", acordarEm: T0 + 16 * HORA });
    expect(c.banco.mensagens.at(-1)?.texto).toMatch(/Nenhuma IA está pronta agora na máquina do Eng 1/);
  });
});

describe("I1: no ChatGPT, trocar de conta perde a sessão", () => {
  it("a task com sessão na conta que parou espera; o aviso recomenda e 'levar' segue noutra conta do ChatGPT", async () => {
    const c = await cenario({ segundaCodex: true });
    await c.deps.repos.contasIa.marcarLimite(c.conta("Pessoal").id, T0 + 5 * HORA);
    const t = await c.task({ sessao: "codex-cli" });
    await c.deps.repos.trabalhos.definirContaDaSessao(t.trabalhoId, c.conta("Pessoal", "codex-cli").id);
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal", "codex-cli").id, T0 + 16 * HORA, "codex-cli");
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + 16 * HORA });
    expect(c.trocas()).toMatchObject([{ iaDe: "codex-cli", iaPara: "codex-cli", contaDe: c.conta("Pessoal", "codex-cli").id, recomendacao: "levar" }]);
    expect(c.payload()).toMatchObject({ contaDe: { apelido: "Pessoal" } });
    expect(c.avisos()[0]?.texto).toMatch(/^A conta Pessoal do ChatGPT chegou ao limite/);
    // Com a outra conta do ChatGPT livre, o varredor NÃO fecha como "voltou" (a conta da sessão segue parada).
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 0 });
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" });
    const volta = c.voltaDe(t.turnoId)!;
    expect(volta).toMatchObject({ harness: "codex-cli", acordarEm: null });
    expect(volta.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(true);
    expect(volta.entradaTexto).toMatch(/outra conta do ChatGPT/);
  });

  it("no Claude a sessão é compartilhada: a task segue na hora na outra conta, sem aviso", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.definirTrocaAutomatica(c.conta("Lumen").id, true);
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 });
    expect(c.trocas()).toEqual([]);
  });
});

describe("I2: um aviso por bot E por IA", () => {
  it("o limite das duas IAs no mesmo bot não se mistura; com dois abertos, a decisão diz qual (trocaId)", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    // O ChatGPT também parou para outra task do mesmo bot (o aviso dele nasce pela mesma porta).
    await avisarTrocaDeIa(c.deps, { agenteId: c.bot.id, conversaId: c.conversaId, turnoId: null, iaDe: "codex-cli", iaPara: "claude-cli", voltaEm: T0 + 2 * HORA, fixo: false, machineId: c.vm, autoria: { ...PESSOA }, agora: T0 });
    expect(c.trocas().map((t) => [t.iaDe, t.decididoEm])).toEqual([["claude-cli", null], ["codex-cli", null]]);
    expect(c.avisos()).toHaveLength(2);
    await esperarErro(() => executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar" }), "entrada_invalida");
    const r = await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar", trocaId: c.trocas()[1]!.id });
    expect(r.data).toMatchObject({ aplicada: true });
    expect(c.trocas().map((t) => t.decisao)).toEqual([null, "esperar"]);
  });
});

describe("I3: a volta do bot fixo", () => {
  it("sem mudança da pessoa: volta ao fixo e as tasks voltam ao Claude", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "outra_ia" });
    c.relogio.agora = T0 + 2 * HORA;
    expect((await varrerTrocasDeIa(c.deps)).restaurados).toBe(1);
    expect((await c.deps.repos.agentes.buscar(c.bot.id))?.inteligencia).toMatchObject({ modo: "fixa", fixa: "claude-cli" });
    expect(c.voltaDe(task.turnoId)).toMatchObject({ harness: "claude-cli" });
  });

  it("a pessoa trocou a ordem do bot depois: a inteligência dela vale e nada volta", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "outra_ia" });
    await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { ordem: ["codex-cli", "claude-cli"] } });
    c.relogio.agora = T0 + 2 * HORA;
    expect((await varrerTrocasDeIa(c.deps)).restaurados).toBe(0);
    expect((await c.deps.repos.agentes.buscar(c.bot.id))?.inteligencia).toMatchObject({ modo: "auto", ordem: ["codex-cli", "claude-cli"] });
    expect(c.voltaDe(task.turnoId)).toMatchObject({ harness: "codex-cli" });
  });
});

// Regression: re-QA do PR #329 (merge 62d2c747) — o "Continuar na conta" do aviso só de tasks acordava as tasks e a tela
// ainda dizia "Essa fala não está parada no limite; nada foi repetido" (motivo turno_nao_interrompido do núcleo da NOD-284).
// Found by /qa on 2026-10-16
// Report: comentário de re-QA no PR #329
describe("re-QA PR #329: 'Continuar na conta' do aviso de tasks não volta com motivo", () => {
  it("aviso sem fala da conversa: acorda a task, fecha o aviso e não diz que nada aconteceu", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    const r = await executar(c.deps, seguirComConta, { contaId: c.conta("Lumen").id, conversaId: c.conversaId });
    expect(c.trocas()[0]).toMatchObject({ decisao: "conta" });
    expect(r.data).toEqual({ turnoId: null, motivo: null });
    // Sem aviso para fechar nem fala parada, o mesmo clique segue dizendo por que não refez.
    const outra = await executar(c.deps, seguirComConta, { contaId: c.conta("Lumen").id, conversaId: c.conversaId });
    expect(outra.data).toEqual({ turnoId: null, motivo: "turno_nao_interrompido" });
  });
});

describe("I4: a escolhida fora da fila não vira caminho silencioso", () => {
  it("'Continuar na conta Lumen' grava a escolhida; quando a fila da vm-bots volta, o varredor a solta", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    await executar(c.deps, seguirComConta, { contaId: c.conta("Lumen").id, conversaId: c.conversaId });
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({ "claude-cli": c.conta("Lumen").id });
    expect(c.trocas()[0]).toMatchObject({ decisao: "conta", voltouEm: null });
    c.relogio.agora = T0 + HORA;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ voltaram: 0 });
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({ "claude-cli": c.conta("Lumen").id });
    c.relogio.agora = T0 + 2 * HORA;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ voltaram: 1 });
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({});
  });
});

describe("I5: o varredor isola cada aviso", () => {
  it("um aviso que lança não impede os outros (e o que lança fica para o próximo tique)", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 20 * MIN);
    const outro = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Eng 2" });
    await c.deps.repos.agentes.definirMaquina([outro.data.agente.id], c.vm);
    const t2 = await c.deps.repos.trabalhos.criar({ agenteId: outro.data.agente.id, conversaId: outro.data.conversa.id, titulo: "B1", origem: "pessoa", rotinaId: null, forma: "frente" });
    await c.deps.repos.trabalhos.atualizarSessao(t2!.id, "s", "claude-cli", "local");
    const turno2 = await c.deps.repos.turnos.enfileirar({ conversaId: outro.data.conversa.id, agenteId: outro.data.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "faz", entradaConfianca: "confiavel", modelo: "auto", harness: "auto", executor: "local", trabalhoId: t2!.id });
    await c.bateNoLimite(turno2!.id, c.conta("Pessoal").id, T0 + 20 * MIN);
    expect(c.trocas()).toHaveLength(2);
    await c.deps.repos.contasIa.limparLimite(c.conta("Pessoal").id);
    const buscar = c.deps.repos.agentes.buscar.bind(c.deps.repos.agentes);
    c.deps.repos.agentes.buscar = async (id: string) => { if (id === c.bot.id) throw new Error("falha de teste"); return buscar(id); };
    const isolados: number[] = [];
    const r = await varrerTrocasDeIa(c.deps, { isolar: async (fn) => { isolados.push(1); return fn(); } });
    expect(isolados).toHaveLength(2);
    expect(r.fechadas).toBe(1);
    expect(c.trocas().map((t) => t.decisao)).toEqual([null, "voltou"]);
  });
});

describe("I6: sem a hora do fornecedor, a volta fica vazia", () => {
  it("o aviso grava volta nula, recomenda levar e diz que o Claude não disse quando volta; a task tenta de novo em 1 h", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, null);
    expect(c.trocas()).toMatchObject([{ voltaEm: null, recomendacao: "levar", aplicarEm: T0 + 10 * MIN }]);
    expect(c.payload()).toMatchObject({ voltaEm: null });
    expect(c.avisos()[0]?.texto).toMatch(/o Claude não disse quando volta/);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + HORA });
  });
});

describe("I8: o despacho lê as contas uma vez", () => {
  it("a guarda da sessão usa a mesma leitura da guarda das contas", async () => {
    const c = await cenario();
    await c.task();
    let leituras = 0;
    const listar = c.deps.repos.contasIa.listar.bind(c.deps.repos.contasIa);
    c.deps.repos.contasIa.listar = async () => { leituras++; return listar(); };
    await c.despachar();
    // Uma para as duas guardas, uma do plano e uma validação final contra corrida de cota.
    expect(leituras).toBeLessThanOrEqual(3);
  });
});
