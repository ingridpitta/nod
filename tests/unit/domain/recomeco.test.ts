import { describe, expect, it } from "vitest";
import { motivoDoRecomeco, type FatosDoRecomeco } from "../../../src/domain/recomeco.ts";

/** NOD-312: o motivo só descreve a regra de sessão (ADR-107); a ordem é IA > conta > máquina. */
const anterior = { harness: "codex-cli", contaId: "conta-1", machineId: "mac-a", executor: "local" };
const codexNaConta = (conta: string | null, maquina: string | null = "mac-a", ponte = true) => ({
  harness: "codex-cli",
  executor: "local",
  mesmaConta: (g: string | null) => g === conta,
  mesmaMaquina: (g: string | null) => !ponte || g === maquina,
});
const base = (extra: Partial<FatosDoRecomeco> = {}): FatosDoRecomeco => ({ elegivel: true, retomou: false, iaRetoma: true, anterior, atual: codexNaConta("conta-1"), ...extra });

describe("motivoDoRecomeco", () => {
  it("troca de IA vence conta e máquina", () => {
    expect(motivoDoRecomeco(base({ atual: { ...codexNaConta("conta-2", "mac-b"), harness: "claude-cli" } }))).toBe("troca_de_ia");
  });
  it("troca de conta (Codex) vence máquina", () => {
    expect(motivoDoRecomeco(base({ atual: codexNaConta("conta-2", "mac-b") }))).toBe("troca_de_conta");
  });
  it("troca de máquina só na ponte", () => {
    expect(motivoDoRecomeco(base({ atual: codexNaConta("conta-1", "mac-b") }))).toBe("troca_de_maquina");
    expect(motivoDoRecomeco(base({ atual: codexNaConta("conta-1", "mac-b", false) }))).toBeNull();
  });
  it("no Claude, a troca de conta não perde a sessão (mesmaConta sempre verdadeira): nada a avisar", () => {
    const claude = { harness: "claude-cli", executor: "local", mesmaConta: () => true, mesmaMaquina: () => true };
    expect(motivoDoRecomeco(base({ anterior: { ...anterior, harness: "claude-cli", contaId: "conta-1" }, atual: claude }))).toBeNull();
  });
  it("retomou, não elegível (rotina, colega, delegação, sala, ligação, task), IA sem resume ou sem sessão anterior: null", () => {
    const trocou = { atual: { ...codexNaConta("conta-1"), harness: "claude-cli" } };
    expect(motivoDoRecomeco(base({ ...trocou, retomou: true }))).toBeNull();
    expect(motivoDoRecomeco(base({ ...trocou, elegivel: false }))).toBeNull();
    expect(motivoDoRecomeco(base({ ...trocou, iaRetoma: false }))).toBeNull();
    expect(motivoDoRecomeco(base({ ...trocou, anterior: null }))).toBeNull();
  });
  it("IA que não retoma: só a troca PARA ela avisa, e uma vez (o último turno de conversa ainda era da outra IA)", () => {
    const paraClaudeSemResume = { iaRetoma: false, atual: { ...codexNaConta("conta-2", "mac-b"), harness: "claude-cli" } };
    expect(motivoDoRecomeco(base({ ...paraClaudeSemResume, anterior: { ...anterior, harnessDoUltimoTurno: "codex-cli" } }))).toBe("troca_de_ia");
    // O turno seguinte, já nela: o último turno de conversa é dela — nada a avisar.
    expect(motivoDoRecomeco(base({ ...paraClaudeSemResume, anterior: { ...anterior, harnessDoUltimoTurno: "claude-cli" } }))).toBeNull();
    // Sem saber a IA do último turno, não avisa (nada de aviso repetido).
    expect(motivoDoRecomeco(base({ ...paraClaudeSemResume, anterior: { ...anterior, harnessDoUltimoTurno: null } }))).toBeNull();
    // Na mesma IA, conta e máquina diferentes não contam: ela nunca retomaria nada.
    expect(motivoDoRecomeco(base({ iaRetoma: false, atual: codexNaConta("conta-2", "mac-b"), anterior: { ...anterior, harnessDoUltimoTurno: "codex-cli" } }))).toBeNull();
  });
  it("revisão 11: a troca de IA se decide pela IA do último turno, não pela da última sessão", () => {
    const claudeS1 = { ...anterior, harness: "claude-cli", harnessDoUltimoTurno: "codex-cli" };
    const claudeRetoma = { ...codexNaConta("conta-1"), harness: "claude-cli" };
    // Claude (S1) → Codex que não retoma → de volta ao Claude com a sessão largada pela troca manual: avisa.
    expect(motivoDoRecomeco(base({ anterior: claudeS1, atual: claudeRetoma }))).toBe("troca_de_ia");
    // Claude (S1) → Codex que não retoma (avisou) → Codex que retoma: a mesma mudança, não avisa de novo.
    expect(motivoDoRecomeco(base({ anterior: claudeS1, atual: codexNaConta("conta-2", "mac-b") }))).toBeNull();
    // Último turno e sessão da IA atual: conta e máquina seguem decidindo, como antes.
    expect(motivoDoRecomeco(base({ anterior: { ...anterior, harnessDoUltimoTurno: "codex-cli" }, atual: codexNaConta("conta-2") }))).toBe("troca_de_conta");
  });
  it("outro executor junto com outra IA: null (o executor vem antes)", () => {
    expect(motivoDoRecomeco(base({ atual: { ...codexNaConta("conta-1"), harness: "claude-cli", executor: "api" } }))).toBeNull();
    expect(motivoDoRecomeco(base({ iaRetoma: false, anterior: { ...anterior, harnessDoUltimoTurno: "codex-cli" }, atual: { ...codexNaConta("conta-1"), harness: "claude-cli", executor: "api" } }))).toBeNull();
  });
  it("outro executor, IA de antes da 0079 (sem harness gravado) ou mesma IA/conta/máquina: null", () => {
    expect(motivoDoRecomeco(base({ atual: { ...codexNaConta("conta-1"), executor: "api" } }))).toBeNull();
    expect(motivoDoRecomeco(base({ anterior: { ...anterior, harness: null }, atual: { ...codexNaConta("conta-1"), harness: "claude-cli" } }))).toBeNull();
    expect(motivoDoRecomeco(base())).toBeNull();
  });
});
