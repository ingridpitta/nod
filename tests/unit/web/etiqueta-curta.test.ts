import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { ETIQUETA_CURTA, renderMensagem } from "../../../web/telas/conversa.ts";

/**
 * NOD-378, revisão 4 do PR 540: no celular a etiqueta do cabeçalho tem piso de 8em para não sumir quando o nome é longo;
 * na etiqueta mais curta que isso o piso deixava espaço vazio e alargava o balão. A curta vem marcada (.curta) e não
 * cede nem ganha piso (interface.css); só a longa cede, com reticência.
 */
const autoria = { autor_tipo: "agente" as const, autor_id: "ada", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local" as const, locality: "local" as const, locality_reason: "motor_ausente" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const m: Mensagem = { tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "texto", texto: "Feito.", payload: null, confianca: "confiavel", parcial: false, criadoEm: 0 };
const estado: Estado = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" } };
const etiquetaDe = (etiqueta: string) => /<span class="(etiqueta-origem[^"]*)"/.exec(renderMensagem(m, estado, false, { etiqueta }))?.[1];

describe("etiqueta curta do cabeçalho (NOD-378)", () => {
  it("até o limite é curta; passou dele, cede", () => {
    expect(ETIQUETA_CURTA).toBe(16);
    expect(etiquetaDe("da task A")).toBe("etiqueta-origem curta");
    expect(etiquetaDe("da rotina")).toBe("etiqueta-origem curta");
    expect(etiquetaDe("x".repeat(ETIQUETA_CURTA))).toBe("etiqueta-origem curta");
    expect(etiquetaDe("x".repeat(ETIQUETA_CURTA + 1))).toBe("etiqueta-origem");
    expect(etiquetaDe("da rotina Toda manhã leia o canal #suporte e me avise se…")).toBe("etiqueta-origem");
  });

  it("sem etiqueta, nada de span", () => {
    expect(renderMensagem(m, estado)).not.toContain("etiqueta-origem");
  });
});
