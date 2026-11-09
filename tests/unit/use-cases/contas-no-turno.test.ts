import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { destinoDe } from "../../../src/domain/destino-no-chat.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../../src/domain/cota-da-ia.ts";
import { anunciarContasDaMaquina, rodarDestaVezComConta, seguirComConta, tentarDeNovoComConta } from "../../../src/use-cases/contas-ia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { parar } from "../../../src/use-cases/parar.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * ADR-102 (2026-10-13): o turno usa uma conta da lista da pessoa. No limite, quem para é a conta (não a IA): com outra
 * IA em uso na máquina o turno segue nela; sem outra conta na fila, a nota oferece as contas livres; sem conta
 * utilizável, o despacho nem gasta turno pago. O exemplo do Marlon: Claude · Pessoal, ChatGPT · Pessoal, Claude · Lumen.
 * ADR-108 (2026-10-16): a lista é a fila — a 1ª pessoal de cada IA nasce nela, a Lumen (2ª do Claude) nasce fora.
 */
const T0 = Date.now();
const HORA = 3_600_000;
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: T0 - HORA, apelidoSugerido: apelido });
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
const limite = (voltaEm: number): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "usage limit" });

async function cenario(o: { origem?: "conversa" | "rotina"; comTask?: boolean; pedido?: unknown } = {}) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Ze 1" });
  const chave = await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) });
  const vm = chave!.id;
  await deps.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Lumen")], T0);
  const [cPessoal, gPessoal, cLumen] = (await deps.repos.contasIa.listar()).contas;
  if (o.pedido) await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: o.pedido });
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const origem = await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "texto", texto: "revisa o #861", confianca: "confiavel" });
  const task = o.comTask ? await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "Revisar o #861", origem: "rotina", rotinaId: null, forma: "frente" }) : null;
  const t = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o.origem ?? "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "revisa o #861", mensagemOrigemId: origem!.id, entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: task?.id ?? null });
  const antes = banco.mensagens.length;
  const despachar = () => executar(deps, despacharTurno, { machineId: vm, executor: "local", inventario: { estado: "pronto", versao: "2.1.296", em: T0 }, harnessesProntos: ["claude-cli", "codex-cli"] });
  const reivindicar = () => deps.repos.turnos.reivindicar({ machineId: vm, agora: T0 });
  const entregar = (resultado: ResultadoTurno, harness: IdHarness) =>
    executar(deps, assentarTurno, { turnoId: t!.id, machineId: vm, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado, executor: "local", harness, prontosDaPessoa: ["claude-cli", "codex-cli"] });
  /** Mais um turno da MESMA fala (o que o laço de 15/10 enfileirava a cada volta), já sem espera. */
  const reenfileirar = async (reenvios = 1) => {
    const o = banco.turnos.find((x) => x.id === t!.id)!;
    return (await deps.repos.turnos.enfileirar({ conversaId: o.conversaId, agenteId: o.agenteId, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: o.entradaTexto, mensagemOrigemId: o.mensagemOrigemId, entradaConfianca: "confiavel", modelo: o.modelo, harness: o.harness, executor: "local", reenvios }))!;
  };
  return { deps, banco, vm, agenteId: bot.agente.id, reenfileirar, turnoId: t!.id, conversaId: bot.conversa.id, contas: { cPessoal: cPessoal!, gPessoal: gPessoal!, cLumen: cLumen! }, antes, despachar, reivindicar, entregar };
}

describe("a conta do turno no limite (ADR-102)", () => {
  it("com outra IA em uso na máquina: marca a CONTA (não a IA), segue no ChatGPT e refaz a fala com a linha pelo apelido", async () => {
    const c = await cenario();
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    expect((await c.deps.repos.contasIa.buscar(c.contas.cPessoal.id))?.noLimiteAte).toBe(T0 + 2 * HORA);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite ?? {}).toEqual({});
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload)).toEqual([{ kind: "conta_seguiu", de: { id: c.contas.cPessoal.id, apelido: "Pessoal", ia: "claude-cli" }, para: { id: c.contas.gPessoal.id, apelido: "Pessoal", ia: "codex-cli" }, voltaEm: T0 + 2 * HORA }]);
    expect(novas[0]?.texto).toMatch(/^Claude · Pessoal no limite na vm-bots até .+\. Seguindo com ChatGPT · Pessoal\.$/);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", entradaTexto: "revisa o #861", reenvios: 1 }]);
  });

  it("sem outra conta do Claude na fila e o ChatGPT também no limite: nota com as contas livres (fora da fila), nada refeito", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]?.texto).toMatch(/^Claude · Pessoal no limite na vm-bots até .+\. Seguir com Claude · Lumen\?$/);
    expect(novas[0]?.payload).toMatchObject({ kind: "limite_do_plano", harness: "claude-cli", contas: { de: { id: c.contas.cPessoal.id }, livres: [{ id: c.contas.cLumen.id, naMaquina: true }], maquina: { id: c.vm, nome: "vm-bots" } } });
    expect(c.banco.turnos).toHaveLength(1);
  });

  it("ADR-108 (R1/R7): com a Lumen na fila, segue nela sozinho, sem perguntar, antes de mudar de IA — linha leve", async () => {
    const c = await cenario();
    expect(c.contas.cLumen.entraNaTrocaAutomatica).toBe(false);
    await c.deps.repos.contasIa.definirTrocaAutomatica(c.contas.cLumen.id, true);
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    const linha = c.banco.mensagens.slice(c.antes)[0];
    expect(linha?.payload).toMatchObject({ kind: "conta_seguiu", para: { id: c.contas.cLumen.id } });
    expect(linha?.texto).toMatch(/^Pessoal acabou às .+ → seguindo no Claude · Lumen · mesmo modelo$/);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", reenvios: 1 }]);
  });

  it("ADR-108 (R1): o 'Trocar sozinho' antigo (contas_modo) não decide mais nada — a Lumen fora da fila não entra sozinha", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.definirModo("automatico");
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    expect(c.banco.mensagens.slice(c.antes)[0]?.payload).toMatchObject({ kind: "conta_seguiu", para: { id: c.contas.gPessoal.id } });
  });

  it("o turno que dá certo tira a conta do limite antes do prazo", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + HORA);
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar({ ...base, desfecho: "sucesso", texto: "feito" }, "claude-cli");
    expect((await c.deps.repos.contasIa.buscar(c.contas.cPessoal.id))?.noLimiteAte).toBeNull();
  });

  it("R6: a máquina não tinha mais a conta — o vínculo sai e a fala é refeita uma vez", async () => {
    const c = await cenario();
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar({ ...base, desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true }, "claude-cli");
    expect((await c.deps.repos.contasIa.listar()).vinculos.some((v) => v.contaId === c.contas.cPessoal.id)).toBe(false);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", reenvios: 1 }]);
  });

  it("R6: na segunda ausência (a fala já foi refeita uma vez) não refaz de novo", async () => {
    const c = await cenario();
    const t = c.banco.turnos.find((x) => x.id === c.turnoId)!;
    t.reenvios = 1;
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar({ ...base, desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true }, "claude-cli");
    expect(c.banco.turnos.filter((x) => x.estado === "pendente")).toEqual([]);
  });

  it("R6 numa task: não vira 'limite' (frase e IA erradas) nem retomada sem freio — fica o aviso de sempre", async () => {
    const c = await cenario({ origem: "rotina", comTask: true });
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.gPessoal.id);
    await c.entregar({ ...base, desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true }, "codex-cli");
    expect(c.banco.turnos.filter((x) => x.estado === "pendente")).toEqual([]);
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.texto).join(" ")).not.toMatch(/limite/i);
  });
});

describe("o despacho sem conta utilizável (ADR-102)", () => {
  it("conversa: nenhuma conta serve sem a pessoa decidir — o turno para com a nota, sem plano (nenhum turno pago)", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    // NOD-269: a recusa por conta no despacho tem motivo próprio.
    expect(c.banco.turnos.find((t) => t.id === c.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "sem_conta" });
    const nota = c.banco.mensagens.slice(c.antes)[0];
    expect(nota?.payload).toMatchObject({ kind: "limite_do_plano", contas: { de: { id: c.contas.cPessoal.id }, livres: [{ id: c.contas.cLumen.id, naMaquina: true }] } });
  });

  it("com conta utilizável, o despacho segue e o plano sai", async () => {
    const c = await cenario();
    const r = await c.despachar();
    expect(r.data.plano).not.toBeNull();
  });

  it("frente (task): espera a primeira conta renovar numa retomada que acorda na hora; o turno nunca volta a 'pendente'", async () => {
    const c = await cenario({ origem: "rotina", comTask: true });
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.find((t) => t.id === c.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "sem_conta" });
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", origem: "retomada", retomaTurnoId: c.turnoId, acordarEm: T0 + 2 * HORA }]);
  });

  it("NOD-269: frente aberta pela pessoa na conversa espera, não falha e não ganha a nota", async () => {
    const c = await cenario({ origem: "conversa", comTask: true });
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, T0 + 4 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.find((t) => t.id === c.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "sem_conta" });
    const volta = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(volta).toMatchObject([{ estado: "pendente", origem: "retomada", retomaTurnoId: c.turnoId, acordarEm: T0 + 2 * HORA }]);
    // A frente nunca rodou (sem sessão): a volta leva o pedido original da raiz.
    expect(volta[0]?.entradaTexto).toContain("Pedido original da frente:\nrevisa o #861");
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload?.kind)).not.toContain("limite_do_plano");
    expect(novas.filter((m) => m.kind === "sistema").map((m) => m.texto)).toEqual([expect.stringMatching(/^A cota do Claude Code chegou ao limite/)]);
    expect((await c.deps.repos.trabalhos.buscar(volta[0]!.trabalhoId!))?.estado).not.toBe("falhou");
  });

  it("NOD-274: fundo sem task (rotina, pedido) também espera a conta voltar, sem a nota", async () => {
    const c = await cenario({ origem: "rotina" });
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, T0 + 4 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toMatchObject([{ origem: "retomada", retomaTurnoId: c.turnoId, acordarEm: T0 + 2 * HORA }]);
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind)).not.toContain("limite_do_plano");
  });

  it("'Seguir com' grava a escolhida da IA e refaz a fala que parou no limite", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    await c.despachar();
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(r.data.turnoId).not.toBeNull();
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({ "claude-cli": c.contas.cLumen.id });
    expect(c.banco.mensagens.at(-1)).toMatchObject({ texto: "Seguindo com Claude · Lumen.", payload: { kind: "conta_escolhida", contaId: c.contas.cLumen.id } });
    // Revisão do PR #319: a cópia que esperava a conta (NOD-268) sai da fila — senão a nova a absorveria e o bot leria o
    // mesmo pedido duas vezes.
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toMatchObject([{ id: r.data.turnoId, acordarEm: null }]);
    // De novo não refaz: já há uma fala nova pendente.
    await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toHaveLength(1);
  });
});

describe("NOD-277: a espera da cota acaba quando a pessoa resolve", () => {
  const TRES_DIAS = 3 * 24 * HORA;
  const espera = async (c: Awaited<ReturnType<typeof cenario>>, harness: IdHarness, entrada = `${ENTRADA_DA_VOLTA_DA_COTA}Claude Code chegou ao limite.`) =>
    (await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.agenteId, origem: "retomada", prazoEm: T0 + 4 * 24 * HORA, profundidade: 0, entradaTexto: entrada, entradaConfianca: "confiavel", modelo: "auto", harness, executor: "local", acordarEm: T0 + TRES_DIAS }))!;
  const acordarEm = (c: Awaited<ReturnType<typeof cenario>>, id: string) => c.banco.turnos.find((t) => t.id === id)?.acordarEm ?? null;

  it("'Seguir com' acorda a espera de +3 dias da IA da conta; a de outra IA e a volta marcada pelo bot seguem", async () => {
    const c = await cenario();
    const doClaude = await espera(c, "claude-cli");
    const doCodex = await espera(c, "codex-cli", `${ENTRADA_DA_VOLTA_DA_COTA}Codex chegou ao limite.`);
    const marcada = await espera(c, "claude-cli", "volte às 15h");
    await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(acordarEm(c, doClaude.id)).toBeNull();
    expect(acordarEm(c, doCodex.id)).toBe(T0 + TRES_DIAS);
    expect(acordarEm(c, marcada.id)).toBe(T0 + TRES_DIAS);
  });

  // Regression: re-QA do PR #329 pós-main 8f95bf88 — o "Seguir com" da task parada pela cota (Trabalhos, NOD-277) não leva
  // turno; com o motivo da nota (NOD-284), a tela dizia "nada foi repetido" mesmo tendo acordado a task.
  it("'Seguir com' da task (sem turno nem nota) acorda a espera e volta sem motivo", async () => {
    const c = await cenario();
    const doClaude = await espera(c, "claude-cli");
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(acordarEm(c, doClaude.id)).toBeNull();
    expect(r.data).toEqual({ turnoId: null, motivo: null });
  });

  it("'Seguir com' da task numa conversa com a nota antiga já refeita: acorda a espera e volta sem motivo", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + HORA);
    await c.despachar();
    await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    const doClaude = await espera(c, "claude-cli");
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(acordarEm(c, doClaude.id)).toBeNull();
    expect(r.data).toEqual({ turnoId: null, motivo: null });
  });

  it("sem nota, sem tasks e sem espera: o motivo segue (a tela diz que nada foi repetido)", async () => {
    const c = await cenario();
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(r.data).toEqual({ turnoId: null, motivo: "turno_nao_interrompido" });
  });

  it("conta nova que nasce fora da fila (2ª da IA em diante, corporativa ou pessoal) não acorda a espera da IA dela", async () => {
    const c = await cenario();
    const doCodex = await espera(c, "codex-cli", `${ENTRADA_DA_VOLTA_DA_COTA}Codex chegou ao limite.`);
    const doClaude = await espera(c, "claude-cli");
    const ja = (await c.deps.repos.contasIa.listar()).contas.length;
    const atuais = [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Lumen")];
    await anunciarContasDaMaquina(c.deps, c.vm, [...atuais, { ...anuncio(9, "codex-cli", "Empresa"), corporativa: true }]);
    expect((await c.deps.repos.contasIa.listar()).contas.length).toBe(ja + 1);
    expect(acordarEm(c, doCodex.id)).toBe(T0 + TRES_DIAS);
    // NOD-308: a pessoal que nasce fora da fila (3ª do Codex) também não acorda nada sozinha; só a conta na fila acorda.
    await anunciarContasDaMaquina(c.deps, c.vm, [...atuais, { ...anuncio(9, "codex-cli", "Empresa"), corporativa: true }, anuncio(10, "codex-cli", "Nova")]);
    expect(acordarEm(c, doCodex.id)).toBe(T0 + TRES_DIAS);
    expect(acordarEm(c, doClaude.id)).toBe(T0 + TRES_DIAS);
  });

  it("NOD-308: a corporativa NA fila que fica pronta acorda a espera da IA dela, como uma pessoal", async () => {
    const c = await cenario();
    const doCodex = await espera(c, "codex-cli", `${ENTRADA_DA_VOLTA_DA_COTA}Codex chegou ao limite.`);
    const atuais = [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Lumen")];
    const empresa = { ...anuncio(9, "codex-cli", "Empresa"), corporativa: true, plano: "Business" };
    await anunciarContasDaMaquina(c.deps, c.vm, [...atuais, { ...empresa, estado: "sem_login" as const }]);
    const conta = (await c.deps.repos.contasIa.listar()).contas.find((x) => x.apelido === "Empresa")!;
    expect(conta).toMatchObject({ corporativa: true, entraNaTrocaAutomatica: false });
    expect(await c.deps.repos.contasIa.definirTrocaAutomatica(conta.id, true)).toBe(true);
    await anunciarContasDaMaquina(c.deps, c.vm, [...atuais, empresa]);
    expect(acordarEm(c, doCodex.id)).toBeNull();
  });
});

describe("NOD-287: conta do turno no limite, conta ausente e 'Seguir com' levam a marca da web", () => {
  for (const suja of [true, false]) {
    const marca = suja ? "contaminada ⇒ refeita contaminada" : "limpa ⇒ refeita limpa";
    it(`segue no ChatGPT, origem ${marca}`, async () => {
      const c = await cenario();
      await c.reivindicar();
      await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
      const [refeita] = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(refeita).toBeDefined();
      expect(await c.deps.repos.turnos.contaminado(refeita!.id)).toBe(suja);
    });

    it(`conta ausente (R6), origem ${marca}`, async () => {
      const c = await cenario();
      await c.reivindicar();
      await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      await c.entregar({ ...base, desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true }, "claude-cli");
      const [refeita] = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(refeita).toBeDefined();
      expect(await c.deps.repos.turnos.contaminado(refeita!.id)).toBe(suja);
    });

    it(`'Seguir com', origem ${marca}`, async () => {
      const c = await cenario();
      await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
      await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
      await c.despachar();
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
      expect(r.data.turnoId).not.toBeNull();
      expect(await c.deps.repos.turnos.contaminado(r.data.turnoId!)).toBe(suja);
    });
  }
});

/** 14:50 de Brasília (UTC−3, sem horário de verão) de hoje ou de amanhã — a hora da nota de 15/10. */
const AS_14_50 = (() => { const d = new Date(T0); d.setUTCHours(17, 50, 0, 0); return d.getTime() <= T0 ? d.getTime() + 24 * HORA : d.getTime(); })();
const ESPERA = /^O (Claude Code|Codex) está no limite da assinatura\. Sua mensagem espera e volta sozinha (às|em \d\d\/\d\d às) \d\d:\d\d\.$/;
const notas = (c: { banco: { mensagens: { payload?: { kind?: string } | null }[] }; antes: number }) => c.banco.mensagens.slice(c.antes).filter((m) => m.payload?.kind === "limite_do_plano");

describe("NOD-268: regressão de 15/10 (a conversa inundada de notas e reenvios)", () => {
  it("dez despachos da mesma fala sem conta utilizável: UMA nota; a fala espera a conta voltar (acordar_em = 14:50)", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, AS_14_50);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, AS_14_50 + HORA);
    await c.despachar();
    for (let i = 0; i < 9; i++) {
      await c.reenfileirar();
      await c.despachar();
    }
    expect(notas(c)).toHaveLength(1);
    expect(c.banco.mensagens.slice(c.antes)[0]?.texto).toContain("14:50");
    const adiado = c.banco.turnos.find((t) => t.estado === "pendente" && t.mensagemOrigemId === c.banco.turnos.find((x) => x.id === c.turnoId)!.mensagemOrigemId && t.acordarEm);
    expect(adiado?.acordarEm).toBe(AS_14_50);
  });

  it("'Seguir com' numa conta que não está na máquina do bot: nada refeito, 0 notas novas e UMA linha, mesmo com três cliques", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, AS_14_50);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, AS_14_50 + HORA);
    await c.despachar();
    const mac = (await c.deps.repos.maquinaTokens.criar({ nome: "Mac do Marlon", prefixo: "cc33", hash: randomBytes(32) }))!;
    await c.deps.repos.contasIa.doAnuncio(mac.id, [anuncio(1, "claude-cli", "Pessoal")], T0);
    await c.deps.repos.agentes.definirMaquina([c.agenteId], mac.id);
    const notasAntes = notas(c).length;
    for (let i = 0; i < 3; i++) expect((await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId })).data.turnoId).toBeNull();
    expect(notas(c)).toHaveLength(notasAntes);
    const linhas = c.banco.mensagens.slice(c.antes).filter((m) => m.texto.startsWith("A conta"));
    expect(linhas.map((m) => m.texto)).toEqual(["A conta Claude · Lumen não está em Mac do Marlon. Entre com ela lá ou escolha outra conta."]);
    expect(c.banco.turnos.filter((t) => t.reenvios > 0)).toHaveLength(1);
    // Revisão do PR #319: a conta recusada não vira a escolhida da IA.
    expect((await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"] ?? null).toBeNull();
  });

  it("revisão do PR #319: a fala que já esperou a conta e volta sem conta ganha a nota de novo (nunca some calada)", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, AS_14_50);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, AS_14_50 + HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, AS_14_50 + 2 * HORA);
    await c.despachar();
    const adiado = c.banco.turnos.find((t) => t.estado === "pendente" && t.acordarEm)!;
    adiado.acordarEm = T0 - 1;
    await c.despachar();
    expect(c.banco.turnos.find((t) => t.id === adiado.id)).toMatchObject({ estado: "interrompido" });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toEqual([]);
    expect(notas(c)).toHaveLength(2);
  });

  // Regression: ISSUE-001 — rotina sem task escrevia a mesma nota de contas a cada execução
  // Found by /qa on 2026-10-15 (QA do NOD-268, PR #319)
  it("QA do NOD-268: rotina sem task executada de novo não escreve nota de contas (NOD-274: espera, sem a nota)", async () => {
    const c = await cenario({ origem: "rotina" });
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, AS_14_50);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, AS_14_50 + HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, AS_14_50 + 2 * HORA);
    await c.despachar();
    // Integração da main no #340: com o NOD-274 a rotina sem task espera a conta voltar sem a nota — nenhuma nota, nem a primeira.
    expect(notas(c)).toHaveLength(0);
    // Cada execução da rotina é um turno novo, sem mensagem de origem (o teto por mensagem_origem_id não a pega).
    for (let i = 0; i < 4; i++) {
      await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.agenteId, origem: "rotina", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "revisa o #861", mensagemOrigemId: null, entradaConfianca: "confiavel", modelo: "auto", harness: "auto", executor: "local" });
      expect((await c.despachar()).data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    }
    expect(notas(c)).toHaveLength(0);
    // Cada execução espera numa retomada só dela — nenhuma volta para a fila sem hora.
    expect(c.banco.turnos.filter((t) => t.estado === "pendente").every((t) => t.origem === "retomada" && t.acordarEm !== null)).toBe(true);
  });

  it("'Seguir com' numa conta pronta na máquina do bot refaz como antes", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, AS_14_50);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, AS_14_50 + HORA);
    await c.despachar();
    await c.deps.repos.agentes.definirMaquina([c.agenteId], c.vm);
    expect((await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId })).data.turnoId).not.toBeNull();
  });

  it("no limite da conta com a troca já usada nesta fala: espera a conta voltar com UMA linha, sem 'Seguindo com'", async () => {
    const c = await cenario();
    c.banco.turnos.find((t) => t.id === c.turnoId)!.reenvios = 1;
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload ?? null)).toEqual([null]);
    expect(novas[0]?.texto).toMatch(ESPERA);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", reenvios: 2, acordarEm: T0 + 2 * HORA }]);
  });

  it("revisão do PR #319: e a que já esperou a hora não ganha 'Seguindo com' (nada segue): o aviso do limite com a hora", async () => {
    const c = await cenario();
    const t = c.banco.turnos.find((x) => x.id === c.turnoId)!;
    t.reenvios = 2;
    t.acordarEm = T0 - 1;
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]?.texto).not.toContain("Seguindo");
    expect(novas[0]?.payload).toMatchObject({ kind: "limite_do_plano", harness: "claude-cli", voltaEm: T0 + 2 * HORA });
    expect(c.banco.turnos).toHaveLength(1);
  });
});

describe("NOD-268: o despacho do Automático com todas as IAs da máquina no limite", () => {
  const despacharNoLimite = (c: Awaited<ReturnType<typeof cenario>>) =>
    executar(c.deps, despacharTurno, { machineId: c.vm, executor: "local", inventario: { estado: "pronto", versao: "2.1.296", em: T0 }, harnessesProntos: ["claude-cli", "codex-cli"], noLimite: ["claude-cli", "codex-cli"] });

  it("não roda a primeira IA: adia até a renovação mais próxima, com UMA linha", async () => {
    const c = await cenario();
    await c.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + 3 * HORA, desde: T0 });
    await c.deps.repos.preferencias.registrarLimite("codex-cli", { renovaEm: T0 + 2 * HORA, desde: T0 });
    const r = await despacharNoLimite(c);
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.find((t) => t.id === c.turnoId)).toMatchObject({ estado: "interrompido" });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toMatchObject([{ acordarEm: T0 + 2 * HORA, reenvios: 1 }]);
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]?.texto).toMatch(/^O Codex está no limite/);
  });

  it("com uma IA fora do limite, segue e o plano sai", async () => {
    const c = await cenario();
    await c.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + 3 * HORA, desde: T0 });
    const r = await executar(c.deps, despacharTurno, { machineId: c.vm, executor: "local", inventario: { estado: "pronto", versao: "2.1.296", em: T0 }, harnessesProntos: ["claude-cli", "codex-cli"], noLimite: ["claude-cli"] });
    expect(r.data.plano).not.toBeNull();
  });

  it("uma fala nova absorve a adiada (uma pendente só); Parar cancela a adiada", async () => {
    const c = await cenario();
    await c.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + 3 * HORA, desde: T0 });
    await c.deps.repos.preferencias.registrarLimite("codex-cli", { renovaEm: T0 + 2 * HORA, desde: T0 });
    await despacharNoLimite(c);
    const adiado = c.banco.turnos.find((t) => t.estado === "pendente")!;
    const fala = await c.deps.repos.mensagens.criar({ conversaId: c.conversaId, autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "texto", texto: "e o #862?", confianca: "confiavel" });
    await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "e o #862?", mensagemOrigemId: fala!.id, entradaConfianca: "confiavel", modelo: "auto", harness: "auto", executor: "local" });
    const r = await c.despachar();
    expect(r.data.plano).not.toBeNull();
    expect(c.banco.turnos.find((t) => t.id === adiado.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido" });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toEqual([]);

    const c2 = await cenario();
    await c2.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + 3 * HORA, desde: T0 });
    await c2.deps.repos.preferencias.registrarLimite("codex-cli", { renovaEm: T0 + 2 * HORA, desde: T0 });
    await despacharNoLimite(c2);
    await executar(c2.deps, parar, { conversaId: c2.conversaId });
    expect(c2.banco.turnos.filter((t) => t.estado === "pendente")).toEqual([]);
  });

  it("revisão do PR #319: a fala mandada a uma task adiada sincroniza a task (como as outras saídas do despacho)", async () => {
    const c = await cenario({ comTask: true });
    await c.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + 3 * HORA, desde: T0 });
    await c.deps.repos.preferencias.registrarLimite("codex-cli", { renovaEm: T0 + 2 * HORA, desde: T0 });
    expect(c.banco.trabalhos[0]?.estado).toBe("na_fila");
    await despacharNoLimite(c);
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toMatchObject([{ acordarEm: T0 + 2 * HORA }]);
    // Sem o sincronizarDoTurno a task ficava parada no estado de antes do despacho.
    expect(c.banco.trabalhos[0]?.estado).not.toBe("na_fila");
  });

  it("a fala que já esperou roda como antes (não adia duas vezes)", async () => {
    const c = await cenario();
    await c.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + 3 * HORA, desde: T0 });
    await c.deps.repos.preferencias.registrarLimite("codex-cli", { renovaEm: T0 + 2 * HORA, desde: T0 });
    c.banco.turnos.find((t) => t.id === c.turnoId)!.acordarEm = T0 - 1;
    const r = await despacharNoLimite(c);
    expect(r.data.plano).not.toBeNull();
  });
});

describe("NOD-268: o alarme reenvio_em_laco", () => {
  it("mais de 3 turnos da mesma fala em menos de 5 min: log de aviso (o despacho segue)", async () => {
    const saidas: string[] = [];
    const espioes = (["log", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { saidas.push(a.map(String).join(" ")); }));
    try {
      const c = await cenario();
      for (let i = 0; i < 3; i++) {
        const t = await c.reenfileirar(i + 1);
        await c.deps.repos.turnos.assentar(t.id, { estado: "interrompido", motivoInterrupcao: "absorvido" });
      }
      await c.reenfileirar(4);
      await c.deps.repos.turnos.assentar(c.turnoId, { estado: "interrompido", motivoInterrupcao: "absorvido" });
      const r = await c.despachar();
      expect(r.data.plano).not.toBeNull();
      expect(saidas.some((l) => l.includes("reenvio_em_laco"))).toBe(true);
    } finally {
      for (const e of espioes) e.mockRestore();
    }
  });

  it("revisão do PR #319: a consulta do alarme falhar não derruba o despacho já reivindicado", async () => {
    const c = await cenario();
    await c.reenfileirar(1);
    await c.deps.repos.turnos.assentar(c.turnoId, { estado: "interrompido", motivoInterrupcao: "absorvido" });
    const espiao = vi.spyOn(c.deps.repos.turnos, "listarDaConversa").mockRejectedValue(new Error("timeout"));
    try {
      expect((await c.despachar()).data.plano).not.toBeNull();
    } finally {
      espiao.mockRestore();
    }
  });

  it("três turnos não disparam", async () => {
    const saidas: string[] = [];
    const espioes = (["log", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { saidas.push(a.map(String).join(" ")); }));
    try {
      const c = await cenario();
      const t = await c.reenfileirar(1);
      await c.deps.repos.turnos.assentar(t.id, { estado: "interrompido", motivoInterrupcao: "absorvido" });
      await c.reenfileirar(2);
      await c.deps.repos.turnos.assentar(c.turnoId, { estado: "interrompido", motivoInterrupcao: "absorvido" });
      await c.despachar();
      expect(saidas.some((l) => l.includes("reenvio_em_laco"))).toBe(false);
    } finally {
      for (const e of espioes) e.mockRestore();
    }
  });
});


describe("NOD-284/NOD-280: os passos da nota refazem a fala certa ou dizem por que não", () => {
  /** A nota no limite: Claude · Pessoal e o ChatGPT no limite, Claude · Lumen livre na vm-bots. */
  async function naNota() {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, AS_14_50);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, AS_14_50 + HORA);
    await c.despachar();
    await c.deps.repos.agentes.definirMaquina([c.agenteId], c.vm);
    // Merge da main (#340, NOD-269): a recusa no despacho grava `sem_conta`; a nota e os passos dela valem igual.
    expect(c.banco.turnos.find((t) => t.id === c.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "sem_conta" });
    return c;
  }

  it("'Seguir com' pelo turno da nota refaz uma vez; o segundo clique diz que já foi refeita", async () => {
    const c = await naNota();
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(r.data).toMatchObject({ motivo: null });
    expect(r.data.turnoId).not.toBeNull();
    expect(c.banco.turnos.find((t) => t.id === r.data.turnoId)).toMatchObject({ estado: "pendente", entradaTexto: "revisa o #861", origem: "conversa" });
    const de2 = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(de2.data).toEqual({ turnoId: null, motivo: "ja_refeito" });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toHaveLength(1);
  });

  it("'Seguir com' numa conta também no limite não refaz nem grava a escolhida", async () => {
    const c = await naNota();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, AS_14_50);
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(r.data).toEqual({ turnoId: null, motivo: "conta_no_limite" });
    expect((await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"] ?? null).toBeNull();
  });

  it("o turno de outra conversa não é refeito por esta nota", async () => {
    const c = await naNota();
    await expect(executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.agenteId, turnoId: c.turnoId })).rejects.toThrow();
  });

  it("'Rodar no X desta vez': máquina sem contato não refaz; com contato, a fala refeita vai àquela máquina", async () => {
    const c = await naNota();
    const sem = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.conversaId, turnoId: c.turnoId, maquinaId: c.vm });
    expect(sem.data).toEqual({ turnoId: null, motivo: "maquina_sem_contato" });
    c.banco.maquinaTokens.find((m) => m.id === c.vm)!.ultimoUsoEm = T0;
    const criar = vi.spyOn(c.deps.repos.mensagens, "criar");
    const r = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.conversaId, turnoId: c.turnoId, maquinaId: c.vm });
    expect(r.data.motivo).toBeNull();
    expect(c.banco.maquinaDestaVez.get(r.data.turnoId!)).toBe(c.vm);
    expect(c.banco.mensagens.at(-1)?.texto).toBe("Rodando em vm-bots desta vez.");
    // A nota de limite segue na Atividade (o atalho dela não depende desta linha).
    expect(criar.mock.calls.at(-1)?.[0].assunto).toBe("conta.nota");
  });

  it("NOD-314: o turno preso 24 h a um Mac sem contato é refeito uma vez noutra máquina; a queda que rodou não", async () => {
    const c = await cenario();
    await c.deps.repos.turnos.assentar(c.turnoId, { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    c.banco.maquinaTokens.find((m) => m.id === c.vm)!.ultimoUsoEm = T0;
    const criar = vi.spyOn(c.deps.repos.mensagens, "criar");
    const r = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.conversaId, turnoId: c.turnoId, maquinaId: c.vm });
    expect(r.data.motivo).toBeNull();
    // QA do NOD-314 (achado 1): a linha do refazer vai para o CHAT (vem em GET /conversas/:id/mensagens), do mesmo turno —
    // é ela que tira o atalho da linha do preso, também depois de recarregar.
    const linha = criar.mock.calls.at(-1)?.[0];
    expect(linha).toMatchObject({ turnoId: c.turnoId, kind: "sistema", texto: "Rodando em vm-bots desta vez." });
    expect(destinoDe(linha?.assunto ?? null)).toBe("chat");
    expect(c.banco.maquinaDestaVez.get(r.data.turnoId!)).toBe(c.vm);
    const de2 = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.conversaId, turnoId: c.turnoId, maquinaId: c.vm });
    expect(de2.data).toEqual({ turnoId: null, motivo: "ja_refeito" });

    // A queda de um turno que rodou (despachado, attempted) volta pelo pedido parado, não por este botão.
    const caiu = c.banco.turnos.find((t) => t.id === r.data.turnoId)!;
    await c.deps.repos.turnos.assentar(caiu.id, { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    caiu.sinais = { ...caiu.sinais, attempted: true };
    const queda = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.conversaId, turnoId: caiu.id, maquinaId: c.vm });
    expect(queda.data).toEqual({ turnoId: null, motivo: "turno_nao_interrompido" });
  });

  it("'Tentar de novo' com o turno limpa o limite da conta e refaz a fala", async () => {
    const c = await naNota();
    const r = await executar(c.deps, tentarDeNovoComConta, { contaId: c.contas.cPessoal.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(r.data.motivo).toBeNull();
    expect(r.data.turnoId).not.toBeNull();
    expect((await c.deps.repos.contasIa.buscar(c.contas.cPessoal.id))?.noLimiteAte).toBeNull();
  });

  it("'Tentar de novo' sem turno (Provedores de IA) limpa o limite e acorda a fala que esperava a conta", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, AS_14_50);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, AS_14_50 + HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, AS_14_50 + 2 * HORA);
    await c.despachar();
    const adiado = c.banco.turnos.find((t) => t.estado === "pendente" && t.acordarEm)!;
    expect(adiado.acordarEm).toBeGreaterThan(T0);
    const r = await executar(c.deps, tentarDeNovoComConta, { contaId: c.contas.cPessoal.id });
    expect(r.data.acordados).toBe(1);
    expect(c.banco.turnos.find((t) => t.id === adiado.id)?.acordarEm).toBeLessThanOrEqual(T0);
    expect((await c.deps.repos.contasIa.buscar(c.contas.cPessoal.id))?.noLimiteAte).toBeNull();
  });
});

/**
 * NOD-253/NOD-283 (2026-10-15): quem para é a CONTA. O bot preso a uma IA nunca recebe a oferta da outra IA (NOD-224), e
 * a conta que voltou "sem acesso" (a organização desligou o Claude da Team) sai desta máquina sem reprovar a IA inteira.
 */
const semAcesso: ResultadoTurno = { ...base, desfecho: "falha", motivoFalha: "nao_autenticado", causaSemIa: "conta_sem_acesso" };
const estadoNaVm = async (c: Awaited<ReturnType<typeof cenario>>, contaId: string) => (await c.deps.repos.contasIa.listar()).vinculos.find((v) => v.contaId === contaId && v.maquinaId === c.vm)?.estado;

describe("a conta do turno sem acesso (NOD-283)", () => {
  it("Claude · Lumen sem acesso: o vínculo vira sem_acesso, a IA não é reprovada e a fala é refeita uma vez", async () => {
    const c = await cenario();
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cLumen.id);
    const r = await c.entregar(semAcesso, "claude-cli");
    expect(await estadoNaVm(c, c.contas.cLumen.id)).toBe("sem_acesso");
    expect(await estadoNaVm(c, c.contas.cPessoal.id)).toBe("pronta");
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.kind)).not.toContain("negacao");
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", origem: "conversa", reenvios: 1 }]);
    expect(r.events.map((e) => e.kind)).toContain("turno_interrompido");
  });

  it("bot preso ao ChatGPT e a única conta dele sem acesso: o aviso de sempre com a causa, nada refeito", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "codex-cli" } });
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.gPessoal.id);
    await c.entregar(semAcesso, "codex-cli");
    expect(await estadoNaVm(c, c.contas.gPessoal.id)).toBe("sem_acesso");
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.kind)).toEqual(["negacao"]);
    expect(novas[0]?.payload).toMatchObject({ causa: "conta_sem_acesso" });
    expect(c.banco.turnos).toHaveLength(1);
  });

  it("o anúncio 'pronta' com o mesmo login não solta a conta; um login mais novo solta", async () => {
    const c = await cenario();
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cLumen.id);
    await c.entregar(semAcesso, "claude-cli");
    const todas = [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Lumen")];
    await c.deps.repos.contasIa.doAnuncio(c.vm, todas, T0 + HORA);
    expect(await estadoNaVm(c, c.contas.cLumen.id)).toBe("sem_acesso");
    await c.deps.repos.contasIa.doAnuncio(c.vm, todas.map((a) => (a.impressao === imp(3) ? { ...a, logadaEm: T0 + HORA } : a)), T0 + 2 * HORA);
    expect(await estadoNaVm(c, c.contas.cLumen.id)).toBe("pronta");
  });
});

describe("bot preso a uma IA com a conta dela no limite (NOD-253)", () => {
  it("preso ao ChatGPT: nunca segue no Claude — sem outra conta do ChatGPT, nada refeito no Claude", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "codex-cli" } });
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.gPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "codex-cli");
    expect((await c.deps.repos.contasIa.buscar(c.contas.gPessoal.id))?.noLimiteAte).toBe(T0 + 2 * HORA);
    const outros = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(outros.every((t) => t.harness === "codex-cli")).toBe(true);
    for (const m of c.banco.mensagens.slice(c.antes)) expect(m.texto).not.toMatch(/Claude/);
  });
});
