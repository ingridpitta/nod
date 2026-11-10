import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { JANELA_LONGA, JANELA_PADRAO, janelaDoModelo, LEITURA_PADRAO_TOKENS, limiarDeCompactacao, orcamentoDoTurno, parteFixa, precisaEnxugar, SAIDA_BASH_PADRAO_CHARS } from "../../../src/domain/orcamento-contexto.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { LINHA_CATALOGO_ENXUTO } from "../../../src/domain/prompt-sistema.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../../../src/shared/constantes.ts";

/** NOD-480 (emenda da ADR-040): o orçamento de contexto pela janela do modelo. */
describe("janelaDoModelo", () => {
  it("a janela observada no Raio-X ganha da tabela", () => {
    expect(janelaDoModelo("opus", 200_000)).toBe(200_000);
    expect(janelaDoModelo("haiku", 1_000_000)).toBe(1_000_000);
  });
  it("observada inválida cai na tabela", () => {
    for (const o of [null, undefined, 0, -1, Number.NaN, 5_000]) expect(janelaDoModelo("haiku", o)).toBe(JANELA_PADRAO);
  });
  it("pelo nome: [1m], Opus, Fable e o auto do Claude = 1M; o resto = 200k", () => {
    expect(janelaDoModelo("sonnet[1m]")).toBe(JANELA_LONGA);
    expect(janelaDoModelo("claude-opus-4-6")).toBe(JANELA_LONGA);
    expect(janelaDoModelo("fable")).toBe(JANELA_LONGA);
    expect(janelaDoModelo("auto")).toBe(JANELA_LONGA);
    expect(janelaDoModelo("sonnet")).toBe(JANELA_PADRAO);
    expect(janelaDoModelo("claude-haiku-4-5-20251001")).toBe(JANELA_PADRAO);
    expect(janelaDoModelo("modelo-desconhecido")).toBe(JANELA_PADRAO);
  });
});

describe("limiarDeCompactacao", () => {
  it("o lado conservador da fórmula do 2.1.309 (#718)", () => {
    expect(limiarDeCompactacao(200_000)).toBe(144_000);
    expect(limiarDeCompactacao(1_000_000)).toBe(784_000);
    expect(limiarDeCompactacao(100_000)).toBe(64_000);
    expect(limiarDeCompactacao(0)).toBe(0);
  });
});

describe("orcamentoDoTurno", () => {
  const medida = { promptChars: 60_000, ferramentas: 50 };
  it("a parte fixa soma prompt, nomes das ferramentas, base do harness e o resumo que volta", () => {
    expect(parteFixa(medida)).toBe(Math.ceil(60_000 / 3.5) + 50 * 15 + 38_000 + 46_000);
  });
  it("janela de 200k: enxuga e os tetos caem para 4% do limiar", () => {
    expect(precisaEnxugar(200_000, medida)).toBe(true);
    const o = orcamentoDoTurno({ janela: 200_000, enxuto: true, medida });
    expect(o).toMatchObject({ janela: 200_000, limiar: 144_000, enxuto: true, resultadoChars: 20_160, saidaBashChars: 20_160, leituraTokens: 5_760 });
  });
  it("janela de 1M: não enxuga e fica tudo no padrão de hoje (sem teto de Bash nem de Read)", () => {
    expect(precisaEnxugar(1_000_000, medida)).toBe(false);
    const o = orcamentoDoTurno({ janela: 1_000_000, enxuto: false, medida });
    expect(o.resultadoChars).toBe(ORCAMENTO_RESULTADO_CHARS);
    expect(o.saidaBashChars).toBeUndefined();
    expect(o.leituraTokens).toBeUndefined();
  });
  it("qualquer janela: o teto é proporcional, com piso (janela de 100k)", () => {
    const o = orcamentoDoTurno({ janela: 100_000, enxuto: true, medida });
    expect(o.resultadoChars).toBe(8_960);
    expect(o.saidaBashChars).toBe(8_960);
    expect(o.leituraTokens).toBe(2_560);
    const minima = orcamentoDoTurno({ janela: 30_000, enxuto: true, medida });
    expect(minima.resultadoChars).toBe(8_000);
    expect(minima.saidaBashChars).toBe(4_000);
    expect(minima.leituraTokens).toBe(2_000);
    expect(orcamentoDoTurno({ janela: 250_000, enxuto: false, medida }).saidaBashChars).toBeLessThan(SAIDA_BASH_PADRAO_CHARS);
    expect(orcamentoDoTurno({ janela: 900_000, enxuto: false, medida }).leituraTokens).toBeUndefined();
    expect(LEITURA_PADRAO_TOKENS).toBe(25_000);
  });
});

describe("montarPlano com o orçamento da janela", () => {
  const agora = 1_000_000;
  const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Atlas", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "sonnet", duplicadoDe: null, criadoEm: 0 };
  const turno: Turno = { executor: "local", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "sonnet", criadoEm: agora, mensagemOrigemId: "m0" };
  // Um app com 120 capacidades, nenhuma concedida: o "outras_do_app" que enche o prompt do Atlas.
  const conector: Conector = { tenantId: "t", id: "k1", ownerId: "p", visibility: "privado", nome: "Slack", slug: "slack", transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true,
    catalogo: Array.from({ length: 120 }, (_, i) => ({ nome: `SLACK_ACAO_${i}`, descricao: "x", schema: { type: "object" }, readOnlyHint: true })), sondadoEm: agora, ultimaFalha: null, criadoEm: 0 };
  const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [conector], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.309", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", harness: "claude-cli", agora };

  it("Sonnet de 200k: catálogo enxuto, teto do proxy proporcional e o orçamento no plano", () => {
    const p = montarPlano(base);
    expect(p.promptSistema).toContain(LINHA_CATALOGO_ENXUTO);
    expect(p.promptSistema).toContain('"outras_do_app":120');
    expect(p.promptSistema).not.toContain("SLACK_ACAO_7");
    expect(p.politicaExecucao.orcamentoResultadoChars).toBe(20_160);
    expect(p.orcamento).toMatchObject({ janela: 200_000, limiar: 144_000, enxuto: true, saidaBashChars: 20_160, leituraTokens: 5_760 });
  });

  it("Opus de 1M: nada muda no prompt nem no teto (só o orçamento informativo)", () => {
    const p = montarPlano({ ...base, turno: { ...turno, modelo: "opus" } });
    expect(p.promptSistema).not.toContain(LINHA_CATALOGO_ENXUTO);
    expect(p.promptSistema).toContain("SLACK_ACAO_7");
    expect(p.politicaExecucao.orcamentoResultadoChars).toBe(ORCAMENTO_RESULTADO_CHARS);
    expect(p.orcamento).toMatchObject({ janela: 1_000_000, enxuto: false });
    expect(p.orcamento?.saidaBashChars).toBeUndefined();
  });

  it("a janela observada vale: Opus sem contexto longo (200k) enxuga; Sonnet [1m] observado em 1M não", () => {
    expect(montarPlano({ ...base, turno: { ...turno, modelo: "opus" }, janelaObservada: 200_000 }).orcamento?.enxuto).toBe(true);
    expect(montarPlano({ ...base, janelaObservada: 1_000_000 }).orcamento?.enxuto).toBe(false);
  });

  it("o prompt é estável entre turnos do mesmo bot: a decisão mede só a parte estável", () => {
    const a = montarPlano({ ...base, contextoConversa: "x".repeat(10) });
    const b = montarPlano({ ...base, contextoConversa: "y".repeat(400_000) });
    expect(a.promptSistemaPartes?.estavel).toBe(b.promptSistemaPartes?.estavel);
  });

  it("Codex e ligação ficam como estão (sem orçamento)", () => {
    const codex = montarPlano({ ...base, harness: "codex-cli", turno: { ...turno, modelo: "gpt-5.6-sol" } });
    expect(codex.orcamento).toBeUndefined();
    expect(codex.promptSistema).toContain("SLACK_ACAO_7");
    expect(codex.politicaExecucao.orcamentoResultadoChars).toBe(ORCAMENTO_RESULTADO_CHARS);
  });
});
