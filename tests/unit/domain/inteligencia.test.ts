import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HARNESSES, type IdHarness } from "../../../src/contracts/harness.ts";
import type { InteligenciaBot } from "../../../src/contracts/inteligencia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { modelosDaLista } from "../../../src/domain/codex-app-server.ts";
import { causaHarnessIndisponivel, resolverHarness } from "../../../src/domain/harness.ts";
import {
  aplicarPedidoInteligencia,
  esperaDoAutomatico,
  LACO_JANELA_MS,
  LACO_TURNOS,
  podeReenviar,
  reenvioEmLaco,
  TETO_REENVIOS,
  derivadosDa,
  iaDoAutomatico,
  iasDaPessoa,
  iasNoLimite,
  iasParaOAutomatico,
  INTELIGENCIA_PADRAO,
  inteligenciaDoAgente,
  inteligenciaDoLegado,
  inventarioComLimite,
  lerOrdemDaPessoa,
  ordemCompleta,
  ordemEfetiva,
  PRAZO_LIMITE_SEM_HORARIO_MS,
  prazoDoLimite,
  proximaIaNoLimite,
  raciociniosDoModelo,
  raciocinioValido,
} from "../../../src/domain/inteligencia.ts";

const AGORA = 1_791_000_000_000;
const pronto: Inventario = { estado: "pronto", versao: "1.0.0", em: AGORA };

describe("a ordem das IAs (emenda da ADR-036, 2026-10-10)", () => {
  it("a ordem inteira: só IAs integradas, sem repetição, e as que faltam no fim", () => {
    expect(ordemCompleta(null)).toEqual(["claude-cli", "codex-cli"]);
    expect(ordemCompleta(["codex-cli"])).toEqual(["codex-cli", "claude-cli"]);
    expect(ordemCompleta(["hermes", "codex-cli", "codex-cli", "x"])).toEqual(["codex-cli", "claude-cli"]);
  });
  it("vale a do bot, senão a da pessoa, senão a padrão (com o harness padrão do modo local na frente)", () => {
    expect(ordemEfetiva({ doBot: ["codex-cli"], daPessoa: ["claude-cli"] })).toEqual(["codex-cli", "claude-cli"]);
    expect(ordemEfetiva({ doBot: null, daPessoa: ["codex-cli", "claude-cli"] })).toEqual(["codex-cli", "claude-cli"]);
    expect(ordemEfetiva({})).toEqual(["claude-cli", "codex-cli"]);
    expect(ordemEfetiva({ preferido: "codex-cli" })).toEqual(["codex-cli", "claude-cli"]);
    // A ordem escolhida pela pessoa vence o harness padrão do interruptor.
    expect(ordemEfetiva({ daPessoa: ["claude-cli", "codex-cli"], preferido: "codex-cli" })).toEqual(["claude-cli", "codex-cli"]);
  });
  it("a ordem da pessoa vinda da tela: lista sem repetição de IAs integradas, ou null", () => {
    expect(lerOrdemDaPessoa(["codex-cli", "claude-cli"])).toEqual(["codex-cli", "claude-cli"]);
    expect(lerOrdemDaPessoa(null)).toBeNull();
    for (const ruim of [[], ["codex-cli", "codex-cli"], ["hermes"], ["claude"], "claude-cli", 3, Array(9).fill("claude-cli")]) expect(() => lerOrdemDaPessoa(ruim)).toThrow("entrada_invalida");
  });
});

describe("Automático: a primeira IA pronta da ordem que não esteja no limite", () => {
  it("pula a IA no limite; com todas as prontas no limite, a primeira pronta (o CLI diz se continua)", () => {
    const ordem: IdHarness[] = ["claude-cli", "codex-cli"];
    expect(iaDoAutomatico({ ordem, prontos: ["claude-cli", "codex-cli"] })).toBe("claude-cli");
    expect(iaDoAutomatico({ ordem, prontos: ["claude-cli", "codex-cli"], noLimite: ["claude-cli"] })).toBe("codex-cli");
    expect(iaDoAutomatico({ ordem, prontos: ["claude-cli"], noLimite: ["claude-cli"] })).toBe("claude-cli");
    expect(iaDoAutomatico({ ordem, prontos: [] })).toBeNull();
  });
  it("resolverHarness: a ordem do bot decide; o modelo e o raciocínio vêm da escolha da IA, senão o recomendado", () => {
    const prontos: IdHarness[] = ["claude-cli", "codex-cli"];
    expect(resolverHarness({ modelo: "auto", prontos, ordem: ["codex-cli", "claude-cli"] })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-sol", raciocinio: "medium" });
    expect(resolverHarness({ modelo: "auto", prontos, ordem: ["claude-cli", "codex-cli"], noLimite: ["claude-cli"], escolhas: { "codex-cli": { modelo: "gpt-5.6-luna", raciocinio: "high" } } }))
      .toEqual({ harness: "codex-cli", modelo: "gpt-5.6-luna", raciocinio: "high" });
    expect(resolverHarness({ modelo: "auto", prontos, ordem: ["claude-cli", "codex-cli"], escolhas: { "claude-cli": { raciocinio: "max" } } })).toEqual({ harness: "claude-cli", modelo: "opus", raciocinio: "max" });
  });
  it("prazo vencido: a IA volta a valer na ordem", () => {
    const limites = { "claude-cli": { renovaEm: AGORA - 1, desde: AGORA - 3_600_000 }, "codex-cli": { renovaEm: AGORA + 60_000, desde: AGORA } };
    expect(iasNoLimite(limites, AGORA)).toEqual(["codex-cli"]);
    expect(resolverHarness({ modelo: "auto", prontos: ["claude-cli", "codex-cli"], ordem: ["claude-cli", "codex-cli"], noLimite: iasNoLimite(limites, AGORA) }).harness).toBe("claude-cli");
    expect(resolverHarness({ modelo: "auto", prontos: ["claude-cli", "codex-cli"], ordem: ["codex-cli", "claude-cli"], noLimite: iasNoLimite(limites, AGORA) }).harness).toBe("claude-cli");
  });
  it("Uma IA só: a IA fixa, mesmo no limite; sem ela pronta, nunca outra (espera)", () => {
    expect(resolverHarness({ harness: "codex-cli", modelo: "auto", prontos: ["claude-cli", "codex-cli"], ordem: ["claude-cli", "codex-cli"], noLimite: ["codex-cli"] })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-sol", raciocinio: "medium" });
    let erro: unknown;
    try { resolverHarness({ harness: "codex-cli", modelo: "gpt-5.6-sol", prontos: ["claude-cli"], ordem: ["claude-cli", "codex-cli"] }); } catch (e) { erro = e; }
    expect(causaHarnessIndisponivel(erro)).toEqual({ harness: "codex-cli" });
  });
});

describe("a fila e o limite", () => {
  it("a máquina que só tem a IA no limite não pega turno do Automático enquanto a pessoa tiver outra fora dele", () => {
    expect(iasParaOAutomatico({ prontosMaquina: ["claude-cli"], prontosPessoa: ["claude-cli", "codex-cli"], noLimite: ["claude-cli"] })).toEqual([]);
    expect(iasParaOAutomatico({ prontosMaquina: ["claude-cli", "codex-cli"], prontosPessoa: ["claude-cli", "codex-cli"], noLimite: ["claude-cli"] })).toEqual(["codex-cli"]);
    // Nenhuma fora do limite: vale a regra do Automático (todas as prontas).
    expect(iasParaOAutomatico({ prontosMaquina: ["claude-cli"], prontosPessoa: ["claude-cli"], noLimite: ["claude-cli"] })).toEqual(["claude-cli"]);
  });
  it("no limite, a próxima IA da ordem pronta e fora do limite; nenhuma = não troca", () => {
    const ordem: IdHarness[] = ["claude-cli", "codex-cli"];
    expect(proximaIaNoLimite({ ordem, prontos: ["claude-cli", "codex-cli"], noLimite: ["claude-cli"], atual: "claude-cli" })).toBe("codex-cli");
    expect(proximaIaNoLimite({ ordem, prontos: ["claude-cli"], noLimite: ["claude-cli"], atual: "claude-cli" })).toBeNull();
    expect(proximaIaNoLimite({ ordem, prontos: ["claude-cli", "codex-cli"], noLimite: ["claude-cli", "codex-cli"], atual: "claude-cli" })).toBeNull();
    expect(proximaIaNoLimite({ ordem, prontos: ["claude-cli", "codex-cli"], noLimite: ["codex-cli"], atual: "codex-cli" })).toBe("claude-cli");
  });
  it("o prazo: o que o fornecedor disse (até 8 dias à frente), senão 1 h", () => {
    expect(prazoDoLimite(AGORA + 3 * 3_600_000, AGORA)).toBe(AGORA + 3 * 3_600_000);
    expect(prazoDoLimite(null, AGORA)).toBe(AGORA + PRAZO_LIMITE_SEM_HORARIO_MS);
    expect(prazoDoLimite(AGORA - 1, AGORA)).toBe(AGORA + PRAZO_LIMITE_SEM_HORARIO_MS);
    expect(prazoDoLimite(AGORA + 9 * 86_400_000, AGORA)).toBe(AGORA + PRAZO_LIMITE_SEM_HORARIO_MS);
    expect(PRAZO_LIMITE_SEM_HORARIO_MS).toBe(3_600_000);
  });
});

describe("o catálogo: recomendado e níveis de raciocínio por modelo", () => {
  it("Recomendado: Opus no Claude, GPT-5.6 Sol no Codex, raciocínio médio", () => {
    const rec = Object.fromEntries(HARNESSES.filter((h) => h.integrado).map((h) => [h.id, "recomendado" in h ? h.recomendado : null]));
    expect(rec).toEqual({ "claude-cli": { modelo: "opus", raciocinio: "medium" }, "codex-cli": { modelo: "gpt-5.6-sol", raciocinio: "medium" } });
  });
  it("os níveis do Codex batem com o model/list medido no 0.147 (sem o `ultra`, que delega sozinho)", () => {
    const lista = modelosDaLista(JSON.parse(readFileSync(new URL("../../fixtures/codex-model-list-0.147.json", import.meta.url), "utf8")) as Record<string, unknown>);
    for (const id of ["gpt-5.6-sol", "gpt-5.6-luna"]) {
      const medido = lista.find((m) => m.id === id)?.esforcos.filter((e) => e !== "ultra");
      expect(raciociniosDoModelo("codex-cli", id), id).toEqual(medido);
    }
    expect(lista.find((m) => m.padrao)?.id).toBe("gpt-5.6-sol");
  });
  it("modelo fora do catálogo aceita todos os níveis da IA; IA sem catálogo, nenhum", () => {
    expect(raciociniosDoModelo("claude-cli", "claude-sonnet-4-6")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(raciociniosDoModelo("claude-cli", "haiku")).toEqual(["low", "medium", "high"]);
    expect(raciociniosDoModelo("hermes", "x")).toEqual([]);
  });
  it("o raciocínio que vai ao CLI é sempre um nível que o modelo aceita", () => {
    expect(raciocinioValido("claude-cli", "haiku", "max")).toBe("medium");
    expect(raciocinioValido("codex-cli", "gpt-6-astra", "max")).toBe("medium");
    expect(raciocinioValido("codex-cli", "gpt-5.6-sol", "max")).toBe("max");
    expect(raciocinioValido("claude-cli", "opus")).toBe("medium");
    expect(raciocinioValido("hermes", "x", "low")).toBeUndefined();
  });
});

describe("a inteligência do bot e os campos derivados", () => {
  it("derivados: Automático = auto/auto; Uma IA só = a IA e o modelo dela (auto = o recomendado); esforço = o raciocínio do Claude", () => {
    expect(derivadosDa(INTELIGENCIA_PADRAO)).toEqual({ harness: "auto", modelo: "auto", esforco: null });
    expect(derivadosDa({ modo: "fixa", fixa: "codex-cli", ordem: null, escolhas: { "codex-cli": { modelo: "gpt-5.6-luna" }, "claude-cli": { raciocinio: "high" } } })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-luna", esforco: "high" });
    expect(derivadosDa({ modo: "fixa", fixa: "claude-cli", ordem: null, escolhas: {} })).toEqual({ harness: "claude-cli", modelo: "auto", esforco: null });
  });
  it("o pedido antigo {harness, modelo, esforco} vira a inteligência", () => {
    const comOrdem: InteligenciaBot = { ...INTELIGENCIA_PADRAO, ordem: ["codex-cli", "claude-cli"], escolhas: { "codex-cli": { raciocinio: "low" } } };
    expect(inteligenciaDoLegado(comOrdem, { harness: "auto", modelo: "auto" })).toEqual(comOrdem);
    // "Automático" na tela antiga = nenhum modelo escolhido: o modelo sai, o raciocínio fica.
    expect(inteligenciaDoLegado({ modo: "fixa", fixa: "codex-cli", ordem: null, escolhas: { "codex-cli": { modelo: "gpt-5.6-luna", raciocinio: "high" }, "claude-cli": { modelo: "haiku" } } }, { harness: "auto", modelo: "auto" }))
      .toEqual({ modo: "auto", fixa: null, ordem: null, escolhas: { "codex-cli": { raciocinio: "high" } } });
    expect(inteligenciaDoLegado(INTELIGENCIA_PADRAO, { harness: "auto", modelo: "opus" })).toEqual({ modo: "fixa", fixa: "claude-cli", ordem: null, escolhas: { "claude-cli": { modelo: "opus" } } });
    expect(inteligenciaDoLegado(comOrdem, { harness: "codex-cli", modelo: "auto" })).toEqual({ modo: "fixa", fixa: "codex-cli", ordem: ["codex-cli", "claude-cli"], escolhas: { "codex-cli": { raciocinio: "low" } } });
    expect(inteligenciaDoLegado(INTELIGENCIA_PADRAO, { harness: "auto", modelo: "auto", esforco: "xhigh" }).escolhas).toEqual({ "claude-cli": { raciocinio: "xhigh" } });
    expect(inteligenciaDoLegado({ ...INTELIGENCIA_PADRAO, escolhas: { "claude-cli": { raciocinio: "xhigh" } } }, { harness: "auto", modelo: "auto", esforco: null }).escolhas).toEqual({});
  });
  it("a gravada vale; se harness/modelo divergem dela (gravados por um código anterior), eles mandam", () => {
    const gravada: InteligenciaBot = { modo: "auto", fixa: null, ordem: ["codex-cli", "claude-cli"], escolhas: { "codex-cli": { modelo: "gpt-5.6-luna" } } };
    expect(inteligenciaDoAgente({ harness: "auto", modelo: "auto", esforco: null, inteligencia: gravada })).toEqual(gravada);
    expect(inteligenciaDoAgente({ harness: "codex-cli", modelo: "gpt-6-astra", esforco: null, inteligencia: gravada })).toEqual({ modo: "fixa", fixa: "codex-cli", ordem: ["codex-cli", "claude-cli"], escolhas: { "codex-cli": { modelo: "gpt-6-astra" } } });
    // Sem a gravada (fixture de antes da 0068): vem toda dos campos antigos, com o esforço.
    expect(inteligenciaDoAgente({ harness: "auto", modelo: "auto", esforco: "high" })).toEqual({ modo: "auto", fixa: null, ordem: null, escolhas: { "claude-cli": { raciocinio: "high" } } });
  });
  it("o pedido da tela nova: campo ausente não muda; `fixa` só no modo Uma IA só (sem ela, a primeira da ordem)", () => {
    const atual: InteligenciaBot = { modo: "auto", fixa: null, ordem: null, escolhas: { "claude-cli": { modelo: "sonnet" } } };
    expect(aplicarPedidoInteligencia(atual, { modo: "fixa" })).toEqual({ ...atual, modo: "fixa", fixa: "claude-cli" });
    expect(aplicarPedidoInteligencia(atual, { modo: "fixa", ordem: ["codex-cli"] })).toMatchObject({ fixa: "codex-cli", ordem: ["codex-cli", "claude-cli"] });
    expect(aplicarPedidoInteligencia({ ...atual, modo: "fixa", fixa: "codex-cli" }, { modo: "auto" })).toEqual({ ...atual, modo: "auto", fixa: null });
    expect(aplicarPedidoInteligencia({ ...atual, ordem: ["codex-cli", "claude-cli"] }, { ordem: null }).ordem).toBeNull();
    expect(aplicarPedidoInteligencia(atual, { escolhas: { "codex-cli": { modelo: "auto", raciocinio: "max" } } }).escolhas).toEqual({ "codex-cli": { raciocinio: "max" } });
  });
  it("recusa o que a tela não pode pedir", () => {
    const ruins: unknown[] = [
      null, [], { modo: "turbo" }, { outro: 1 }, { fixa: "hermes" }, { ordem: ["claude-cli", "claude-cli"] },
      { escolhas: { "claude-cli": { modelo: "gpt-5.6-sol" } } },
      { escolhas: { "codex-cli": { modelo: "sonnet" } } },
      { escolhas: { "claude-cli": { modelo: "haiku", raciocinio: "max" } } },
      { escolhas: { "claude-cli": { raciocinio: "ultra" } } },
      { escolhas: { hermes: {} } },
      { escolhas: { "claude-cli": { modelo: "opus", extra: 1 } } },
      { escolhas: { "claude-cli": { modelo: "--model x" } } },
    ];
    for (const r of ruins) expect(() => aplicarPedidoInteligencia(INTELIGENCIA_PADRAO, r), JSON.stringify(r)).toThrow("entrada_invalida");
  });
});

describe("o estado das IAs da pessoa (GET /ias)", () => {
  it("o limite em vigor vira `nao_autenticado` com causa `limite` e `renovaEm`; vencido, volta o anunciado", () => {
    const limite = { renovaEm: AGORA + 60_000, desde: AGORA };
    expect(inventarioComLimite(pronto, limite, AGORA, "Claude Code")).toMatchObject({ estado: "nao_autenticado", causa: "limite", renovaEm: AGORA + 60_000, versao: "1.0.0" });
    expect(inventarioComLimite(pronto, { ...limite, renovaEm: AGORA }, AGORA, "Claude Code")).toEqual(pronto);
    const ausente: Inventario = { estado: "ausente", motivo: "x", em: AGORA };
    expect(inventarioComLimite(ausente, limite, AGORA, "Claude Code")).toEqual(ausente);
  });
  it("a ordem da pessoa, cada IA com o limite, o recomendado e os modelos com os níveis", () => {
    const r = iasDaPessoa({
      ordem: ["codex-cli", "claude-cli"],
      limites: { "claude-cli": { renovaEm: AGORA + 60_000, desde: AGORA }, "codex-cli": { renovaEm: AGORA - 1, desde: AGORA - 10 } },
      inventarios: { "claude-cli": pronto, "codex-cli": pronto },
      agora: AGORA,
      semSonda: () => ({ estado: "ausente", motivo: "sem sonda", em: AGORA }),
    });
    expect(r.ordem).toEqual(["codex-cli", "claude-cli"]);
    expect(r.ordemPadrao).toBe(false);
    expect(r.ias.map((i) => i.id)).toEqual(["codex-cli", "claude-cli", "cursor-cli", "hermes"]);
    expect(r.ias[0]).toMatchObject({ id: "codex-cli", limite: null, inventario: pronto, recomendado: { modelo: "gpt-5.6-sol", raciocinio: "medium" } });
    expect(r.ias[1]).toMatchObject({ id: "claude-cli", limite: { renovaEm: AGORA + 60_000 }, inventario: { estado: "nao_autenticado", causa: "limite" } });
    expect(r.ias[1]?.modelos.find((m) => m.id === "opus")).toMatchObject({ recomendado: true, raciocinios: ["low", "medium", "high", "xhigh", "max"] });
    expect(r.ias[2]).toMatchObject({ integrado: false, inventario: { estado: "ausente" }, recomendado: null });
    expect(r.raciocinios.map((n) => n.id)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("NOD-268: teto de reenvios, espera do Automático e o alarme do laço", () => {
  it("podeReenviar: uma vez só (TETO_REENVIOS = 1)", () => {
    expect(TETO_REENVIOS).toBe(1);
    expect(podeReenviar({ reenvios: 0 })).toBe(true);
    expect(podeReenviar({ reenvios: 1 })).toBe(false);
    expect(podeReenviar({ reenvios: 5 })).toBe(false);
  });

  it("esperaDoAutomatico: todas as prontas no limite → a renovação mais próxima; uma fora → null; nenhuma pronta → null", () => {
    const agora = 1_000;
    const limites = { "claude-cli": { renovaEm: 5_000, desde: 0 }, "codex-cli": { renovaEm: 3_000, desde: 0 } };
    expect(esperaDoAutomatico({ prontos: ["claude-cli", "codex-cli"], limites, agora })).toBe(3_000);
    expect(esperaDoAutomatico({ prontos: ["claude-cli"], limites, agora })).toBe(5_000);
    expect(esperaDoAutomatico({ prontos: ["claude-cli", "gemini-cli"], limites, agora })).toBeNull();
    expect(esperaDoAutomatico({ prontos: ["claude-cli", "codex-cli"], limites, agora: 4_000 })).toBeNull();
    expect(esperaDoAutomatico({ prontos: [], limites, agora })).toBeNull();
    expect(esperaDoAutomatico({ prontos: ["claude-cli"], limites: null, agora })).toBeNull();
  });

  it("reenvioEmLaco: mais de 3 turnos em menos de 5 min", () => {
    const agora = 10 * 60_000;
    const recentes = [agora - 60_000, agora - 30_000, agora - 10_000];
    expect(reenvioEmLaco(recentes, agora)).toBe(false);
    expect(reenvioEmLaco([...recentes, agora], agora)).toBe(true);
    expect(reenvioEmLaco([...recentes, agora - LACO_JANELA_MS], agora)).toBe(false);
    expect(LACO_TURNOS).toBe(3);
  });
});

describe("NOD-280: prazoDoLimiteDaConta", () => {
  it("sem hora ou no passado: uma hora; longe demais: corta em 8 dias; senão a hora dita", async () => {
    const { prazoDoLimiteDaConta, PRAZO_LIMITE_MAXIMO_MS, PRAZO_LIMITE_SEM_HORARIO_MS } = await import("../../../src/domain/inteligencia.ts");
    const agora = 1_800_000_000_000;
    expect(prazoDoLimiteDaConta(null, agora)).toBe(agora + PRAZO_LIMITE_SEM_HORARIO_MS);
    expect(prazoDoLimiteDaConta(agora - 1, agora)).toBe(agora + PRAZO_LIMITE_SEM_HORARIO_MS);
    expect(prazoDoLimiteDaConta(agora + 31 * 86_400_000, agora)).toBe(agora + PRAZO_LIMITE_MAXIMO_MS);
    expect(PRAZO_LIMITE_MAXIMO_MS).toBe(8 * 86_400_000);
    expect(prazoDoLimiteDaConta(agora + 3_600_000 * 5, agora)).toBe(agora + 3_600_000 * 5);
  });
});
