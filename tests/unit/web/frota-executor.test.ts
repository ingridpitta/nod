import { describe, expect, it } from "vitest";
import type { EstadoExecutor } from "../../../src/contracts/executor.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderExecutor } from "../../../web/telas/frota.ts";

const MOTIVO = 'NOD_EXECUTOR desconhecido: "xyz" (válidos: auto, claude-cli, codex-cli, catcher)';
const pronto = (versao: string): Inventario => ({ estado: "pronto", versao, em: 1 });

function executor(atual: EstadoExecutor["atual"], claude: Inventario): EstadoExecutor {
  return {
    atual,
    recusa: null,
    harnesses: { simulacao: atual === "catcher", padrao: null, legado: "claude-cli", opcoes: [] },
    opcoes: [
      { id: "catcher", custo: "zero", inventario: pronto("catcher") },
      { id: "claude-cli", custo: "real", inventario: claude },
      { id: "codex-cli", custo: "real", inventario: { estado: "ausente", motivo: "Conecte sua conta para habilitar este harness.", em: 1 } },
    ],
  };
}

const botoes = (html: string) => [...html.matchAll(/data-act="trocar-executor"[^>]*data-id="([^"]+)"|data-id="([^"]+)"[^>]*data-act="trocar-executor"/g)].map((m) => m[1] ?? m[2]);

/**
 * NOD-160 (QA): com NOD_EXECUTOR desconhecido o Claude nasce "atual" e em sombra. O servidor passou a religá-lo quando é
 * escolhido de novo, mas o seletor só tinha botão para as opções que NÃO estão em uso — não havia como pedir isso na tela,
 * e a única saída era passar pela simulação. A opção em uso que não está pronta ganha o botão de ligar.
 */
describe("seletor de executor (NOD-160)", () => {
  it("o Claude em uso e em sombra tem botão para ligá-lo", () => {
    const html = renderExecutor({ ...estadoInicial, executor: executor("claude-cli", { estado: "ausente", motivo: MOTIVO, em: 1 }) });
    expect(botoes(html)).toContain("claude-cli");
    expect(html).toContain("ligar Claude Code");
    expect(html).toContain("NOD_EXECUTOR desconhecido");
  });

  it("o Claude em uso e pronto continua sem botão para si mesmo", () => {
    const html = renderExecutor({ ...estadoInicial, executor: executor("claude-cli", pronto("2.1.0")) });
    expect(botoes(html)).toEqual(["catcher", "codex-cli"]);
  });

  it("com a simulação em uso, as outras opções seguem com 'usar'", () => {
    const html = renderExecutor({ ...estadoInicial, executor: executor("catcher", { estado: "ausente", motivo: MOTIVO, em: 1 }) });
    expect(botoes(html)).toEqual(["claude-cli", "codex-cli"]);
    expect(html).toContain("usar Claude Code");
  });

  it("revisto em 2026-10-10 (teste do Breno): no servidor compartilhado (`trocavel: false`) nenhum botão de troca", () => {
    const html = renderExecutor({ ...estadoInicial, executor: { ...executor("claude-cli", pronto("2.1.0")), trocavel: false } });
    expect(botoes(html)).toEqual([]);
    expect(html).toContain("Claude Code");
  });
});
