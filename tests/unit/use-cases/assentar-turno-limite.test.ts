import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { PRAZO_LIMITE_SEM_HORARIO_MS } from "../../../src/domain/inteligencia.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarTrabalho } from "../../../src/use-cases/trabalhos.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

const T0 = Date.now();
const DUAS_HORAS = 2 * 3_600_000;
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
/** O que o driver do Claude entrega com `rate_limit_event` `rejected` e o `result` com erro (stream-json.ts). */
const limiteDoClaude = (voltaEm: number | null): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "Claude AI usage limit reached" });
/** O Codex só diz em texto (erro-fornecedor.ts, classe limite_de_uso), sem horário. */
const limiteDoCodex: ResultadoTurno = { ...base, desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "You've hit your usage limit. Upgrade to Pro" };
const sucesso: ResultadoTurno = { ...base, desfecho: "sucesso", texto: "Pronto." };

/**
 * definido em 2026-10-10 (emenda da ADR-036; teste do Breno em 09/10): no limite da assinatura, o bot no Automático
 * repete o pedido na próxima IA da ordem e a conversa ganha a linha "chegou ao limite · respondendo pelo".
 */
async function cenario(o: { pedido?: unknown; origem?: "conversa" | "rotina"; task?: boolean } = {}) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Assistente pessoal" });
  if (o.pedido) await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: o.pedido });
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const origem = await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "texto", texto: "oi", confianca: "confiavel" });
  const trabalhoId = o.task ? (await criarTrabalho(deps, { agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "Revisar os PRs", origem: "pessoa" })).trabalho.id : null;
  const t = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o.origem ?? "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "oi", mensagemOrigemId: origem!.id, entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId });
  const maquina = randomUUID();
  await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
  const antes = banco.mensagens.length;
  const entregar = (resultado: ResultadoTurno, harness: IdHarness, prontosDaPessoa: IdHarness[] = ["claude-cli", "codex-cli"], prontosPorMaquina?: Record<string, IdHarness[]>) =>
    executar(deps, assentarTurno, { turnoId: t!.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado, executor: "local", harness, prontosDaPessoa, ...(prontosPorMaquina ? { prontosPorMaquina } : {}) });
  return { deps, banco, botId: bot.agente.id, maquina, turnoId: t!.id, trabalhoId, antes, entregar, turno: () => banco.turnos.find((x) => x.id === t!.id)! };
}

describe("assentarTurno: a IA chegou ao limite da assinatura", () => {
  it("Automático com outra IA pronta: grava o limite, repete na próxima da ordem e a conversa ganha a linha da troca", async () => {
    const c = await cenario();
    const r = await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
    expect(r.data.limiteMudou).toBe(true);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite).toEqual({ "claude-cli": { renovaEm: T0 + DUAS_HORAS, desde: T0 } });
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.kind)).toEqual(["sistema"]);
    expect(novas[0]?.payload).toEqual({ kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "limite", renovaEm: T0 + DUAS_HORAS });
    expect(novas[0]?.texto).toMatch(/^O Claude Code chegou ao limite da assinatura · respondendo pelo Codex\. Ele volta a ser usado (às|em \d\d\/\d\d às) \d\d:\d\d\.$/);
    const repetido = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(repetido).toMatchObject([{ estado: "pendente", origem: "conversa", entradaTexto: "oi", harness: "codex-cli", modelo: "auto", reenvios: 1 }]);
    expect(r.events.map((e) => e.kind)).toEqual(["turno_interrompido", "mensagem_criada", "turno_criado"]);
    expect(r.events[0]?.dados).toMatchObject({ motivo_falha: "limite_do_plano", ia_no_limite: "claude-cli", renova_em: T0 + DUAS_HORAS });
  });

  it("a ordem do bot decide para onde vai; o Codex no limite sem horário fica fora por 1 h", async () => {
    const c = await cenario({ pedido: { ordem: ["codex-cli", "claude-cli"] } });
    await c.entregar(limiteDoCodex, "codex-cli");
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite).toEqual({ "codex-cli": { renovaEm: T0 + PRAZO_LIMITE_SEM_HORARIO_MS, desde: T0 } });
    expect(c.banco.mensagens.slice(c.antes)[0]?.payload).toMatchObject({ kind: "ia_trocada", de: "codex-cli", para: "claude-cli", causa: "limite" });
  });

  it("sem outra IA pronta fora do limite: o aviso do limite de sempre (com a hora) e nada repetido; o limite fica gravado", async () => {
    for (const prontos of [["claude-cli"], ["claude-cli", "codex-cli"]] as IdHarness[][]) {
      const c = await cenario();
      if (prontos.length === 2) await c.deps.repos.preferencias.registrarLimite("codex-cli", { renovaEm: T0 + DUAS_HORAS, desde: T0 });
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", prontos);
      const novas = c.banco.mensagens.slice(c.antes);
      expect(novas.map((m) => m.payload?.kind), JSON.stringify(prontos)).toEqual(["limite_do_plano"]);
      expect(c.banco.turnos, JSON.stringify(prontos)).toHaveLength(1);
      expect((await c.deps.repos.preferencias.buscar()).iasNoLimite?.["claude-cli"]?.renovaEm).toBe(T0 + DUAS_HORAS);
    }
  });

  it("Uma IA só não troca de IA sozinha (o limite fica gravado para os outros bots)", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" } });
    await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind)).toEqual(["limite_do_plano"]);
    expect(c.banco.turnos).toHaveLength(1);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite?.["claude-cli"]).toBeDefined();
  });

  it("NOD-274: o turno de rotina no limite não troca de IA nem falha — espera a cota e volta sozinho", async () => {
    const c = await cenario({ origem: "rotina" });
    const r = await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
    expect(r.data.esperaDaCota).toBe("espera");
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", origem: "retomada", retomaTurnoId: c.turnoId, acordarEm: T0 + DUAS_HORAS }]);
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind ?? null)).toEqual([null]);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite?.["claude-cli"]).toBeDefined();
  });

  it("NOD-293 (C19): o teto de gasto do mês é da organização — não grava limite, não troca de IA e o aviso diz o teto", async () => {
    const c = await cenario();
    const teto: ResultadoTurno = { ...base, desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "success | You've hit your monthly spend limit" };
    const r = await c.entregar(teto, "claude-cli");
    expect(r.data.limiteMudou).toBeFalsy();
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite ?? {}).toEqual({});
    expect(c.banco.turnos).toHaveLength(1);
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload?.kind ?? null)).not.toContain("ia_trocada");
    expect(novas.at(-1)?.texto).toContain("teto de gasto do mês no Claude Code");
  });

  it("um turno que dá certo na IA a tira do limite antes do prazo", async () => {
    const c = await cenario();
    await c.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + DUAS_HORAS, desde: T0 });
    const r = await c.entregar(sucesso, "claude-cli");
    expect(r.data.limiteMudou).toBe(true);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite).toEqual({});
  });

  it("ADR-099 §7: a task que bate no limite não falha — espera a renovação e volta sozinha, na mesma task", async () => {
    for (const voltaEm of [T0 + DUAS_HORAS, null]) {
      const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" }, task: true });
      const r = await c.entregar(limiteDoClaude(voltaEm), "claude-cli", ["claude-cli"]);
      const renova = voltaEm ?? T0 + PRAZO_LIMITE_SEM_HORARIO_MS;
      const volta = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(volta, String(voltaEm)).toMatchObject([{ estado: "pendente", origem: "retomada", retomaTurnoId: c.turnoId, trabalhoId: c.trabalhoId, acordarEm: renova }]);
      const novas = c.banco.mensagens.slice(c.antes);
      expect(novas.map((m) => m.kind)).toEqual(["sistema"]);
      expect(novas[0]?.payload ?? null).toBeNull();
      expect(novas[0]?.texto).toMatch(/^A cota do Claude Code chegou ao limite\. Esta task espera e volta sozinha (às|em \d\d\/\d\d às) \d\d:\d\d, de onde parou\.$/);
      expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["turno_interrompido", "turno_criado", "mensagem_criada"]));
      // A task segue aberta (a volta está na fila), não "não terminou".
      expect((await c.deps.repos.trabalhos.buscar(c.trabalhoId!))?.estado).not.toBe("falhou");
      // A volta da cota não conta como "volta sem novidade" no alarme da parte 1.
      expect(await c.deps.repos.turnos.ultimasVoltas(c.turnoId, 3)).toMatchObject([{ porCota: true }]);
    }
  });

  it("NOD-279 D7 revisto pelo ADR-108: a volta da frente no Automático não é fixada na IA que bateu (sem sessão, segue já na outra)", async () => {
    const c = await cenario({ task: true });
    expect(c.turno()).toMatchObject({ harness: "auto", modelo: "auto" });
    await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli", "codex-cli"]);
    const volta = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(volta).toMatchObject([{ estado: "pendente", origem: "retomada", trabalhoId: c.trabalhoId, harness: "auto", modelo: "auto", acordarEm: T0 }]);
  });

  it("NOD-279 D7: a frente com IA fixa espera com a IA e o modelo que tinha", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli", escolhas: { "claude-cli": { modelo: "opus" } } }, task: true });
    await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli", "codex-cli"]);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ harness: "claude-cli", modelo: "opus" }]);
  });

  it("ADR-099 §7: a conversa com a pessoa no limite, sem outra IA, continua com o aviso de sempre (nada espera escondido)", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" } });
    await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli"]);
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind)).toEqual(["limite_do_plano"]);
    expect(c.banco.turnos).toHaveLength(1);
  });

  describe("NOD-268: o teto de reenvios e a IA da máquina do bot", () => {
    const ESPERA = /^O Claude Code está no limite da assinatura\. Sua mensagem espera e volta sozinha (às|em \d\d\/\d\d às) \d\d:\d\d\.$/;

    it("o reenvio sai FIXO na IA escolhida (não `auto`): outra máquina não o roda de novo na IA parada", async () => {
      const c = await cenario();
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
      const repetido = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(repetido).toHaveLength(1);
      expect(repetido[0]?.harness).toBe("codex-cli");
    });

    it("no teto (a fala já foi reenviada uma vez): não troca de novo — espera a hora do limite com UMA linha", async () => {
      const c = await cenario();
      c.turno().reenvios = 1;
      const r = await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
      const novas = c.banco.mensagens.slice(c.antes);
      expect(novas).toHaveLength(1);
      expect(novas[0]).toMatchObject({ kind: "sistema", payload: null });
      expect(novas[0]?.texto).toMatch(ESPERA);
      const adiado = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(adiado).toMatchObject([{ estado: "pendente", harness: "auto", reenvios: 2, acordarEm: T0 + DUAS_HORAS, mensagemOrigemId: c.turno().mensagemOrigemId }]);
      expect(r.events.map((e) => e.kind)).toEqual(["turno_interrompido", "turno_criado", "mensagem_criada"]);
    });

    it("a fala que já esperou a hora e bate de novo no limite não espera outra vez: o aviso de sempre, nada na fila", async () => {
      const c = await cenario();
      c.turno().reenvios = 2;
      c.turno().acordarEm = T0 - 1;
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
      expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind)).toEqual(["limite_do_plano"]);
      expect(c.banco.turnos).toHaveLength(1);
    });

    it("bot preso a uma máquina só com o Claude e o Codex pronto noutra: não troca; espera com a linha que nomeia a máquina", async () => {
      const c = await cenario();
      const alvo = await c.deps.repos.maquinaTokens.criar({ nome: "Mac só com o Claude", prefixo: "aa11", hash: randomBytes(32) });
      await c.deps.repos.agentes.definirMaquina([c.botId], alvo!.id);
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli", "codex-cli"], { [alvo!.id]: ["claude-cli"] });
      const novas = c.banco.mensagens.slice(c.antes);
      expect(novas.map((m) => m.texto)).toHaveLength(1);
      expect(novas[0]?.texto).toMatch(/^O Claude Code está no limite da assinatura\. O Codex está pronto noutra máquina, mas este bot roda em Mac só com o Claude\. Sua mensagem volta sozinha (às|em \d\d\/\d\d às) \d\d:\d\d\.$/);
      expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", harness: "auto", acordarEm: T0 + DUAS_HORAS }]);
    });

    it("bot preso a uma máquina que tem o Codex: troca para ele, como sempre", async () => {
      const c = await cenario();
      const alvo = await c.deps.repos.maquinaTokens.criar({ nome: "Mac com as duas", prefixo: "bb22", hash: randomBytes(32) });
      await c.deps.repos.preferencias.definirMaquinaPadrao(alvo!.id);
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli", "codex-cli"], { [alvo!.id]: ["claude-cli", "codex-cli"] });
      expect(c.banco.mensagens.slice(c.antes)[0]?.payload).toMatchObject({ kind: "ia_trocada", para: "codex-cli" });
    });

    it("revisão do PR #319: rodou noutra máquina 'desta vez' (com o Codex) — vale a do bot, que só tem o Claude: espera", async () => {
      const c = await cenario();
      const alvo = await c.deps.repos.maquinaTokens.criar({ nome: "Mac só com o Claude", prefixo: "dd44", hash: randomBytes(32) });
      await c.deps.repos.agentes.definirMaquina([c.botId], alvo!.id);
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli", "codex-cli"], { [c.maquina]: ["claude-cli", "codex-cli"], [alvo!.id]: ["claude-cli"] });
      expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind ?? null)).toEqual([null]);
      expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", harness: "auto", acordarEm: T0 + DUAS_HORAS }]);
    });

    it("revisão do PR #319: a máquina do bot foi revogada — vale o padrão da pessoa, e o Codex dele recebe a troca", async () => {
      const c = await cenario();
      const revogada = await c.deps.repos.maquinaTokens.criar({ nome: "Mac antigo", prefixo: "ee55", hash: randomBytes(32) });
      const padrao = await c.deps.repos.maquinaTokens.criar({ nome: "VM", prefixo: "ff66", hash: randomBytes(32) });
      await c.deps.repos.agentes.definirMaquina([c.botId], revogada!.id);
      await c.deps.repos.preferencias.definirMaquinaPadrao(padrao!.id);
      await c.deps.repos.maquinaTokens.revogar(revogada!.id, T0);
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli", "codex-cli"], { [padrao!.id]: ["claude-cli", "codex-cli"] });
      expect(c.banco.mensagens.slice(c.antes)[0]?.payload).toMatchObject({ kind: "ia_trocada", para: "codex-cli" });
      expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ harness: "codex-cli", acordarEm: null }]);
    });

    it("Parar pedido: nada espera nem repete", async () => {
      const c = await cenario();
      c.turno().reenvios = 1;
      c.turno().pararSolicitadoEm = T0;
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
      expect(c.banco.turnos).toHaveLength(1);
    });
  });
});

describe("NOD-287: a fala repetida no limite leva a marca da web", () => {
  for (const suja of [true, false]) {
    it(`conversa no Automático, origem ${suja ? "contaminada ⇒ repetida contaminada" : "limpa ⇒ repetida limpa"}`, async () => {
      const c = await cenario();
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
      const [repetido] = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(repetido).toBeDefined();
      expect(await c.deps.repos.turnos.contaminado(repetido!.id)).toBe(suja);
    });

    it(`task de fundo no limite, origem ${suja ? "contaminada ⇒ volta contaminada" : "limpa ⇒ volta limpa"}`, async () => {
      const c = await cenario({ task: true });
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", ["claude-cli"]);
      const [volta] = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(volta).toMatchObject({ origem: "retomada", trabalhoId: c.trabalhoId });
      expect(await c.deps.repos.turnos.contaminado(volta!.id)).toBe(suja);
    });
  }
});
