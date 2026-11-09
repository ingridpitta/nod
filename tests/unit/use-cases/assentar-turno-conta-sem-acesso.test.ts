import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { JANELA_REPETIR_BARRADOS_MS, repetirBarradosPorIa } from "../../../src/use-cases/repetir-barrados-por-ia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

// O repositório em memória carimba o turno com o relógio de verdade; T0 parte dele para a janela de meia hora valer.
const T0 = Date.now();
const RECUSA = "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access";
/** O que o driver entrega depois de `comContaSemAcesso`: falha com a causa e SEM texto (o laço manda a fala vazia). */
const semAcesso: ResultadoTurno = {
  desfecho: "falha", motivoFalha: "nao_autenticado", causaSemIa: "conta_sem_acesso", texto: "", sessaoCli: null, custoUsd: 0,
  sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
};

/**
 * definido em 2026-10-05 (medido em produção nesse dia): o turno voltou porque a CONTA da IA não serve. A conversa não
 * pode ganhar a recusa do fornecedor como fala do bot nem "Turno interrompido: erro_execucao".
 */
async function cenario(o: { harness?: "auto" | "claude-cli" | "codex-cli"; modelo?: string; origem?: "conversa" | "rotina"; pdf?: boolean } = {}) {
  let agora = T0;
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => agora });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Assistente pessoal" });
  const origem = await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "texto", texto: "oi", confianca: "confiavel" });
  const anexo = o.pdf ? await deps.repos.anexos.criar({ conversaId: bot.conversa.id, nome: "contrato.pdf", mime: "application/pdf", conteudo: new Uint8Array([37, 80, 68, 70]) }) : null;
  const t = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o.origem ?? "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "oi", mensagemOrigemId: origem!.id, entradaConfianca: "confiavel", modelo: o.modelo ?? "auto", harness: o.harness ?? "auto", ...(anexo ? { entradaAnexos: [anexo.id] } : {}) });
  const maquina = randomUUID();
  await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
  const antes = banco.mensagens.length;
  const entregar = (outraIa: "codex-cli" | null, fala = "") =>
    executar(deps, assentarTurno, { turnoId: t!.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: fala }, resultado: semAcesso, executor: "local", harness: "claude-cli", outraIa });
  return { deps, banco, bot, turnoId: t!.id, antes, entregar, passar: (ms: number) => { agora = T0 + ms; } };
}

describe("assentarTurno: a conta da IA não serve (causaSemIa)", () => {
  it("bot em automático com outra IA pronta: o pedido é repetido na fila e a conversa ganha UMA linha de troca, sem fala e sem 'Turno interrompido'", async () => {
    const c = await cenario();
    const r = await c.entregar("codex-cli", RECUSA);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" });
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.kind)).toEqual(["sistema"]);
    expect(novas[0]?.payload).toEqual({ kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "conta_sem_acesso" });
    expect(novas[0]?.texto).toBe("Respondendo pelo Codex: a conta do Claude Code neste computador está sem acesso.");
    // A recusa do fornecedor nunca vira mensagem, mesmo que um Mac antigo a mande como fala.
    expect(c.banco.mensagens.some((m) => m.texto.includes("disabled Claude subscription"))).toBe(false);

    const repetido = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(repetido).toMatchObject([{ estado: "pendente", origem: "conversa", entradaTexto: "oi", harness: "auto", modelo: "auto", reenvios: 1 }]);
    expect(repetido[0]?.mensagemOrigemId).toBe(c.banco.turnos.find((t) => t.id === c.turnoId)?.mensagemOrigemId);
    expect(r.events.map((e) => e.kind)).toEqual(["turno_interrompido", "mensagem_criada", "turno_criado"]);
  });

  it("nenhuma outra IA pronta: a negação 'nenhum trabalho começou' com a causa, e nada é repetido", async () => {
    const c = await cenario();
    const r = await c.entregar(null);
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.kind)).toEqual(["negacao"]);
    expect(novas[0]?.payload).toEqual({ kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true, causa: "conta_sem_acesso", ia: "claude-cli" });
    expect(c.banco.turnos).toHaveLength(1);
    expect(r.events.map((e) => e.kind)).toEqual(["turno_interrompido", "mensagem_criada"]);
  });

  it("IA escolhida à mão, modelo escolhido ou turno de rotina não trocam de IA sozinhos: negação, sem repetir", async () => {
    for (const o of [{ harness: "claude-cli" as const }, { modelo: "sonnet" }, { origem: "rotina" as const }]) {
      const c = await cenario(o);
      await c.entregar("codex-cli");
      expect(c.banco.mensagens.slice(c.antes).map((m) => m.kind), JSON.stringify(o)).toEqual(["negacao"]);
      expect(c.banco.turnos, JSON.stringify(o)).toHaveLength(1);
    }
  });
});

describe("repetirBarradosPorIa: uma IA ficou pronta", () => {
  it("repete a fala barrada mais recente da conversa uma vez; a segunda chamada não repete de novo", async () => {
    const c = await cenario();
    await c.entregar(null);
    c.passar(60_000);
    const r1 = await executar(c.deps, repetirBarradosPorIa, { executor: "local" });
    expect(r1.data).toEqual({ repetidos: 1 });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toMatchObject([{ entradaTexto: "oi", origem: "conversa", reenvios: 1 }]);
    c.passar(120_000);
    const r2 = await executar(c.deps, repetirBarradosPorIa, { executor: "local" });
    expect(r2.data).toEqual({ repetidos: 0 });
    expect(c.banco.turnos).toHaveLength(2);
  });

  it("NOD-171: fixada num harness que não está pronto ou com modelo inválido fica onde está (sem negação a cada anúncio)", async () => {
    const codex = await cenario({ harness: "codex-cli" });
    await codex.entregar(null);
    codex.passar(60_000);
    expect((await executar(codex.deps, repetirBarradosPorIa, { executor: "local", prontos: ["claude-cli"] })).data).toEqual({ repetidos: 0 });
    expect((await executar(codex.deps, repetirBarradosPorIa, { executor: "local", prontos: ["claude-cli", "codex-cli"] })).data).toEqual({ repetidos: 1 });

    const invalido = await cenario({ harness: "codex-cli", modelo: "sonnet" });
    await invalido.entregar(null);
    invalido.passar(60_000);
    expect((await executar(invalido.deps, repetirBarradosPorIa, { executor: "local", prontos: ["claude-cli", "codex-cli"] })).data).toEqual({ repetidos: 0 });

    const auto = await cenario();
    await auto.entregar(null);
    auto.passar(60_000);
    expect((await executar(auto.deps, repetirBarradosPorIa, { executor: "local", prontos: ["codex-cli"] })).data).toEqual({ repetidos: 1 });
  });

  it("NOD-285: fala com PDF fica onde está enquanto nenhuma IA pronta lê PDF (sem negação a cada anúncio)", async () => {
    const c = await cenario({ pdf: true });
    await c.entregar(null);
    c.passar(60_000);
    expect((await executar(c.deps, repetirBarradosPorIa, { executor: "local", prontos: ["codex-cli"] })).data).toEqual({ repetidos: 0 });
    c.passar(120_000);
    expect((await executar(c.deps, repetirBarradosPorIa, { executor: "local", prontos: ["codex-cli"] })).data).toEqual({ repetidos: 0 });
    expect(c.banco.turnos).toHaveLength(1);
    // Quando uma IA que lê PDF fica pronta, a fala volta uma vez.
    expect((await executar(c.deps, repetirBarradosPorIa, { executor: "local", prontos: ["codex-cli", "claude-cli"] })).data).toEqual({ repetidos: 1 });
  });

  it("fala barrada há mais de meia hora não é repetida", async () => {
    const c = await cenario();
    await c.entregar(null);
    c.passar(JANELA_REPETIR_BARRADOS_MS + 60_000);
    expect((await executar(c.deps, repetirBarradosPorIa, { executor: "local" })).data).toEqual({ repetidos: 0 });
  });
});

describe("NOD-287: conta sem acesso e barrados por IA levam a marca da web", () => {
  for (const suja of [true, false]) {
    it(`troca de IA na hora, origem ${suja ? "contaminada ⇒ repetida contaminada" : "limpa ⇒ repetida limpa"}`, async () => {
      const c = await cenario();
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      await c.entregar("codex-cli", RECUSA);
      const [repetido] = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(repetido).toBeDefined();
      expect(await c.deps.repos.turnos.contaminado(repetido!.id)).toBe(suja);
    });

    it(`repetirBarradosPorIa, origem ${suja ? "contaminada ⇒ repetida contaminada" : "limpa ⇒ repetida limpa"}`, async () => {
      const c = await cenario();
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      await c.entregar(null);
      c.passar(60_000);
      expect((await executar(c.deps, repetirBarradosPorIa, { executor: "local" })).data).toEqual({ repetidos: 1 });
      const [repetido] = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(await c.deps.repos.turnos.contaminado(repetido!.id)).toBe(suja);
    });
  }
});

describe("NOD-268: conta sem acesso no teto de reenvios", () => {
  it("a fala já reenviada uma vez não é repetida de novo: a negação com a causa", async () => {
    const c = await cenario();
    c.banco.turnos.find((t) => t.id === c.turnoId)!.reenvios = 1;
    await c.entregar("codex-cli", RECUSA);
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toEqual([]);
    expect(c.banco.mensagens.slice(c.antes).some((m) => m.payload?.kind === "ia_trocada")).toBe(false);
  });
});
