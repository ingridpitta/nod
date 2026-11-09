// Regression: ISSUE-001 — textos com "deste Mac" / "seu Mac" / "Terminal deste Mac" na janela do Windows
// Found by /qa on 2026-11-08 (ADA-243, critério 6: "Nenhum texto 'Mac' num Windows")
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linhaAtualizarIa } from "../../../web/telas/ia-fora.ts";
import { motivoDoInventario } from "../../../web/telas/inteligencia.ts";
import { htmlSemIa, type EstadoSemIa } from "../../../web/telas/ligacao-sem-ia.ts";
import { renderListaBarra } from "../../../web/telas/barra.ts";
import { abaixoDaIa, type UiIas, type VistaIa } from "../../../web/telas/cartao-ia.ts";

/**
 * ADA-243 (QA do PR #692): o PR trocou "neste Mac" por `nesteMac()` em vários textos, mas deixou na mesma tela as frases
 * vizinhas com "deste Mac", "No Terminal deste Mac" e "do seu Mac" literais. No Windows (user-agent), nenhuma delas pode
 * dizer "Mac".
 */
const antes = globalThis.navigator;
beforeAll(() => {
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39" }, configurable: true });
});
afterAll(() => {
  if (antes === undefined) delete (globalThis as { navigator?: unknown }).navigator;
  else Object.defineProperty(globalThis, "navigator", { value: antes, configurable: true });
});

const semMac = (html: string) => expect(html).not.toMatch(/\bMac\b/);

const ligacao = (ias: EstadoSemIa["ias"], ponte = { entrar: false, instalar: false }): EstadoSemIa => ({
  causa: "falhou", ia: null, ias, ate: 0, entrando: null, nota: null, ocupado: false, ponte, onboarding: false,
});

describe("no Windows, nenhum texto diz Mac (critério 6)", () => {
  it("a linha de atualizar a IA aponta o PowerShell deste computador", () => {
    const h = linhaAtualizarIa("claude-cli", false);
    semMac(h);
    expect(h).toContain("No PowerShell deste computador, rode:");
  });

  it("o motivo do inventário com o CLI antigo diz 'deste computador'", () => {
    const m = motivoDoInventario("Claude Code", { estado: "ausente", causa: "cli_antigo", versao: "2.0.1", minima: "2.1.0" } as never);
    semMac(m);
    expect(m).toContain("O Claude Code deste computador está na versão 2.0.1");
  });

  it("o aviso da ligação sem IA (versão antiga, atualizando, demorou, sem login sem ponte) não diz Mac", () => {
    for (const ias of [
      [{ id: "claude-cli" as const, estado: "ausente" as const, causa: "cli_antigo" as const, versao: "2.0.1", minima: "2.1.0" }],
      [{ id: "claude-cli" as const, estado: "ausente" as const, causa: "atualizando" as const }],
      [{ id: "claude-cli" as const, estado: "ausente" as const, causa: "sonda_lenta" as const }],
      [{ id: "claude-cli" as const, estado: "nao_autenticado" as const }],
    ]) semMac(htmlSemIa(ligacao(ias), { nome: "Ana", genero: "feminina" }));
  });

  it("a lista do '/' diz 'do seu computador'", () => {
    const h = renderListaBarra({ itens: [], maisSkills: 0, soDoTerminal: "doctor", semCatalogo: true }, { filtro: "", selecionado: 0, bot: "Ana", doMacEm: Date.UTC(2026, 10, 8, 12) });
    semMac(h);
    expect(h).toContain("do seu computador · lista das");
  });

  it("o 'Prefere o terminal?' do cartão da IA aponta o PowerShell", () => {
    const h = abaixoDaIa({ terminal: "claude" } as VistaIa, {} as UiIas);
    semMac(h);
    expect(h).toContain("No PowerShell deste computador:");
  });
});
